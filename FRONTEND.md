# 記帳 App Frontend Spec

## 0. 文件目的

本文件定義記帳 App frontend 的產品範圍、資訊架構、互動、PWA 行為、responsive 規則及驗收標準。Frontend 是 React SPA，經 typed API repository（axios）呼叫 Rails API（見 `BACKEND.md`／`swagger/`）；瀏覽器只持久化 session token 及表單 draft，domain data 一律存於後端。

> **文件維護**：日後任何 UI／行為改動，必須同步更新本文件及 `plan.md`；未更新 docs 嘅改動當未完成（見 §14）。

### 0.1 產品目標

- 令用戶可以用手機快速記一筆收入、支出或轉帳
- 一眼看到本月收支、帳戶餘額、分類分佈及最近交易
- 支援搜尋、篩選、修改、複製及刪除交易
- 支援單據拍攝／上載、AI 辨識（DeepSeek）、人工覆核後入帳
- 支援定期交易及日／週／月報表
- 可安裝成 PWA，於 iOS、Android 及 desktop browser 使用

### 0.2 非目標（MVP）

- 多用戶共享帳簿、家庭帳戶或權限管理
- 多貨幣換算；UI 只支援 HKD
- 忘記密碼、email 驗證、OAuth 登入
- 背景同步或 push notification
- CSV／銀行月結單匯入
- 退款功能（2026-09-15 由產品決定移除，見 §5.5）

### 0.3 基本假設

- 顯示語言為繁體中文（香港），預留 i18n 結構但 MVP 不提供語言切換
- 時區固定為 `Asia/Hong_Kong`
- 金額以 integer cents 儲存；frontend 不使用浮點數做金額運算
- 日期格式顯示為 `YYYY年M月D日`，時間使用 24 小時制
- 所有資料操作經 typed API repository（axios）完成，domain data 存於後端 SQLite

---

## 1. 技術棧

### 1.1 Core

| 用途                  | 選擇                                           |
| --------------------- | ---------------------------------------------- |
| Build tool            | Vite                                           |
| UI                    | React + TypeScript（strict mode）              |
| Styling / components  | Chakra UI v3（Emotion）                        |
| Routing               | React Router                                   |
| App state             | Zustand                                        |
| HTTP client           | axios（`data/apiRepository.ts`）               |
| Local persistence     | `localStorage`（session）／`sessionStorage`    |
| Form                  | React Hook Form + Zod                          |
| PWA                   | `vite-plugin-pwa`（Workbox）                   |
| Icons                 | Lucide React + `@iconify/react`（icon picker） |
| Charts                | Recharts                                       |
| Date                  | 原生 `Intl`（集中於 `lib/date.ts`）            |
| i18n                  | react-intl（`lib/i18n.ts` 集中 message descriptor） |
| Unit / component test | Vitest + React Testing Library                 |
| E2E                   | Playwright（已在 devDependencies，但 E2E suite 未實作） |

Zustand 使用 `create`；只有 `draftStore` 用 `persist` middleware。`authStore` 唔用 `persist`，token 由 `authRepository` 手動讀寫 `localStorage`。不使用 remote data cache library（React Query／SWR）。

### 1.2 Coding conventions

- `import React` 必須為 React／TSX 檔第一個 import
- Component 使用 named export：`export const ComponentName`
- Hook 使用 function declaration：`export function useSomething()`
- 使用 `<React.Fragment>`，不使用 fragment shorthand
- 使用 `React.useState()`、`React.useEffect()` 等 namespace API
- Component 內 event handler 用一般 arrow function，除非有實測需要，否則不加 `React.useCallback()`
- 非 component／hook function 使用 function declaration
- 一般 TypeScript／模組檔名用 camelCase（例如 `authRepository.ts`、`authStore.ts`）
- React component 檔名用 TitleCase（例如 `DashboardPage.tsx`、`LoginForm.tsx`）
- 入口 component 檔名為 `app.tsx`，並使用 `export const App`
- `.less` 不在本專案使用；如將來需要引入，import 必須放於所有 import 最後
- 不使用 `any`；fixture、form input、local query params 全部有明確型別
- 金額轉換集中於 `lib/money.ts`，日期／時區轉換集中於 `lib/date.ts`
- Domain data 由 API repository 提供；只有 accounts／categories／merchants 經 `useDomainReference` 寫入 appStore 作 shared reference cache，其餘 list hook 用 component-local state。URL 是可分享 filter 的唯一 source of truth

### 1.3 目錄

