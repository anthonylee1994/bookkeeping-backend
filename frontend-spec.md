# 記帳 App Frontend Spec

## 0. 文件目的

本文件定義記帳 App frontend 第一版（MVP）嘅產品範圍、資訊架構、互動、PWA 行為、responsive 規則同驗收標準。呢個版本係 pure frontend prototype，資料由本地 repository／mock fixtures 提供，唔依賴 Rails API。

### 0.1 產品目標

- 令用戶可以用手機快速記一筆收入、支出或轉帳
- 一眼睇到本月收支、帳戶餘額、分類分佈同最近交易
- 支援搜尋、篩選、修改、複製、退款同刪除交易
- 支援單據拍攝／上載、AI 辨識、人工覆核後入帳
- 支援定期交易同日／週／月報表
- 可安裝成 PWA，於 iOS、Android 同 desktop browser 使用

### 0.2 非目標（MVP）

- 多用戶共享帳簿、家庭帳戶或權限管理
- 多貨幣換算；UI 只支援 HKD
- 真實帳戶驗證、跨裝置同步、忘記密碼
- 背景同步或雲端 backup
- Push notification
- CSV／銀行月結單匯入

### 0.3 基本假設

- 顯示語言為繁體中文（香港），預留 i18n 結構但 MVP 不提供語言切換
- 時區固定為 `Asia/Hong_Kong`
- 金額以 integer cents 儲存；frontend 不使用浮點數做金額運算
- 日期格式顯示為 `YYYY年M月D日`，時間使用 24 小時制
- 所有資料操作經 typed local repository 完成

---

## 1. 技術棧

### 1.1 Core

| 用途                  | 選擇                                 |
| --------------------- | ------------------------------------ |
| Build tool            | Vite                                 |
| UI                    | React + TypeScript（strict mode）    |
| Styling               | Tailwind CSS                         |
| Routing               | React Router                         |
| App state              | Zustand                              |
| Local persistence      | `localStorage`／`sessionStorage`    |
| Form                  | React Hook Form + Zod                |
| PWA                   | `vite-plugin-pwa`（Workbox）         |
| Icons                 | Lucide React                         |
| Charts                | Recharts                             |
| Date                  | date-fns                             |
| Unit / component test | Vitest + React Testing Library        |
| E2E                   | Playwright                           |

Required frontend dependency:

```bash
npm install zustand
```

Use Zustand's `create` function with `persist` for the explicitly listed local slices. Do not add a remote data cache.

### 1.2 Coding conventions

- `import React` 必須為 React／TSX 檔第一個 import
- Component 使用 named export：`export const ComponentName`
- Hook 使用 function declaration：`export function useSomething()`
- 使用 `<React.Fragment>`，不使用 fragment shorthand
- 使用 `React.useState()`、`React.useEffect()` 等 namespace API
- Component 內 event handler 用一般 arrow function，除非有實測需要，否則不加 `React.useCallback()`
- 非 component／hook function 使用 function declaration
- 如建立新 project，入口 component 檔名為 `app.tsx`，並使用 `export const App`
- `.less` 不在本專案使用；如將來需要引入，import 必須放於所有 import 最後
- 不使用 `any`；fixture、form input、local query params 全部有明確型別
- 金額轉換集中於 `lib/money.ts`，日期／時區轉換集中於 `lib/date.ts`
- 所有 app data 同 UI state 都由 Zustand／local repository 管理；唔引入 remote data cache

### 1.3 建議目錄

```text
src/
  app.tsx
  main.tsx
  routes/
  components/
    ui/
    layout/
  features/
    auth/
    dashboard/
    transactions/
    receipt-scan/
    summaries/
    recurring-rules/
    accounts/
    categories/
    merchants/
  data/
    fixtures.ts
    repository.ts
    types.ts
  stores/
    auth-store.ts
    ui-store.ts
    draft-store.ts
  hooks/
  lib/
  assets/
  styles/
  test/
```

