# 記帳 App Backend（loco.rs）

Rails → **loco.rs (Rust)** API-only 後端 rewrite，支援多用戶、收入/支出/轉帳、分類、帳戶、商家、週期性交易、圖片帳單 AI 記帳、Dashboard 與 daily/weekly/monthly summary。API contract、資料庫 schema 同錯誤格式同原本 Rails 版 **100% 相容**。

詳細規格：`agent-specs/`（`AGENTS.md` 有索引）。

## 技術棧

| 項目 | 選擇 |
| ---- | ---- |
| 語言 | Rust 1.98+ |
| Framework | loco.rs 1.1 |
| ORM | SeaORM 2.0（sqlx-sqlite，唔轉 UTC，Asia/Hong_Kong local） |
| DB | SQLite（WAL, busy_timeout=5000） |
| Auth | bcrypt + JWT（HS256，唔驗 exp） |
| Background | 冇 worker；Recurring 用 request-time catch-up |
| HTTP client | reqwest（rustls） |
| 分頁 | offset + limit，`per_page` clamp 1..100（預設 25） |

## 本機開發

```bash
cp .env.example .env          # 填 JWT_SECRET / DEEPSEEK_API_KEY
cargo loco db migrate         # 或 cargo run -- db migrate
cargo loco start              # http://localhost:3000
```

其他常用：

```bash
cargo loco routes             # 列 routes
cargo loco task maintenance:cleanup
cargo test
cargo fmt --all
cargo clippy --all-targets -- -D warnings
```

## 部署

Dokku + Dockerfile，見 `docs/dokku-setup.md`。`/up`、`/health`、`/health/db`、`/health/deepseek`、`/health/lihkg` 為 liveness/health，`/api-docs` 回 OpenAPI YAML。