```text
src/
  app.tsx
  main.tsx
  routes/
  components/
    layout/            # AppLayout、AppHeader、SidebarNav、MobileTabBar、SectionCard…
    # 跨 feature primitive（EntityAvatar、TransactionKindIcon、SummaryTotalsGrid…）
  features/
    auth/
    dashboard/
    transactions/
    receiptScan/
    summaries/
    recurringRules/
    settings/          # 帳戶／分類／商戶（含對應 FormDrawer）
    pwa/
  data/
    types.ts
    schema.ts
    apiRepository.ts   # axios 核心 + LocalResult
    authRepository.ts
    transactionsRepository.ts
    ...
  stores/
    authStore.ts
    appStore.ts
    uiStore.ts
    draftStore.ts
  hooks/
  lib/                 # money、date、i18n、searchParams、colors…
  theme/               # Chakra design system
  test/
```

Feature 內可再分 `components/`、`hooks/`、`model.ts`／`schema.ts` 及 `types.ts`。Component 檔名用 TitleCase，其餘模組檔名用 camelCase。共用 UI 只放真正跨 feature 重用的 primitive，避免過早抽象。

---

## 2. 視覺與體驗方向

### 2.1 原則

- Mobile-first，主要操作可以單手完成
- 財務資料要安靜、清晰、易掃描；避免大量裝飾卡片及過度漸變
- 收入、支出除了顏色，必須同時用正負號、文字或 icon 區分
- 主要新增交易按鈕固定容易觸及，但不可遮住內容或 bottom navigation
- 所有破壞性操作都要明確說明清楚影響，確認後才執行

### 2.2 Design tokens

實際 token 定義於 `src/theme/system.ts`：

- Background：gray.50（dark gray.950）；surface：white（dark gray.900）
- Primary action：`brand.solid` = emerald 700 `#047857`（dark：emerald 500 `#10b981`）；focus ring `brand.500`
- Income：green；expense：red；transfer：blue（semantic token，必須配合正負號／文字）
- Border radius：控件 10px（`radii.lg`，semantic `l2`）、card 14px（`radii.xl`／`2xl`）
- Touch target：最少 `44px × 44px`
- 字級（theme 自訂 scale）：body `md` 15px、secondary `sm` 13px、meta `xs` 12px
- Desktop content max width：`1280px`（`maxW="7xl"`）
- heading 用負 letter-spacing（`tight`），body 保持 `0`

### 2.3 金額顯示

- 顯示：`$1,234.50`
- 收入：`+$1,234.50`
- 支出：`-$1,234.50`
- 輸入欄顯示 dollar value，提交前用字串精確轉成 cents
- 不容許負數、零、超過兩位小數、科學記數法

---

## 3. Responsive Layout

Chakra breakpoint 採用預設值（md 768px、lg 992px），layout 以內容需要而非指定裝置名稱設計。JS 內用 `useMediaQuery(DESKTOP_QUERY)`（≥1024px）決定 sidebar／drawer 形態。

| Viewport       | Navigation                      | Content                                       |
| -------------- | ------------------------------- | --------------------------------------------- |
| `< 768px`      | App bar + 底部 4 tab + 中間 FAB | 單欄、全寬表單、filter／覆核用 bottom sheet   |
| `768px–1023px` | 可收合左側 navigation           | 1–2 欄、modal 最大 640px                      |
| `>= 1024px`    | 固定左側 navigation             | Dashboard grid、交易 table、右側 detail panel |

### 3.1 Mobile

- Header 高 56px，尊重 `env(safe-area-inset-top)`
- Bottom navigation 4 個 tab：首頁、交易、報表、設定；中間凸起 FAB 為「新增交易」
- 「掃描」（一 click 開相機／上載，選圖後彈覆核 drawer）及「定期交易」放 app bar（因底部只夠 4 格）
- Page bottom padding 包括 navigation 高度同 `env(safe-area-inset-bottom)`
- 長表格改用 list row；主要資料先顯示，次要資料可展開
- 交易列表每行左邊顯示分類頭像（color + icon），meta 行顯示帳戶小頭像

### 3.2 Tablet / Desktop

- 左側 navigation：儀表板、交易、掃描（一 click 動作）、報表、定期交易、設定 + 「新增交易」按鈕
- Top bar 放頁面標題、日期範圍同 contextual actions
- 交易列表使用 table（分類／帳戶欄顯示頭像）；點擊 row 開右側 detail panel，保留列表位置
- 表單 create/edit 使用右側 drawer，不跳離當前工作脈絡

### 3.3 Layout safety

- 支援最窄 320px viewport，無水平捲動（圖表可以自身橫向捲動）
- Dialog 高度超過 viewport 時只捲動 dialog body，header/footer 保持可見
- 文字、金額、badge 不可互相遮擋；長 merchant／note 使用合理 truncate 並提供完整內容
- On-screen keyboard 打開後，focused input 同 submit action 仍可到達

---

## 4. Routing 與導航