Feature 內可再分 `components/`、`hooks/`、`repository.ts`、`schema.ts` 同 `types.ts`。共用 UI 只放真正跨 feature 重用嘅 primitive，避免過早抽象。

---

## 2. 視覺與體驗方向

### 2.1 原則

- Mobile-first，主要操作可以單手完成
- 財務資料要安靜、清晰、易掃描；避免大量裝飾卡片同過度漸變
- 收入、支出、退款除咗顏色，必須同時用正負號、文字或 icon 區分
- 主要新增交易按鈕固定容易觸及，但不可遮住內容或 bottom navigation
- 所有破壞性操作都要明確講清楚影響，確認後先執行

### 2.2 Design tokens

- Background：neutral 50；surface：white；主要文字：neutral 950
- Primary action：emerald 700；focus ring：emerald 500
- Income：emerald；expense：rose；transfer：blue；refund：amber
- Border radius：輸入框／按鈕 6px，card 最多 8px
- Touch target：最少 `44px × 44px`
- Body text：最少 16px；secondary text 最少 14px
- Desktop content max width：`1280px`
- 所有 letter spacing 保持 `0`

### 2.3 金額顯示

- 顯示：`HK$1,234.50`
- 收入：`+HK$1,234.50`
- 支出：`-HK$1,234.50`
- 退款：`+HK$123.45 退款`
- 輸入欄顯示 dollar value，提交前用字串精確轉成 cents
- 不容許負數、零、超過兩位小數、科學記數法

---

## 3. Responsive Layout

Tailwind breakpoint 採用預設值，但 layout 以內容需要而非指定裝置名稱設計。

| Viewport       | Navigation             | Content                                       |
| -------------- | ---------------------- | --------------------------------------------- |
| `< 768px`      | 底部 5-item navigation | 單欄、全寬表單、filter 用 bottom sheet        |
| `768px–1023px` | 可收合左側 navigation  | 1–2 欄、modal 最大 640px                      |
| `>= 1024px`    | 固定左側 navigation    | Dashboard grid、交易 table、右側 detail panel |

### 3.1 Mobile

- Header 高 56px，尊重 `env(safe-area-inset-top)`
- Bottom navigation 包括：首頁、交易、掃描、報表、設定
- 「掃描」置中並以相機 icon 表達，但保持同其他項目一致嘅 navigation semantics
- Page bottom padding 包括 navigation 高度同 `env(safe-area-inset-bottom)`
- 新增交易用右下角 floating action button；必須置於 bottom navigation 上方
- 長表格改用 list row；主要資料先顯示，次要資料可展開

### 3.2 Tablet / Desktop

