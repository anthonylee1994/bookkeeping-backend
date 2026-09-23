# 0. 概覽與假設

### 0.1 目標

建立 **NestJS (TypeScript)** API-only 記帳後端，支援多用戶、收入/支出/轉帳、分類、帳戶、商家、週期性交易、單次交易、圖片帳單 AI 記帳、Dashboard 與 daily/weekly/monthly summary。部署到 Dokku。

> 本專案原為 Rails 8，其後 rewrite 成 loco.rs，再 rewrite 成 NestJS（先 Prisma，後 **TypeORM**）；API contract、DB schema、錯誤格式 100% 相容。

### 0.2 假設（請確認）

- 單一貨幣 HKD（DB 保留 currency 欄位，預設 HKD）
- 每個 user 註冊時自動建立一個「現金」Account
- 時區固定 `Asia/Hong_Kong`：DB 讀寫 **唔轉 UTC**，所有 datetime 以 HK local wall time 存 SQLite；跨時區計算一律用固定 `+08:00` offset（HK 冇 DST）
- Weekly = Monday 00:00:00 至 Sunday 23:59:59（Asia/Hong_Kong）
- Monthly = 1 號 00:00:00 至月末 23:59:59（Asia/Hong_Kong）
- Recurring 用 **request-time catch-up**，唔用 background job / worker
- Recurring backfill **預設關閉**；可選開啟，上限 90 日
- 刪除一律 **hard delete**（唔用 soft delete / `discarded_at`）
- **退款功能已於 2026-09-15 移除**：`transactions` 冇 `refund_of_id`、冇 `POST /transactions/:id/refund`；summary 冇 `refund_cents`
- JWT **所有 env 都唔 check exp**；token 唔寫 `exp`；**冇 UserSession**；logout 只係 frontend 刪 JWT
- Auth **只用 username + password**，唔用 email
- LIHKG 上傳 API 係**非官方**圖床（eservice-hk），唔保證穩定；出站 upload **必須**帶 `Origin: https://lihkg.com`
- DeepSeek `deepseek-flash` **原生支援 vision**，無需 OCR fallback
- Dokku 用 Dockerfile buildpack（multi-stage Node build）
- Dokku 上 SQLite 檔案用 persistent storage mount（`/app/storage`）
- 所有 model PK / FK 用 **UUID**（SQLite 存 `varchar(36)`，API 一律 UUID string；NestJS 用 `crypto.randomUUID()` 生成）
- **日期／時間欄位**：entity 型別為 `string`，DB 欄位宣告 `varchar`（TEXT affinity），值為 canonical HK local 字串（datetime `YYYY-MM-DD HH:MM:SS.SSS`、date `YYYY-MM-DD`）。字串排序等同時間排序，所以 range filter / order by 直接用字串比較

### 0.3 Dokku 部署總覽

- App name：`bookkeeping-backend`
- Domain：`book-api.on99.app`（用現成 cert：`dokku certs:add bookkeeping-backend < /root/certs/on99.app.tar`）
- Storage mount：`/var/lib/dokku/data/storage/bookkeeping-backend/storage:/app/storage`
- SQLite DB：primary 放 `/app/storage`（`DATABASE_URL=file:../storage/production.sqlite3`；`../` 開頭沿用舊 Prisma 相對 `prisma/schema.prisma` 嘅解析，仍然指向 repo `storage/`）
- Docker entrypoint：`node dist/tasks/migrate.js`（TypeORM migration）後 `node dist/main.js`（唔使 Procfile release）
- ENV 用 `dokku config:set` 管理，唔 commit secret
- Host cron 每日跑 backup + `node dist/tasks/maintenance.js`，rotate 7 日

---

# 1. 技術棧

| 項目            | 選擇                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ |
| 語言            | TypeScript（Node.js 22+）                                                                  |
| Framework       | NestJS 11（Express platform）                                                              |
| ORM             | TypeORM 1（`better-sqlite3` driver，entities 用 snake_case 欄位 1:1）                      |
| DB              | SQLite 3（WAL mode, busy_timeout=5000, foreign_keys=ON）                                   |
| Auth            | bcryptjs（相容 Rails `$2a$` / `$2b$` hash）+ JWT HS256（`jsonwebtoken`）                   |
| Background      | **冇**。Recurring 用 request-time catch-up；cleanup 用 host cron                           |
| WebSocket       | 唔用                                                                                       |
| Rate limit      | 自建 in-memory sliding-window Nest middleware（`src/rate-limit/rate-limit.middleware.ts`） |
| 分頁            | offset + limit，`per_page` clamp 1..100（預設 25，Meta 自己 map）                          |
| 測試            | Vitest + supertest（`pnpm test`，單 fork 序列執行）                                        |
| API Docs        | 靜態 OpenAPI，`GET /api-docs` 回 `swagger/v1/swagger.yaml`                                 |
| 刪除            | hard delete（唔用 discard）                                                                |
| JSON 驗證       | 手寫 schema 驗證 DeepSeek 回傳（`src/ai/deepseek.service.ts`）                             |
| HTTP Client     | 原生 `fetch`（undici，支援 FormData / Blob / AbortSignal）                                 |
| Circuit Breaker | 自建（`src/receipts/lihkg.service.ts`，連續失敗 threshold + cooldown）                     |
| ENV             | dotenv（dev `.env`）+ Dokku config（prod）                                                 |
| 部署            | Dokku（Dockerfile）                                                                        |