```text
/login                         公開：登入
/register                      公開：註冊
/                              私有：Dashboard
/transactions                  私有：交易列表
/transactions/new              私有：新增交易
/transactions/:id              私有：交易詳情
/transactions/:id/edit         私有：修改交易
/summaries                     私有：報表
/recurring-rules               私有：定期交易
/settings                      私有：設定首頁
/settings/accounts             私有：帳戶
/settings/categories           私有：分類
/settings/merchants            私有：商戶
/settings/password             私有：更改密碼
*                              404
```

- 未登入進入 private route：redirect `/login?returnTo=<path>`
- 已登入進入 `/login` 或 `/register`：redirect `/`
- Reload private route 先顯示全頁 loading，透過 `GET /me` 驗證 token，期間不可閃出 login page
- 只接受站內 `returnTo` path，防止 open redirect
- Browser back 必須可以關閉 modal／drawer 或返回上一步
- Lazy load：transactions、summaries、recurring、settings；dashboard／auth eager

---

## 5. 頁面規格

### 5.1 登入／註冊

欄位：username、password；註冊頁另有確認密碼。

- Username 必填，trim 後送出
- Password 必填；最少 8 字元
- Password field 有顯示／隱藏切換
- Submit 中 disable 重複提交，顯示 inline progress
- 登入失敗顯示一般化錯誤，不透露 username 是否存在
- 成功後寫入 session、redirect `returnTo` 或 `/`
- 登出清除本地 session 及敏感 UI state，再去 `/login`
- 註冊由後端建立預設現金帳戶及分類；frontend 註冊成功等同登入

### 5.2 Dashboard `/`

預設顯示當月，可用上／下月按鈕改變 `date`。

內容次序：

1. 本月淨額、收入、支出（三格同字級）
2. 快速新增交易、掃描單據（只於 mobile 顯示；desktop 用 sidebar／header）
3. 分類 chart：收入與支出各一張卡（各顯示 Top 5，donut + 資料表）
4. 帳戶餘額（顯示帳戶頭像）
5. 未來 7 日定期交易（row 顯示分類頭像；日期用「今日／聽日／N 日後」）
6. 最近 10 筆交易（row 顯示分類頭像；轉帳用 ArrowLeftRight icon）

規則：

- Mobile 金額摘要用 2-column grid（淨額橫跨兩格）；desktop 3 columns
- Pie／donut chart 同時提供 legend、實際金額及可讀 table，不可以只靠顏色；分類顏色用該分類自訂 color（太淺則退回預設色序）
- Empty state 提供「新增第一筆交易」主動作
- 點擊帳戶餘額或最近交易 row 會進入已套用 filter 的交易頁或交易詳情；分類圖表的資料表 row 目前不可點

### 5.3 交易列表 `/transactions`

支援：

- 日期由／至
- 類型：全部、收入、支出、轉帳
- 帳戶、分類、商戶
- 關鍵字搜尋 note、payment method、merchant name
- 最低／最高金額
- 排序：日期、金額；升序／降序（`created_at` 仍係合法 query 值，但 UI 未有入口）
- Pagination，每頁預設 25，desktop 可選 25／50／100

互動：

- Filter 及 sort 同步 URL query，reload／分享 URL 可還原狀態
- 快捷日期範圍（全部時間／本月／上月／近 30 日）為 segmented control，mobile 撐滿一行
- Mobile 顯示交易 row：分類頭像、商戶或 note、分類、日期、帳戶（小頭像）、金額
- Desktop 顯示 table：日期、商戶／備註、分類（頭像）、帳戶（頭像）、金額
- 頁碼改變時保留 filter，並 scroll 到列表頂
- Loading 用 `LoadingIndicator`（progress circle）並支撐固定高度，避免 layout jump；交易詳情 drawer 例外地用 `Skeleton`
- No result state 提供清除 filter

### 5.4 新增／修改交易

第一步用 segmented control 選收入、支出、轉帳。欄位按類型改變：

| 欄位     | 收入／支出                 | 轉帳                 |
| -------- | -------------------------- | -------------------- |
| 金額     | 必填                       | 必填                 |
| 帳戶     | 必填                       | 必填（轉出）         |
| 轉入帳戶 | 不顯示                     | 必填且不可與轉出相同 |
| 商戶     | 可選 autocomplete          | 不顯示               |
| 分類     | 可選，按 kind 過濾         | 不顯示               |
| 日期時間 | 必填，預設現在             | 必填，預設現在       |
| 付款方式 | 可選                       | 可選                 |
| 備註     | 可選                       | 可選                 |
| 圖片     | 可選，顯示已有 URL preview | 可選                 |