- 左側 navigation：首頁、交易、掃描單據、報表、定期交易、設定
- Top bar 放頁面標題、日期範圍同 contextual actions
- 交易列表使用 table；點擊 row 開右側 detail panel，保留列表位置
- 表單 create/edit 使用 modal 或右側 drawer，唔跳離當前工作脈絡

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
/scan                          私有：AI 單據流程
/summaries                     私有：報表
/recurring-rules               私有：定期交易
/settings                      私有：設定首頁
/settings/accounts             私有：帳戶
/settings/categories           私有：分類
/settings/merchants            私有：商戶
*                              404
```

- 未登入進入 private route：redirect `/login?returnTo=<path>`
- 已登入進入 `/login` 或 `/register`：redirect `/`
- Reload private route 先顯示全頁 loading，透過 `GET /me` 驗證 token，期間不可閃出 login page
- 只接受站內 `returnTo` path，防止 open redirect
- Browser back 必須可以關閉 modal／drawer 或返回上一步

---

## 5. 頁面規格

### 5.1 登入／註冊

欄位：username、password；註冊頁另有確認密碼，全部只作本地驗證。

- Username 必填，trim 後送出
- Password 必填；註冊最少 8 字元
- Password field 有顯示／隱藏切換
- Submit 中 disable 重複提交，顯示 inline progress
- 登入失敗顯示一般化錯誤，不透露 username 是否存在
- 成功後儲存本地 session、寫入 user state、redirect `returnTo` 或 `/`
- 登出清除本地 session 同敏感 UI state，再去 `/login`

### 5.2 Dashboard `/`

預設顯示當月，可用上／下月按鈕改變 `date`。

內容次序：

1. 本月淨額、收入、支出、退款
2. 快速新增交易、掃描單據
3. 支出分類 chart（Top 5）
4. 帳戶餘額
5. 未來 7 日定期交易
6. 最近 10 筆交易

規則：

- Mobile 金額摘要使用緊湊 2-column grid；desktop 可用 4 columns
- Pie／donut chart 同時提供 legend、實際金額同可讀 table，唔可以只靠顏色
- Empty state 提供「新增第一筆交易」主動作
- 點擊分類、帳戶或最近交易，進入已套用 filter 嘅交易頁或交易詳情

### 5.3 交易列表 `/transactions`

支援：

- 日期由／至
- 類型：全部、收入、支出、轉帳
- 帳戶、分類、商戶
- 關鍵字搜尋 note、payment method、merchant name
- 最低／最高金額
- 排序：日期、金額、建立時間；升序／降序
- Pagination，每頁預設 25，desktop 可選 25／50／100

互動：

- Filter 同 sort 同步 URL query，reload／分享 URL 可還原狀態
- Mobile 顯示交易 row：商戶或 note、分類、日期、帳戶、金額
- Desktop 顯示 table：日期、商戶／備註、分類、帳戶、類型、金額、actions
- Refund transaction 顯示「退款」標記；原交易顯示 `net_amount_cents`
- 頁碼改變時保留 filter，並 scroll 到列表頂
- Loading 使用固定尺寸 skeleton，避免 layout jump
- No result state 提供清除 filter

### 5.4 新增／修改交易

第一步用 segmented control 選收入、支出、轉帳。欄位按類型改變：

| 欄位     | 收入／支出                 | 轉帳                 |
| -------- | -------------------------- | -------------------- |
| 金額     | 必填                       | 必填                 |
| 帳戶     | 必填                       | 必填（轉出）         |
| 轉入帳戶 | 不顯示                     | 必填且不可與轉出相同 |
| 分類     | 可選，按 kind 過濾         | 不顯示               |
| 商戶     | 可選 autocomplete          | 不顯示               |
| 日期時間 | 必填，預設現在             | 必填，預設現在       |
| 付款方式 | 可選                       | 可選                 |
| 備註     | 可選                       | 可選                 |
| 圖片     | 可選，顯示已有 URL preview | 可選                 |

- Merchant autocomplete debounce 300ms；輸入新名稱時可建立 merchant，再選回表單
- 選擇有 default category 嘅 merchant，可自動建議分類，但不可無提示覆蓋用戶已選值
- Create 每次開表單產生 UUID；寫入 local repository 後同步更新相關 view
- Edit 不可改變 `source`，亦不可直接建立 `refund_of_id`
- 離線時 disable submit，保留尚未送出嘅 form state，提示連線恢復後手動提交
- 離開 dirty form 前顯示確認

### 5.5 交易詳情

顯示所有可用資料、單據圖、source、建立／更新時間、原始金額同扣除退款後淨額。

Actions：修改、複製、退款、刪除。

- 轉帳不可退款
- 可退款上限為原交易金額減已退款總額
- 全數退回後 disable 退款 action
- 複製成功後打開新交易詳情；複製記錄日期預設為現在
- 刪除確認要指出關聯 refund 亦會被刪除；成功返回列表
- 單據圖可放大查看，失效時顯示 fallback，不重試無限次

### 5.6 AI 單據 `/scan`

流程：`選圖／拍攝 -> 本地解析 mock -> 人工覆核 -> 確認入帳`。

1. 使用 `<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment">`
2. Frontend 驗證類型同 10 MiB 上限，顯示本地 preview
3. 將圖片存入本地 workflow，顯示可取消嘅 progress UI
4. 使用 deterministic fixture 產生 AI parse preview
5. 將 `parsed` 結果填入可修改表單；confidence 低或缺失欄位要明顯標示需要覆核
6. 用戶補回 account／category／merchant，再由 local repository 入帳

