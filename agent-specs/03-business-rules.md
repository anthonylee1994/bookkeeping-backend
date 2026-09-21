# 4. 業務規則

1. **金額**：integer cents，永遠正數；方向由 `kind` 決定
2. **時區**：全 app `Asia/Hong_Kong`。`config.time_zone = "Asia/Hong_Kong"`；`ActiveRecord::Base.default_timezone = :local`（Rails 只接受 `:utc` / `:local`，靠 OS `TZ=Asia/Hong_Kong` 令 local = Hong Kong）。DB 讀寫 **唔轉 UTC**。顯示同計算（summary、recurring catch-up、日/週/月邊界）一律用 `Time.zone`（Hong Kong）
3. **Weekly**：Asia/Hong_Kong Mon 00:00:00 至 Sun 23:59:59.999999
4. **Monthly**：Asia/Hong_Kong 1 號 00:00:00 至月末 23:59:59.999999
5. **Transfer**：唔計入 income/expense summary；獨立 `transfers` key；亦唔計入帳戶餘額（`account_balances` 只計 income/expense）
6. **Recurring 產生邏輯**（request-time catch-up，**唔用 background job**）：

- 已 authenticate 嘅 request 開頭呼叫 `RecurringCatchUp.call(user: current_user)`（`Time.use_zone("Asia/Hong_Kong")`）
- 跳過：`AuthController`（`skip_before_action`）、`HealthController`（唔繼承 `ApplicationController`）
- 只處理該 user `status = active` 且 `next_run_at <= now` 嘅 rule
- 用 `RecurringOccurrence` unique index 保證 idempotent；併發 request 撞 unique → rescue 當已處理
- 產生後 `last_run_at = now`，`next_run_at = 下次`
- 若 `end_on` 已過 → status = ended
- **Backfill 規則**：
  - `RECURRING_BACKFILL_ENABLED=false`（預設）：只 materialize 最後一個 due occurrence（即「今日」），其餘 due occurrence 寫 RecurringOccurrence 但 `transaction_id = nil`
  - `RECURRING_BACKFILL_ENABLED=true`：補最多 `RECURRING_BACKFILL_MAX_DAYS`（預設 90）日，較早嘅 occurrence 只寫 occurrence，超出上限就 skip 並 log warning
  - 無論開唔開，每個 due occurrence 都會寫 RecurringOccurrence，避免重複
- 刪咗由 recurring 產生嘅 transaction：occurrence 保留、`transaction_id = nil`，**唔會**再為該日自動產生
- `run_now`：若該 `occurred_on` 未有 transaction，補建並關聯；已有 → 409 `already_materialized`
- `skip_next`：為下一次寫 RecurringOccurrence（`transaction_id = nil`），推進 `next_run_at`

7. **刪除分類**：hard delete；交易保留，`category_id` SET NULL
8. **刪除帳戶**：若有任何交易（含作 transfer 目標）或 RecurringRule → 422 `account_in_use`；否則 hard delete
9. **刪除交易**：hard delete；`RecurringOccurrence.transaction_id` 同 `AiImportLog.transaction_id` SET NULL，唔再生該 occurrence
10. **刪除商家**：hard delete；交易 `merchant_id` SET NULL
11. **刪除 RecurringRule**：hard delete；已產生 transaction 保留；occurrences cascade delete
12. **AI 解析流程**：

- 上傳 → LIHKG → 回 URL + sha256（唔落 DB）
- parse：whitelist host → 計 sha256 + `parse_signature`（= `PROMPT_VERSION` + 該 user 分類名單）→ 查 `AiImportLog` 24 小時內、同 sha256 同 signature 嘅 `status = success` 記錄 → 有就回 cache
- 冇就：backend fetch 圖 → base64 inline → DeepSeek `deepseek-flash` vision
- DeepSeek prompt 會帶入用戶現有分類（分 income／expense 列出），要求 model 逐字 copy，唔准翻譯或自創
- 回傳 preview JSON（唔直接入帳）：`parsed`、`suggested_category_id`（category_hint 對得上當前 user 分類先有值，否則 nil）、`status`、`raw_response`、`error`、tokens、latency
- 用戶 confirm → 建立 transaction（`image_urls` + `source = ai`）＋回填 `AiImportLog.transaction_id`
- cache hit 時仍會用當前 user 分類重新 `normalize_category_hint`，確保唔會漏出 AI 自創嘅分類名

13. **AI JSON schema**（用 `json-schema` gem 驗證；回傳唔符 schema → `status = partial`）：

```json
{
  "type": "object",
  "required": ["amount_cents", "kind", "occurred_at"],
  "properties": {
    "amount_cents": { "type": "integer", "minimum": 1 },
    "kind": { "enum": ["income", "expense"] },
    "occurred_at": { "type": "string", "format": "date-time" },
    "merchant_name": { "type": ["string", "null"] },
    "category_hint": { "type": ["string", "null"] },
    "note": { "type": ["string", "null"] },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
  }
}
```

14. **Idempotency-Key**：`POST /transactions` 同 `/ai/confirm` 支援，獨立 `IdempotencyKey` table，24 小時過期；同 key 但 `request_hash` 唔同 → 422 `idempotency_conflict`。host cron 每日清
15. **Summary 計算**（transfer 唔計）：

```ruby
income_cents  = sum(kind: income)
expense_cents = sum(kind: expense)
net_cents     = income_cents - expense_cents
```

`by_category` / `by_account` 各自回 `income_cents` 同 `expense_cents`。

16. **SSRF 防護**：`/ai/parse` 只收 whitelist host 嘅 `image_url`（`ENV["LIHKG_ALLOWED_HOSTS"]`，預設 `img.eservice-hk.net`）；backend 自己 fetch。非 whitelist → 400 `validation_error`
17. **LIHKG 圖床風險**：用 stoplight circuit breaker，連續失敗 `LIHKG_CIRCUIT_FAILURES` 次（預設 5）開路 `LIHKG_CIRCUIT_COOLDOWN` 秒（預設 60）；circuit open 或 upstream 失敗回 502 `upstream_error`，log 詳細。出站 upload Faraday request **必須**帶 `Origin: https://lihkg.com`（硬編碼，圖床會 check Origin）
18. **分頁上限**：`Pagy::DEFAULT[:max_per_page] = 100`；transactions / summaries 直接 offset + limit，`per_page` clamp 1..100（預設 25）