- 商戶與分類在 md 以上並排（商戶在左、分類在右），mobile 疊住；商戶排在分類之前
- Merchant autocomplete debounce 300ms；輸入新名稱時可建立 merchant，再選回表單
- 選擇有 default category 的 merchant，會即時套用該分類（只在分類 kind 與目前 kind 相符時）；用戶仍可自行改分類
- 新增 merchant 時，如已選分類，會將該分類存為新 merchant 的 default category（下次再揀同一商戶會自動帶出）
- Create 每次開表單產生 UUID 作 idempotency key；成功後同步更新相關 view
- Edit 不可改變 `source`
- 離線時照常本地操作（見 §8.3）；banner 提示資料可能未更新，不進行假網絡 retry
- 離開 dirty form 前顯示確認
- 新增交易預設選取第一個帳戶；修改保留原有帳戶
- Desktop：右側 drawer；Mobile：底部 drawer（最高 92dvh）；直接進入 `/transactions/new`／edit URL 亦相同

### 5.5 交易詳情

顯示所有可用資料、單據圖、source、建立／更新時間。金額用 `amount_cents`；帳戶、分類／轉入帳戶欄顯示頭像。

Actions：修改、複製、刪除。

- 複製成功後打開新交易詳情；複製記錄日期預設為現在
- 刪除確認：此操作無法復原；成功返回列表
- 單據圖可放大查看，失效時顯示 fallback，不重試無限次
- **不提供退款**（2026-09-15 移除）

### 5.6 AI 單據（一 click 掃描）

流程：`一 click 掃描 -> 相機／上載 -> 上載 -> 後端解析（DeepSeek）-> 同頁彈出覆核 drawer -> 確認入帳`。

1. 掃描 button（app bar／左側 navigation／dashboard／交易頁）一 click 即開 `<input type="file" accept="image/jpeg,image/png,image/webp">`，由系統提供相機或檔案選擇
2. Frontend 驗證類型及 10 MiB 上限，顯示本地 preview（object URL）
3. 上載期間顯示可取消的 progress UI（掃描光線動畫）
4. 後端解析；低 confidence 或缺失欄位要明顯標示「需覆核」
5. Review 一律用 drawer（mobile 底部升起、desktop 右側滑入）
6. 用戶補回 account／category／merchant，再確認入帳

覆核 drawer 內帳戶為全寬，商戶／分類在 md 以上並排（商戶在左、分類在右）；商戶／分類互動跟 §5.4：揀有 default category 的商戶會自動套用分類；新增商戶時如已選分類，會存為該商戶的 default category。

確認時儲存修正後交易欄位及 `image_urls`，並使用 UUID 防止重複提交。解析失敗時保留圖片，提供重試解析或轉為手動入帳。已無獨立 `/scan` 頁面。

### 5.7 報表 `/summaries`

- Period segmented control：日、週、月
- 日期 picker 配合上一期／下一期
- 顯示收入、支出、淨額、分類分佈（收入／支出各一張）、帳戶分佈、期內交易
- 轉帳併入淨額卡下面一行（筆數 + 金額），不計入收入／支出／淨額
- 月報額外顯示「收支日曆」，放喺淨額卡之後：逐日淨收支（紅負綠正、0 為灰）；未到嘅日子留白，今日淺灰格；窄螢幕用精簡金額（萬／億）並可橫向滾動
- Weekly 清楚顯示星期一至星期日範圍
- Desktop 帳戶分佈同期內交易並排兩欄（分類分佈同樣兩欄）
- 期內交易 row 顯示分類頭像（跟 dashboard 一致）
- Chart tooltip 可用 keyboard 觸發；旁邊提供資料表
- URL 保存 `period`、`date`、`page`

### 5.8 定期交易 `/recurring-rules`

列表分 active、paused、ended tabs（URL `status`）。每項顯示類型、金額、頻率、下一次日期、帳戶、分類／商戶及狀態（分類頭像 + 帳戶／分類 chips）。

Create／edit 欄位：

- 類型（收入／支出）、金額、帳戶、商戶、分類（md 以上商戶／分類並排）、備註
- 商戶／分類互動跟 §5.4：揀有 default category 的商戶會自動套用分類；新增商戶時如已選分類，會存為該商戶的 default category
- 頻率：每日、每週、每月、每年
- 間隔 `interval`，預設 1
- 每週：`day_of_week`（0–6，UI 顯示日–六）
- 每月：`day_of_month`（1–31）
- 每年：`month_of_year`（1–12）及 `day_of_month`
- 開始日、可選結束日
- `next_run_at` 由開始日產生；送出時使用香港時區 ISO datetime

Actions：pause、resume、run now、skip next、edit、delete。Card footer 動作：主要動作用實色品牌綠，其餘每行兩個（desktop 自動寬度）。