確認時儲存修正後交易欄位同 `image_urls`，並使用本地 UUID 防止重複提交。AI mock 失敗時保留圖片，提供重試解析或轉為手動入帳。

### 5.7 報表 `/summaries`

- Period segmented control：日、週、月
- 日期 picker 配合上一期／下一期
- 顯示收入、支出、退款、淨額、分類分佈、帳戶分佈、轉帳摘要、期內交易
- Weekly 清楚顯示星期一至星期日範圍
- 轉帳獨立顯示，不計入收入／支出／淨額
- Chart tooltip 可用 keyboard 觸發；旁邊提供資料表
- URL 保存 `period`、`date`、`page`

### 5.8 定期交易 `/recurring-rules`

列表分 active、paused、ended tabs。每項顯示類型、金額、頻率、下一次日期、帳戶、分類／商戶同狀態。

Create／edit 欄位：

- 類型（收入／支出）、金額、帳戶、分類、商戶、備註
- 頻率：每日、每週、每月、每年
- 間隔 `interval`，預設 1
- 每週：`day_of_week`（0–6，UI 顯示日–六）
- 每月：`day_of_month`（1–31）
- 每年：`month_of_year`（1–12）及 `day_of_month`
- 開始日、可選結束日
- `next_run_at` 由開始日產生；送出時使用香港時區 ISO datetime

Actions：pause、resume、run now、skip next、edit、delete。

- `run now` 前確認，成功後顯示已建立交易入口
- 409 `already_materialized` 顯示「今日已經產生過交易」
- `skip next` 確認文案列出將被跳過日期
- 刪除只刪 rule，已產生交易會保留；確認文案必須講明

### 5.9 設定

#### 帳戶

- List 顯示名稱、類型、icon、color、初始餘額、幣別
- Create／edit：name、kind、icon、color、initial balance；currency 固定 HKD
- 刪除時如帳戶仍被交易或定期交易使用，顯示清晰阻止原因

#### 分類

- Income／expense tabs；按 `position` 排序
- Create／edit：name、kind、icon、color、position
- 刪除前提示歷史交易會保留，但分類會變成未分類
- MVP 不做 drag-and-drop；用 position numeric control 調整次序

#### 商戶

- 可搜尋／建立／刪除，顯示 default category 同使用次數
- MVP 暫不提供商戶修改
- 刪除前提示歷史交易會保留，但商戶會被清空

---

## 6. 本地資料與狀態

### 6.1 Local repository 規則

- 所有 domain data 由 `data/repository.ts` 管理，初始資料來自 typed fixtures
- CRUD、搜尋、排序、分頁、summary 同 recurring 計算喺 browser 內完成
- repository functions 必須係純同步、可測試；唔可以直接依賴 React component
- local persistence 使用 `localStorage`；session／draft 使用 `sessionStorage`
- 讀取或寫入失敗時顯示本地錯誤狀態，唔模擬 remote HTTP status

### 6.2 Core TypeScript types

```ts
export type UUID = string;
export type Currency = "HKD";
export type TransactionKind = "income" | "expense" | "transfer";
export type TransactionSource = "manual" | "recurring" | "ai" | "import";
export type AccountKind =
  | "cash"
  | "bank"
  | "credit_card"
  | "e_wallet"
  | "other";
export type RecurringFrequency = "daily" | "weekly" | "monthly" | "yearly";
export type RecurringStatus = "active" | "paused" | "ended";

export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}
```

完整 domain type 應由 `data/types.ts` 定義；fixtures 必須通過同一套 schema validation，確保 UI 測試資料同 production shape 一致。

### 6.3 Local selectors

```text
useAppStore((state) => state.transactions)
useAppStore((state) => state.accounts)
useAppStore((state) => state.categories)
useAppStore((state) => state.recurringRules)
```

Selector 只讀取需要嘅 slice；資料寫入後由 store action 更新單一 source of truth，唔建立 duplicated cache。

