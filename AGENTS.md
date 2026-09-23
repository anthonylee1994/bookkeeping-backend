# 記帳 App Backend（NestJS / TypeORM / SQLite）

> **文件維護**：每次改完 code（任何行為、endpoint、schema、業務規則改動）都必須同步更新對應 `agent-specs/*.md` 及 `swagger/` OpenAPI；未更新 spec 嘅改動當未完成。
>
> 本專案已由 Rails 8 → loco.rs (Rust) → **NestJS + Prisma** → **NestJS + TypeORM (TypeScript)** rewrite。API contract、DB schema、錯誤格式維持 100% 相容；`agent-specs/01`–`03` 仍然有效，只有技術棧／部署（`00`、`04`、`05`）改成 TypeORM 版本。

---

## 目錄

| 檔案                                                     | 內容                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| [`agent-specs/00-overview.md`](agent-specs/00-overview.md)   | 概覽、假設、Dokku 部署總覽、技術棧                              |
| [`agent-specs/01-data-models.md`](agent-specs/01-data-models.md) | 資料模型（ID 約定、User / Account / Category / Merchant / Transaction / Recurring / AI / Idempotency） |
| [`agent-specs/02-api-endpoints.md`](agent-specs/02-api-endpoints.md) | API Endpoints 3.1–3.10（Auth / Accounts / Categories / Merchants / Transactions / Recurring / Receipts-AI / Dashboard / Summaries / Health） |
| [`agent-specs/03-business-rules.md`](agent-specs/03-business-rules.md) | 業務規則 1–18（金額、時區、transfer、recurring catch-up、AI、idempotency、summary、分頁） |
| [`agent-specs/04-phases.md`](agent-specs/04-phases.md)   | 開發 Phases 0–7（Rails 原版）+ Phase R（loco.rs）+ Phase N（NestJS） |
| [`agent-specs/05-operations.md`](agent-specs/05-operations.md) | 環境變數、統一錯誤格式、分頁格式、Dokku Checklist、風險、附錄 A |

---

## 快速定位

- **整個系統嘅假設同技術選擇** → `agent-specs/00-overview.md`
- **要加／改 `id`、欄位、index、FK** → `agent-specs/01-data-models.md`
- **要加／改 endpoint、request / response** → `agent-specs/02-api-endpoints.md`
- **行為邏輯（時區、recurring、AI、idempotency、summary）** → `agent-specs/03-business-rules.md`
- **開發進度／驗收標準** → `agent-specs/04-phases.md`
- **ENV、錯誤碼、部署、已知風險** → `agent-specs/05-operations.md`

---

## 本專案常用指令

```bash
pnpm db:migrate                  # 套用 TypeORM migration（等同上線 entrypoint）
pnpm db:normalize                # 修正舊 SQLite declared type（datetime(6)/date -> varchar）
pnpm start:dev                   # 起 server（預設 port 3000）
pnpm test                        # Vitest + supertest
pnpm typecheck                   # tsc --noEmit
pnpm format                      # prettier --write
pnpm build                       # nest build
```

> 修改 TypeScript code 後必須執行 `pnpm typecheck` 同 `pnpm format`（等同其他專案嘅 typecheck / format 檢查）。專案**唔用** ESLint。