- `run now` 前確認，成功後顯示已建立交易入口
- 409 `already_materialized` 顯示「今日已經產生過交易」
- `skip next` 確認文案列出將被跳過日期
- 刪除只刪 rule，已產生交易會保留；確認文案必須說明
- 清單由後端依 `status` filter（`GET /recurring_rules?status=`）

### 5.9 設定

#### 帳戶

- List 顯示名稱、類型、icon、color、餘額
- Create／edit：name、kind、icon、color、initial balance；currency 固定 HKD
- 刪除時如帳戶仍被交易或定期交易使用，顯示清晰阻止原因

#### 分類

- Income／expense tabs；依後端回傳次序（建立時間）排列
- Create／edit：name、kind、icon、color
- 刪除前提示歷史交易會保留，但分類會變成未分類

#### 商戶

- 載入全部商戶（`GET /merchants` 不帶 `q`）；搜尋為前端即時過濾已載入清單
- Create／edit：name、default category；列表顯示 default category
- 於交易／定期交易表單 inline 新增商戶時，如已揀分類，會自動設為該商戶的 default category
- 刪除前提示歷史交易會保留，但商戶會被清空
- 未儲存離開抽屜前需確認

#### 更改密碼 `/settings/password`

- 由 SettingsPage「系統」區塊入口進入
- 欄位：目前密碼、新密碼、確認新密碼；新密碼最少 8 字元
- 送出呼叫 `PATCH /me/password`（body：`password_challenge`、`password`、`password_confirmation`）
- 成功顯示 inline 成功訊息；失敗顯示一般化錯誤並清空欄位
- 不需要重新登入

#### 登出

- SettingsPage「系統」區塊有登出卡
- 登出原子地清除 auth session、draft／AI preview 及圖片 object URL，再導向 `/login`

---

## 6. 資料與狀態

### 6.1 API repository 規則

- 所有 domain data 經 `data/*Repository.ts`（axios）向 Rails API 讀寫；`apiRepository.ts` 統一處理 token、錯誤正規化（`LocalResult`）及 query serialization
- Repository 只回傳 typed `LocalResult<T>`，不 throw；錯誤 code 對齊 swagger 語意（`unauthorized`、`not_found`、`conflict_already_materialized`、`in_use` 等）
- Session token 存 `localStorage`；AI／transaction draft 存 `sessionStorage`
- 讀寫失敗顯示對應 error state，不模擬 HTTP status 數字

### 6.2 Core TypeScript types

```ts
export type UUID = string;
export type Currency = "HKD";
export type TransactionKind = "income" | "expense" | "transfer";
export type TransactionSource = "manual" | "recurring" | "ai" | "import";
export type AccountKind = "cash" | "bank" | "credit_card" | "e_wallet" | "other";
export type RecurringFrequency = "daily" | "weekly" | "monthly" | "yearly";
export type RecurringStatus = "active" | "paused" | "ended";

export interface PaginationMeta {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
}
```

完整 domain type 由 `data/types.ts` 定義；測試 fixture（`test/domainFixtures.ts`）必須符合同一套 Zod schema，確保 UI 測試資料同 production shape 一致。

### 6.3 appStore selectors

```text
useAppStore((state) => state.accounts)
useAppStore((state) => state.categories)
useAppStore((state) => state.merchants)
useAppStore((state) => state.referenceLoaded)
```

- `accounts`／`categories`／`merchants`／`referenceLoaded` 係實際共用嘅 slice，由 `useDomainReference` 寫入。
- 交易、報表、定期交易清單由各自 feature hook 用 component-local state 管理，唔經 appStore；`transactions`／`transactionsMeta` 只作交易詳情／表單嘅局部 cache。
- Selector 只讀取需要的 slice，避免 component 訂閱整個 store；不建立 duplicated cache。

### 6.4 Zustand state management

Zustand 管理 frontend app state；React Hook Form 管理表單暫態，URL 管理可分享 filter state。

#### State ownership

| State 類型                | Owner                      | 例子                                                                                                         |
| ------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Reference data mirror     | `appStore`                 | accounts、categories、merchants、referenceLoaded（由 `useDomainReference` 寫入）；transactions 只作交易詳情／表單局部 cache（不 persist） |
| URL state                 | React Router search params | transaction filters、sort、page、summary period/date、recurring status、returnTo                             |
| Form state                | React Hook Form            | transaction／account／category／recurring rule／AI confirm 欄位、dirty／validation state                     |
| Session state             | `authStore`                | token、minimal user payload、hydrated、logout                                                                |
| UI state                  | `uiStore`                  | mobile nav、drawer／dialog、offline flag、install prompt status                                              |
| Temporary workflow／draft | `draftStore`               | transaction draft、uploaded image URL                                                                        |