### 6.4 Zustand state management

Zustand 管理全部 frontend app state；React Hook Form 管理表單暫態，URL 管理可分享 filter state。

#### State ownership

| State 類型                | Owner                      | 例子                                                                                                       |
| ------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Local domain state        | `appStore`                 | transactions、dashboard、accounts、categories、summaries、recurring rules、loading／error／pagination data |
| URL state                 | React Router search params | transaction filters、sort、page、summary period/date、returnTo                                             |
| Form state                | React Hook Form            | transaction／account／category／recurring rule／AI confirm 欄位、dirty／validation state                   |
| Session state             | `authStore`                | token、minimal user payload、hydrated、logout                                                              |
| UI state                  | `uiStore`                  | mobile nav、drawer／dialog、toast queue、offline flag、install prompt                                      |
| Temporary workflow／draft | `draftStore`               | transaction draft、AI scan step、uploaded image URL、AI preview                                            |

#### Store contract

建議建立以下 typed stores（檔案放 `src/stores/`）：

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
  setMobileNavOpen: (open: boolean) => void;
  setActiveDialog: (dialog: string | null) => void;
  setOffline: (offline: boolean) => void;
};

type DraftState = {
  transactionDraft: TransactionDraft | null;
  aiScan: AiScanDraft | null;
  setTransactionDraft: (draft: TransactionDraft | null) => void;
  setAiScan: (draft: AiScanDraft | null) => void;
  resetDrafts: () => void;
};
```

實際 type 要放 `data/types.ts` 或 feature type file，以上只係 ownership contract；不得用 `any` 或自由格式 object。

#### Rules

- 使用 Zustand selectors 讀取最小片段，例如 `useAuthStore((state) => state.token)`；避免 component 直接訂閱整個 store。
- Store action 用同步、可測試嘅 state transition；所有 repository operation 由 feature hook 呼叫，唔將 component-specific logic 寫入 generic store。
- `authStore` 用 `persist` middleware 存本地 user session 到 `localStorage`，並設定 version／migration。密碼同單據原圖絕不 persist。
- App 啟動先 hydrate local stores，再由 route guard 決定是否顯示 login；hydration 完成前不可 redirect，避免 login page 閃現。
- `uiStore` 不需要持久化；`isOffline` 由 `navigator.onLine` 同 `online`／`offline` events 更新。
- `draftStore` 只 persist 可序列化 draft 欄位到 `sessionStorage`（例如 `transactionDraft`、AI step、URL）；`File`、Blob、object URL 不可 persist，離開頁面或 reload 要清理無效 preview。
- AI preview 入帳成功、交易提交成功、登出或切換 session 後，必須呼叫 `resetDrafts()`；object URL 要另外 `URL.revokeObjectURL()`。
- Logout 流程要原子地 `authStore.clearSession()`、`draftStore.resetDrafts()`，再導向 `/login`。
- 不可將 filters、pagination、selected date 同時放 Zustand 又放 URL；URL 是可分享頁面 state 嘅唯一 source of truth。
- Store state 要保持可序列化，方便 devtools、測試同跨 tab 行為；禁止將 React element、Promise、AbortController 放入 store。
- 需要跨 tab 登出時監聽 `storage` event；收到 session 清除後，其他 tab 同步清 local stores 同回到 login。

#### Testing

- 每個 store 有獨立 Vitest 測試，覆蓋 initial state、action、reset、persist hydration／migration 同 logout cleanup。
- Component test 要驗證 selector 只因相關 slice 改變而 rerender；不得靠 implementation detail 直接改 store 內部 object。

### 6.5 Local repository contract

Repository 必須提供 typed functions，覆蓋 auth、dashboard、transactions、accounts、categories、merchants、receipts、AI preview、summaries 同 recurring rules。每個 function 只更新 local store／persistence，唔發出 network request。

Prototype 可用 deterministic fixtures 起步；使用者新增、修改、刪除嘅資料要即時反映喺所有相關 view，reload 後由 local persistence 還原。

---

## 7. Auth 與安全

- Prototype auth 只係本地 session gate，唔係真正身份驗證，唔可聲稱具備 production security
- 所有可插入 UI 嘅 fixture/user text 經 React escaping；不使用 `dangerouslySetInnerHTML`
- Content Security Policy 至少限制 `default-src 'self'`，並按圖片 host 同 dev server 需要開放 `img-src`
- Production 只使用 HTTPS；service worker 只於 production 或 localhost 啟用
- 登出或切換本地 session 時清除 Zustand auth／draft state、AI preview、draft 同圖片 object URL
- 不在 console、analytics、error tracking 記錄密碼、完整單據圖 URL 或完整 local data snapshot
- `returnTo`、external image URL 同 local error message 不可直接變成 executable URL／HTML

---

## 8. PWA 規格

### 8.1 Manifest

- `name`、`short_name`、description 使用繁體中文
- `display: standalone`
- `start_url: /`
- `scope: /`
- `theme_color` 同 app header 一致
- `background_color` 使用 neutral background
- 提供 192×192、512×512 maskable icon，同 Apple touch icon
- App icon 要係正式 bitmap asset，不使用臨時 Vite logo

### 8.2 Service worker / caching

- Precache hashed JS、CSS、fonts、icons 同 offline fallback shell
- Navigation 採 Network First，有短 timeout，失敗先回 app shell
- Local domain data 唔寫入 Cache Storage；只可經指定 browser storage persistence
- Receipt fixture images 不 precache；browser 自然 cache 已足夠
- 新版本採 prompt update：顯示「有新版本」toast，由用戶按「重新載入」套用
- 不可在用戶填緊表單時自動 reload

### 8.3 Offline UX

- 全局顯示低干擾 offline banner
- 已載入且仍在 memory 嘅資料可繼續查看，標示「資料可能未更新」
- Reload 後無網絡仍可由 local persistence 還原資料；需要外部圖片或 AI mock asset 時顯示 unavailable fallback
- Create、edit、delete、refund、duplicate 同 recurring actions 離線照常運作
- Draft form 可存於 session storage；唔需要 background sync

### 8.4 Install UX

- Android／desktop 捕捉 `beforeinstallprompt`，只喺用戶有互動並使用 app 一段時間後顯示一次安裝入口
- iOS 提供簡短「加入主畫面」指引，但只在 Safari 且未 standalone 時顯示
- 已安裝或用戶 dismiss 後，不反覆彈出提示

---

## 9. Loading、Empty、Error 與 Feedback

- 首次 page load：用與最終 layout 同尺寸 skeleton
- 寫入操作：按鈕內 progress，disable 同一 action；頁面其餘安全操作可繼續
- 成功 create/update/delete：toast 簡短確認，重要結果同時反映於頁面
- Validation：欄位下方錯誤 + form summary；focus 第一個錯誤欄位
- Empty state 要分「完全冇資料」同「filter 無結果」
- 全頁 fatal error 提供重設本地資料、返回首頁等復原入口
- 使用 Error Boundary 隔離 route-level render error
- Toast 使用 `aria-live="polite"`；阻塞錯誤使用 `role="alert"`

---

## 10. Accessibility

最低要求 WCAG 2.2 AA：

- 全部操作可用 keyboard 完成，focus 順序合理且 focus ring 清晰
- Modal／drawer 有 focus trap、Escape 關閉、關閉後 focus 返回觸發元素
- Icon-only button 有 accessible name 同 tooltip
- Form 每個 input 有 persistent label；唔以 placeholder 代替 label
- Error 透過 `aria-describedby` 連到欄位
- Segmented control、tabs、menu 使用正確 ARIA pattern
- 色彩對比達 AA；狀態不可只靠顏色
- 支援 200% text zoom，不截斷必要操作
- 尊重 `prefers-reduced-motion`；動畫不可影響理解或操作
- Chart 必須有等價文字／table 資料

---

## 11. Performance

- Route-level code splitting；Recharts、AI scan 等較重 feature lazy load
- 首頁 critical bundle gzip 目標 `< 200 KiB`（不含 lazy chunks）
- 大量 transaction 使用 client-side pagination／virtualization，避免一次 render 全部資料
- Merchant search debounce 300ms，避免每次 keypress 重算大型列表
- 圖片 preview 使用 object URL，unmount 後 revoke；不上載前不轉 base64
- 圖片顯示用 `loading="lazy"`、固定 aspect ratio，避免 layout shift
- Web Vitals 目標：LCP < 2.5s、INP < 200ms、CLS < 0.1（75th percentile）

---

## 12. 測試策略

### 12.1 Unit

- Dollar string ↔ cents conversion：正常、0、負數、千位、小數位、超大值
- 香港日期／日週月 boundary formatting
- Local repository error normalization
- URL filter serialize／parse
- Recurring frequency label 同 payload mapping

### 12.2 Component / integration

- Local session redirect、logout、returnTo validation
- Zustand stores 嘅 hydration、selector、persist／migration、跨 tab logout cleanup
- Transaction form 三種 kind 嘅欄位切換同 validation
- Local UUID 唯一性同重複提交保護
- Filter、sort、pagination 與 URL 同步
- Refund 上限、轉帳不可退款、delete confirmation
- AI upload／parse／edit／confirm，以及每段失敗重試
- Offline 時 local CRUD 照常運作
- Repository validation errors 正確落到 form input

### 12.3 E2E critical paths

1. Register -> 自動登入 -> 見到預設現金帳戶及分類
2. 新增支出 -> Dashboard／交易列表反映結果
3. 新增轉帳 -> 報表不計入收入／支出
4. 搜尋及篩選交易 -> reload 後條件保留
5. 部分退款 -> 原交易 net amount 同 summary 更新
6. 建立定期交易 -> pause -> resume -> run now
7. 上載單據 -> AI preview -> 修正 -> confirm
8. Logout -> private route 無法進入
9. PWA manifest、service worker、offline fallback

### 12.4 Viewport matrix

- Mobile：320×568、390×844
- Tablet：768×1024
- Desktop：1280×800、1440×900
- 每個 breakpoint 驗證無水平 overflow、無遮擋、dialog 可操作、bottom nav safe-area 正確

---

## 13. 環境與部署

```dotenv
VITE_APP_ENV=development
```

- `.env.example` 只放公開設定；所有 `VITE_*` 都視為可公開，不可放 secret
- Production build 必須有 SPA fallback，未知 route 回 `index.html`
- 部署時 frontend origin、asset URL 同 CSP 要一致
- CI 次序：typecheck -> lint -> unit/integration -> build -> Playwright smoke
- Production source map 如上傳 error tracker，唔應公開提供

---

## 14. Definition of Done

一個 feature 只有符合以下條件先算完成：

- 實作本 spec 所列正常、loading、empty、error、offline 狀態
- Mobile、tablet、desktop layout 經實機或 Playwright screenshot 驗證
- Keyboard、screen reader labels、focus management、對比符合要求
- Local domain data、repository input／output 全部有 TypeScript type
- 寫入操作有防重複提交；建立交易同 AI confirm 產生唯一 UUID
- Relevant unit／integration test 完成，critical flow E2E 通過
- `npm run build`、typecheck、lint、test 全部通過
- 無 console error、React warning、水平 overflow 或 UI overlap
- PWA 可安裝、更新提示正常，offline 可還原 local data

---

## 15. Pure frontend 限制／開發前要留意

1. 本地 auth 只供 prototype route gating，唔提供真正安全邊界。
2. `localStorage` 容量有限，單據圖片只保留 object URL／fixture URL，唔將大型 base64 persist。
3. AI 辨識使用 deterministic mock result，唔聲稱係真實 OCR／AI output。
4. 資料只存在當前 browser profile，清除 site data 會失去所有變更。
5. 跨裝置同步、多人協作、server backup 同 recovery 不在 MVP 範圍。
6. Hard delete 不可復原，frontend 不應提供虛假 undo。
