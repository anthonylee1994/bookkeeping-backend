# 0. 概覽與假設

### 0.1 目標

建立 Rails 8 API-only 記帳後端，支援多用戶、收入/支出/轉帳、分類、帳戶、商家、週期性交易、單次交易、圖片帳單 AI 記帳、Dashboard 與 daily/weekly/monthly summary。部署到 Dokku。

### 0.2 假設（請確認）

- 單一貨幣 HKD（DB 保留 currency 欄位，預設 HKD）
- 每個 user 註冊時自動建立一個「現金」Account
- 時區固定 `Asia/Hong_Kong`（Rails `config.time_zone`、`ActiveRecord::Base.default_timezone = :local`、user 預設、OS `TZ` 一律呢個；DB 讀寫唔轉 UTC）
- Weekly = Monday 00:00:00 至 Sunday 23:59:59（Asia/Hong_Kong）
- Monthly = 1 號 00:00:00 至月末 23:59:59（Asia/Hong_Kong）
- Recurring 用 **request-time catch-up**，唔用 background job / worker
- Recurring backfill **預設關閉**；可選開啟，上限 90 日
- 刪除一律 **hard delete**（唔用 soft delete / `discarded_at`）
- **退款功能已於 2026-09-15 移除**：`transactions` 冇 `refund_of_id`、冇 `POST /transactions/:id/refund`；summary 冇 `refund_cents`（舊 refund 記錄已 migrate 成相反 kind 嘅普通交易）
- JWT **所有 env 都唔 check exp**；token 唔寫 `exp`；**冇 UserSession**；logout 只係 frontend 刪 JWT
- Auth **只用 username + password**，唔用 email
- LIHKG 上傳 API 係**非官方**圖床（eservice-hk），唔保證穩定；出站 upload **必須**帶 `Origin: https://lihkg.com`（圖床會 check，缺或唔係呢個值會拒）
- DeepSeek `deepseek-flash` **原生支援 vision**，無需 OCR fallback
- Dokku 用 Dockerfile buildpack（Rails 8 預設）
- Dokku 上 SQLite 檔案用 persistent storage mount
- 所有 model PK / FK 用 **UUID**（SQLite 存 `varchar(36)`，API 一律 UUID string）

### 0.3 Dokku 部署總覽

- App name：`bookkeeping-backend`
- Domain：`book-api.on99.app`（用現成 cert：`dokku certs:add bookkeeping-backend < /root/certs/on99.app.tar`）
- Storage mount：`/var/lib/dokku/data/storage/bookkeeping-backend/storage:/app/storage`
- SQLite DB：primary / cache 全部放 `/app/storage`（唔開 queue / cable）
- Procfile：web + release（**冇 worker**）
- ENV 用 `dokku config:set` 管理，唔 commit secret
- Host cron 每日跑 backup + maintenance，rotate 7 日

---

# 1. 技術棧

| 項目            | 選擇                                                             |
| --------------- | ---------------------------------------------------------------- |
| Ruby            | 3.3.x                                                            |
| Rails           | 8.x API-only                                                     |
| DB              | SQLite 3（WAL mode, busy_timeout=5000）                          |
| Auth            | bcrypt + JWT（`jwt` gem）                                        |
| Background      | **冇**。Recurring 用 request-time catch-up；cleanup 用 host cron |
| Cache           | Solid Cache                                                      |
| WebSocket       | 唔用（Solid Cable 唔裝）                                         |
| Rate limit      | Rack::Attack                                                     |
| 分頁            | Pagy（max_per_page=100）                                         |
| 測試            | RSpec + FactoryBot + WebMock + VCR                               |
| API Docs        | rswag                                                            |
| N+1 檢測        | Bullet（dev/test）                                               |
| 刪除            | hard delete（唔用 discard）                                      |
| JSON 驗證       | json-schema（驗證 DeepSeek 回傳）                                |
| HTTP Client     | Faraday + faraday-retry + faraday-multipart                      |
| Circuit Breaker | stoplight                                                        |
| ENV             | dotenv（dev）+ Dokku config（prod）                              |
| 部署            | Dokku（Dockerfile）                                              |