#### Store contract

```ts
type AuthState = {
    token: string | null;
    user: User | null;
    hydrated: boolean;
    setSession: (token: string, user: User) => void;
    clearSession: () => void;
};

type UiState = {
    isMobileNavOpen: boolean;
    activeDialog: string | null;
    isOffline: boolean;
    installPrompt: "unavailable" | "available" | "dismissed" | "installed";
    setMobileNavOpen: (open: boolean) => void;
    setActiveDialog: (dialog: string | null) => void;
    setOffline: (offline: boolean) => void;
    setInstallPrompt: (status: InstallPromptStatus) => void;
};

type DraftState = {
    transactionDraft: TransactionDraft | null;
    setTransactionDraft: (draft: TransactionDraft | null) => void;
    resetDrafts: () => void;
};
```

實際 type 要放 `data/types.ts` 或 feature type file，以上只是 ownership contract；不得用 `any` 或自由格式 object。

#### Rules

- 使用 Zustand selectors 讀取最小片段，例如 `useAuthStore((state) => state.token)`；避免 component 直接訂閱整個 store。
- Store action 用同步、可測試的 state transition；所有 repository operation 由 feature hook 呼叫，不將 component-specific logic 寫入 generic store。
- `authStore` **不用** `persist`：token 由 `authRepository` 的 `storeAuthToken`／`getStoredAuthToken`／`clearStoredAuthToken` 直接讀寫 `localStorage`，啟動時經 `hydrateAuthStore()` 同步。全 app 只有 `draftStore` 用 `persist`（version 1 + `sessionStorage`）。密碼及單據原圖絕不 persist。
- App 啟動時首先 hydrate auth，再由 route guard 決定是否顯示 login；hydration 完成前不可 redirect，避免 login page 閃現。
- `uiStore` 不需要持久化；`isOffline` 由 `navigator.onLine` 及 `online`／`offline` events 更新。
- `draftStore` 只 persist 可序列化 draft 欄位到 `sessionStorage`；`File`、Blob、object URL 不可 persist，離開頁面或 reload 要清理無效 preview。
- AI preview 入帳成功、交易提交成功、登出或切換 session 後，必須呼叫 `resetDrafts()`；object URL 要另外 `URL.revokeObjectURL()`。
- Logout 流程要原子地 `authStore.clearSession()`、`draftStore.resetDrafts()`，再導向 `/login`。
- 不可將 filters、pagination、selected date 同時放於 Zustand 與 URL；URL 是可分享頁面 state 的唯一 source of truth。
- Store state 要保持可序列化，禁止將 React element、Promise、AbortController 放入 store。
- 需要跨 tab 登出時監聽 `storage` event；收到 session 清除後，其他 tab 同步清除 local stores 及回到 login。

#### Testing

- 每個 store 有獨立 Vitest 測試，覆蓋 initial state、action、reset、persist hydration／migration 同 logout cleanup。
- Component test 要驗證 selector 只因相關 slice 改變而 rerender；不得靠 implementation detail 直接改 store 內部 object。

### 6.5 Repository contract

Repository 必須提供 typed functions，覆蓋 auth、dashboard、transactions、accounts、categories、merchants、receipts、AI preview、summaries 及 recurring rules。每個 function 只負責 HTTP（加上 url／params／idempotency key），回傳 `LocalResult<T>`。

Feature hook 在 `requestKey`（token／filter／reload token）改變時重新抓取：`useDomainReference` 會將 accounts／categories／merchants 寫入 appStore，`useTransactions`／`useDashboard`／`useSummary`／`useRecurringRules` 則用 component-local state。不得在 component 直接呼叫 axios。

---

## 7. Auth 與安全

- Auth 由後端 JWT 簽發；frontend 只持有 bearer token 作為 route gate。
- 所有可插入 UI 的文字經 React escaping；不使用 `dangerouslySetInnerHTML`
- **CSP 已於 2026-09-15 按用戶決定停用**：單據圖由 API origin 發出，`img-src 'self'` 會擋住。若要還原，需重新加回 meta，並將 API origin 補入 `img-src` 及 `connect-src`
- Production 只使用 HTTPS；service worker 於 production build 同 dev 都啟用（`devOptions.enabled: true`，方便測 install／離線）；dev 遇 stale cache 可於 DevTools 清 Cache Storage
- 登出或切換 session 時清除 auth／draft state、AI preview、draft 同圖片 object URL
- 不在 console、analytics、error tracking 記錄密碼、完整單據圖 URL 或完整 local data snapshot
- `returnTo`、external image URL 及 local error message 不可直接變成 executable URL／HTML

---

## 8. PWA 規格

### 8.1 Manifest

