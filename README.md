# 記帳 App Backend（NestJS）

Rails 8 → loco.rs (Rust) → **NestJS (TypeScript)** API-only 後端 rewrite，支援多用戶、收入/支出/轉帳、分類、帳戶、商家、週期性交易、單次交易、圖片帳單 AI 記帳、Dashboard 與 daily/weekly/monthly summary。API contract、資料庫 schema 同錯誤格式同原本版本 **100% 相容**。

詳細規格：`agent-specs/`（`AGENTS.md` 有索引）。

## 技術棧

| 項目       | 選擇                                                              |
| ---------- | ----------------------------------------------------------------- |
| 語言       | TypeScript（Node.js 22+）                                          |
| Framework  | NestJS 11（Express platform）                                     |
| ORM        | TypeORM 1（`better-sqlite3` driver）                              |
| DB         | SQLite（WAL, busy_timeout=5000, foreign_keys=ON）                  |
| Auth       | bcryptjs + JWT（HS256，唔驗 exp）                                  |
| Background | 冇 worker；Recurring 用 request-time catch-up                      |
| HTTP client| 原生 `fetch`（AI / LIHKG 出站）                                    |
| 分頁       | offset + limit，`per_page` clamp 1..100（預設 25）                 |
| 測試       | Vitest + supertest（`pnpm test`）                                  |
| 套件管理   | pnpm                                                              |

> 日期／時間欄位以 `String` 存喺 SQLite（HK local wall time，canonical 格式 `YYYY-MM-DD HH:MM:SS.SSS` / `YYYY-MM-DD`），全 app 唔轉 UTC。詳見 `agent-specs/01-data-models.md`。

## 本機開發

```bash
cp .env.example .env          # 填 JWT_SECRET / DEEPSEEK_API_KEY
pnpm install
pnpm db:migrate               # 套用 TypeORM migration
pnpm start:dev                # http://localhost:3000
```

> **由舊 Rails / loco.rs DB 升級**：舊 DB 嘅 `datetime(6)` / `date` 欄位會唔會影響 TypeORM 讀取（TypeORM 唔似 Prisma 咁按 declared type 解碼），但為保持 schema 一致，建議跑 `pnpm db:normalize`（idempotent，保留所有 data）。Docker `docker-entrypoint.sh` 開機時會自動跑呢步。Init migration 用 `CREATE TABLE/INDEX IF NOT EXISTS`，所以舊 DB 可以直接接軌，唔需要 baseline。

其他常用：

```bash
pnpm typecheck                # tsc --noEmit
pnpm format                   # prettier --write
pnpm format:check             # prettier --check
pnpm test                     # vitest run
pnpm build                    # nest build
pnpm db:normalize             # 修正舊 SQLite 欄位 declared type
pnpm maintenance:cleanup      # 清 >24 小時 idempotency keys
```

## 部署

Dokku + Dockerfile，見 `docs/dokku-setup.md`。`/up`、`/health`、`/health/db`、`/health/deepseek`、`/health/lihkg` 為 liveness/health，`/api-docs` 回 OpenAPI YAML。