- `name`、`short_name`、description 使用繁體中文
- `display: standalone`、`start_url: /`、`scope: /`
- `theme_color` 及 app header 一致（`#047857`）；`background_color` 用 neutral background
- 提供 192×192（any）、512×512（any）、512×512 maskable icon，及 Apple touch icon（正式 bitmap，不使用臨時 Vite logo）

### 8.2 Service worker / caching

- 由 `vite-plugin-pwa`（generateSW）產生；`registerType: "prompt"`、`injectRegister: null`，app 自己註冊
- Precache hashed JS、CSS、icons 及 app shell（`index.html`）
- Navigation 採 **NetworkFirst + 3 秒 timeout**，失敗時用 `precacheFallback` 回退至 app shell
- Domain data（API）**不寫入 Cache Storage**；只可經 browser storage persistence
- `globPatterns` 會 precache `public/` 內嘅 js／css／html／svg／png／ico／woff（包括 receipt placeholder）；API 回應唔會被 precache
- 新版本採 prompt update：顯示「有新版本／重新載入」banner，由用戶按「重新載入」套用
- 不可在用戶填寫表單時自動 reload

### 8.3 Offline UX

- 全局顯示低干擾 offline banner
- 已載入且仍在 memory 的資料可繼續查看，標示「資料可能未更新」
- Reload 後無網絡仍可由 local persistence 還原 session／draft；需要外部圖片或 AI asset 時顯示 unavailable fallback
- Create、edit、delete、duplicate 同 recurring actions 離線照常運作（下次連線才同步）
- Draft form 可存於 session storage；不需要 background sync

### 8.4 Install UX

- Android／desktop 捕捉 `beforeinstallprompt`，只在用戶有互動並使用 app 一段時間後顯示一次（dismiss 記入 localStorage，之後不再彈）
- iOS 提供簡短「加入主畫面」指引，但只在 Safari 且未 standalone 時顯示
- 已安裝或用戶 dismiss 後，不反覆彈出提示
- 提示以固定底部 banner 呈現（新版本 → 安裝 → iOS 指引 → 已可離線，一次只顯示一個）

---

## 9. Loading、Empty、Error 與 Feedback

- 首次 page load：主要頁面用 `LoadingIndicator`（progress circle）並預留最小高度；交易詳情 drawer 用 `Skeleton`
- 寫入操作：按鈕內 progress，disable 同一 action；頁面其餘安全操作可繼續
- 成功 create/update/delete：結果直接反映於頁面（inline banner／列表），**全 app 不使用 toast**
- Validation：欄位下方錯誤 + focus 第一個錯誤欄位
- Empty state 要區分「完全沒有資料」與「filter 無結果」
- 全頁 fatal error 提供重試、返回首頁、清除本機資料等復原入口（full-screen，風格跟 404 一致）
- 使用 Error Boundary 隔離 route-level render error
- 阻塞錯誤使用 `role="alert"`

---

## 10. Accessibility

最低要求 WCAG 2.2 AA：

- 全部操作可用 keyboard 完成，focus 順序合理且 focus ring 清晰
- Modal／drawer 有 focus trap、Escape 關閉、關閉後 focus 返回觸發元素
- Confirm dialog 一律置中（`placement="center"`）
- Icon-only button 有 accessible name 同 tooltip
- Form 每個 input 有 persistent label；不以 placeholder 代替 label
- Error 透過 `aria-describedby` 連到欄位
- Segmented control、tabs、menu 使用正確 ARIA pattern
- 色彩對比達 AA；狀態不可只靠顏色
- 支援 200% text zoom，不截斷必要操作
- 尊重 `prefers-reduced-motion`；動畫不可影響理解或操作
- Chart 必須有等價文字／table 資料

---

## 11. Performance

- Route-level code splitting；Recharts 等較重 feature lazy load
- `advancedChunks` 手動拆分 react／chakra／intl／vendor，令改動不會令整個 vendor bundle 失效
- 大量 transaction 使用 server-side pagination，避免一次 render 全部資料
- Merchant search debounce 300ms，避免每次 keypress 重算大型列表
- 圖片 preview 使用 object URL，unmount 後 revoke；不上載前不轉 base64
- 圖片顯示用 `loading="lazy"`、固定 aspect ratio，避免 layout shift
- Web Vitals 目標：LCP < 2.5s、INP < 200ms、CLS < 0.1（75th percentile）

---

## 12. 測試策略

### 12.1 Unit

- Dollar string ↔ cents conversion：正常、0、負數、千位、小數位、超大值
- 香港日期／日週月 boundary formatting、`daysFromToday`
- Local repository result／error normalization
- URL filter serialize／parse
- Recurring frequency label 及 payload mapping

### 12.2 Component / integration

- Session redirect、logout、returnTo validation
- Zustand stores 的 hydration、selector、persist／migration、跨 tab logout cleanup
- Transaction form 三種 kind 的欄位切換及 validation
- UUID 唯一性同重複提交保護（create transaction／AI confirm）
- Filter、sort、pagination 與 URL 同步
- 定期交易：status tab、pause／resume／run now／skip next／delete 文案
- AI upload／parse／edit／confirm，以及每段失敗重試
- PWA：update banner、install prompt（延遲、dismiss 記憶）、offline ready
- Repository validation errors 正確套用到 form input

### 12.3 E2E critical paths

> 注意：Playwright 已列入 devDependencies，但 E2E suite 尚未實作（見 `plan.md`）。以下為目標 critical paths。

1. Register -> 自動登入 -> 看到預設現金帳戶及分類
2. 新增支出 -> Dashboard／交易列表反映結果
3. 新增轉帳 -> 報表不計入收入／支出
4. 搜尋及篩選交易 -> reload 後條件保留
5. 建立定期交易 -> pause -> resume -> run now
6. 上載單據 -> AI preview -> 修正 -> confirm
7. Logout -> private route 無法進入
8. PWA manifest、service worker、offline fallback

### 12.4 Viewport matrix

- Mobile：320×568、390×844
- Tablet：768×1024
- Desktop：1280×800、1440×900
- 每個 breakpoint 驗證無水平 overflow、無遮擋、dialog 可操作、bottom nav safe-area 正確

---

## 13. 環境與部署

```dotenv
VITE_APP_ENV=development
VITE_API_URL=http://localhost:3000
```

`VITE_API_URL` 於 Vercel project 設定為 production API origin。

- `.env.example` 只放公開設定；所有 `VITE_*` 都視為可公開，不可放 secret
- `VITE_API_URL` 是唯一必要的 build-time 變數（`VITE_APP_ENV` 目前未使用）
- **Frontend（Vercel）**：`vercel.json` 設定 `installCommand: pnpm install --frozen-lockfile`、`buildCommand: pnpm run build`、`outputDirectory: dist`
    - SPA fallback：`rewrites` 將未知路徑指向 `/index.html`（Vercel 先配對靜態檔，所以 `/assets/*`、`/sw.js` 不受影響）
    - Headers：`/sw.js`、`manifest.webmanifest`、`apple-touch-icon.png` 設 `max-age=0, must-revalidate`（否則 SW 永遠不會更新）；`/assets/*` 設 `immutable`
    - `VITE_API_URL` 需在 Vercel project 設定（production／preview）
    - 如用 `*.vercel.app` 網域，需將該 origin 加入後端 `CORS_ORIGINS`
- **Backend（Dokku）**：Rails + SQLite，release 執行 `db:prepare`；`storage/` 為持久 volume。CORS origins 見 `bin/dokku-setup.sh`
- Production build 必須有 SPA fallback，未知 route 回 `index.html`
- CI 次序：typecheck -> prettier -> unit/integration -> build（Playwright smoke 為目標，未實作）
- Production source map 如上傳 error tracker，不應公開提供

---

## 14. Definition of Done

一個 feature 只有符合以下條件才算完成：

- 實作本 spec 所列正常、loading、empty、error、offline 狀態
- Mobile、tablet、desktop layout 經實機或 Playwright screenshot 驗證
- Keyboard、screen reader labels、focus management、對比符合要求
- API input／output 全部有 TypeScript type，repository 不 throw
- 寫入操作有防重複提交；建立交易同 AI confirm 產生唯一 UUID
- Relevant unit／integration test 完成，critical flow E2E 通過
- `pnpm run build`、`tsc`、Prettier、Vitest 全部通過
- 無 console error、React warning、水平 overflow 或 UI overlap
- PWA 可安裝、更新提示正常，offline 可還原 local session／draft
- 任何 UI／行為改動已同步更新 `frontend-spec.md` 及 `plan.md`（plan 補對應 Step 或新增 Post-MVP step）

---

## 15. 前後端分工與限制

1. Frontend 只管 presentation 及 route gating；權限與資料完整性由後端負責。
2. `localStorage` 只存 session token 及 UI flag（例如 install dismiss）；`sessionStorage` 只存 draft，不將大型 base64 persist。
3. AI 辨識由後端呼叫 DeepSeek，結果只作建議，必須經人工覆核才入帳。
4. 資料存於後端 SQLite（Dokku volume）；清除 browser site data 只會登出，不會失去帳務資料。
5. 跨裝置共用同一帳戶即可看到相同資料；多人協作、server backup／recovery 不在 MVP 範圍。
6. Hard delete 不可復原，frontend 不應提供虛假 undo。
