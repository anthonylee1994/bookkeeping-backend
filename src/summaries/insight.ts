import * as time from "../common/time";
import {sha256Hex} from "../common/util";

/** Periods supported by the deterministic summary endpoints（日／週／月）。 */
export type SummaryPeriod = "daily" | "weekly" | "monthly";

/** Periods supported by the AI insight；日報太短、冇洞察價值，所以唔支援。 */
export type InsightPeriod = "weekly" | "monthly";

export interface BreakdownRow {
    category_id: string | null;
    name: string | null;
    income_cents: number;
    expense_cents: number;
}

export interface AccountRow {
    account_id: string | null;
    name: string | null;
    income_cents: number;
    expense_cents: number;
}

export interface DailyRow {
    date: string;
    net_cents: number;
}

/** Deterministic summary payload shared by the summaries + insight endpoints. */
export interface SummaryData {
    range: {from: string; to: string};
    income_cents: number;
    expense_cents: number;
    net_cents: number;
    daily: DailyRow[];
    by_category: BreakdownRow[];
    by_account: AccountRow[];
    transfers: {count: number; total_cents: number};
    transactions: {data: unknown[]; meta: {page: number; per_page: number; total: number; total_pages: number}};
}

export function parseInsightPeriod(value: string): InsightPeriod | null {
    return value === "weekly" || value === "monthly" ? value : null;
}

/** `weekly` → the range start date, `monthly` → `YYYY-MM`. */
export function periodKey(period: InsightPeriod, range: {from: string}): string {
    const date = range.from.slice(0, 10);
    return period === "monthly" ? date.slice(0, 7) : date;
}

/** 單筆交易納入 cache 指紋嘅穩定字串（包括商戶名，令改名都失效）。 */
function transactionFingerprint(row: RawTransaction, merchantNames: Map<string, string>): string {
    const merchant = row.merchant_id == null ? "" : (merchantNames.get(row.merchant_id) ?? "");
    return `${row.occurred_at}|${row.kind}|${row.amount_cents}|${row.category_id ?? ""}|${row.merchant_id ?? ""}|${merchant}|${row.note ?? ""}`;
}

/**
 * A hash of everything that can change the numbers. Include the full period
 * row count so adds/deletes always invalidate, and the aggregates so amount /
 * category edits do too. Pagination is excluded on purpose: page 2 of the
 * transaction list describes the same period and must not spawn a new insight.
 *
 * `transactions`（整期、非分頁）用嚟捕捉 note 同商戶嘅改動；逐行資料排序後先 hash，
 * 避免 DB 回傳次序唔穩定而誤判 cache miss。
 */
export function summaryFingerprint(data: SummaryData, transactions: RawTransaction[] = [], merchantNames: Map<string, string> = new Map()): string {
    const rows = transactions.map(row => transactionFingerprint(row, merchantNames)).sort();
    const canonical = {
        range: data.range,
        income: data.income_cents,
        expense: data.expense_cents,
        net: data.net_cents,
        daily: data.daily,
        by_category: data.by_category,
        by_account: data.by_account,
        transfers: data.transfers,
        count: data.transactions.meta.total,
        rows,
    };
    return sha256Hex(JSON.stringify(canonical));
}

/** Representative date (`YYYY-MM-DD`) for the period immediately before `range.from`. */
export function previousPeriodDate(period: InsightPeriod, range: {from: string}): string {
    const start = time.parseDate(range.from.slice(0, 10));
    if (start === null) {
        return range.from.slice(0, 10);
    }
    return period === "weekly" ? time.toDbDate(time.addDays(start, -7)) : time.toDbDate(time.addMonthsClamped(start, -1));
}

function pad(value: number, length = 2): string {
    return String(value).padStart(length, "0");
}

/** HK dollars with thousands separators and two decimals, e.g. `1,234.50`. */
export function formatDollars(cents: number): string {
    const sign = cents < 0 ? "-" : "";
    const absolute = Math.abs(cents);
    const whole = Math.floor(absolute / 100).toLocaleString("en-US");
    return `${sign}${whole}.${pad(absolute % 100)}`;
}

/** Human period label used in the AI fact sheet, e.g. `2026年9月` or `2026年9月14日至9月20日`. */
export function periodLabel(period: InsightPeriod, range: {from: string; to: string}): string {
    const from = time.fromDbDate(range.from.slice(0, 10));
    const to = time.fromDbDate(range.to.slice(0, 10));
    const y = from.getUTCFullYear();
    const m = from.getUTCMonth() + 1;
    const d = from.getUTCDate();
    if (period === "weekly") {
        return `${y}年${m}月${d}日至${to.getUTCMonth() + 1}月${to.getUTCDate()}日`;
    }
    return `${y}年${m}月`;
}

export interface InsightCategoryFact {
    name: string;
    dollars: string;
    share: number;
}

export interface InsightComparison {
    incomeDollars: string;
    expenseDollars: string;
    netDollars: string;
    incomeDelta: string;
    incomeChange: number | null;
    expenseDelta: string;
    expenseChange: number | null;
    netDelta: string;
    netChange: number | null;
}

/** 期內每一筆收入／支出交易（只保留可公開嘅欄位，含商戶同用戶自己輸入嘅 note）。 */
export interface InsightTransactionFact {
    date: string;
    kind: "income" | "expense";
    name: string;
    merchant: string | null;
    dollars: string;
    note: string | null;
}

export interface InsightFacts {
    period: InsightPeriod;
    periodLabel: string;
    incomeDollars: string;
    expenseDollars: string;
    netDollars: string;
    /** 淨額 ÷ 收入，已經係整數百分比；收入為 0 時 null。 */
    savingsRate: number | null;
    /** 支出 ÷ 收入。 */
    expenseRatio: number | null;
    transactionCount: number;
    expenseCategories: InsightCategoryFact[];
    incomeCategories: InsightCategoryFact[];
    /** 首 3 大支出分類合共佔總支出幾多 %。 */
    expenseConcentration: number | null;
    transferCount: number;
    transferDollars: string;
    largestExpense: {dollars: string; name: string; date: string; share: number | null} | null;
    spendingDays: number;
    periodDays: number;
    averageDailyExpenseDollars: string | null;
    topExpenseDay: {date: string; dollars: string} | null;
    /** 期內每筆交易，按日期升序（同日保留原本次序）。 */
    transactions: InsightTransactionFact[];
    previous: InsightComparison | null;
}

export interface RawTransaction {
    kind: number;
    amount_cents: number;
    category_id: string | null;
    merchant_id?: string | null;
    occurred_at: string;
    note?: string | null;
}

/** 壓平換行／多餘空白（令每筆交易維持一行），但唔會截短內容；空字串當冇 note。 */
export function cleanNote(note: string | null | undefined): string | null {
    if (note === null || note === undefined) {
        return null;
    }
    const collapsed = note.replace(/\s+/g, " ").trim();
    return collapsed === "" ? null : collapsed;
}

function categoryFacts(rows: BreakdownRow[], kind: "income" | "expense"): InsightCategoryFact[] {
    const key = kind === "income" ? "income_cents" : "expense_cents";
    const total = rows.reduce((sum, row) => sum + row[key], 0);
    return rows
        .filter(row => row[key] > 0)
        .sort((a, b) => b[key] - a[key])
        .slice(0, 3)
        .map(row => ({
            name: row.name ?? "未分類",
            dollars: formatDollars(row[key]),
            share: total === 0 ? 0 : Math.round((row[key] / total) * 100),
        }));
}

function change(current: number, previous: number): number | null {
    if (previous === 0) {
        return null;
    }
    return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

function ratio(part: number, whole: number): number | null {
    return whole === 0 ? null : Math.round((part / whole) * 100);
}

function periodDays(range: {from: string; to: string}): number {
    const from = time.parseDate(range.from.slice(0, 10));
    const to = time.parseDate(range.to.slice(0, 10));
    if (from === null || to === null) {
        return 0;
    }
    return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

/**
 * Everything the model is allowed to say, precomputed deterministically.
 * The AI must only restate these numbers — see `insightFactSheet`.
 */
export function buildInsightFacts(period: InsightPeriod, data: SummaryData, previous: SummaryData | null, rows: RawTransaction[], merchantNames: Map<string, string> = new Map()): InsightFacts {
    const categoryNames = new Map(data.by_category.map(row => [row.category_id, row.name]));

    const expenseByDay = new Map<string, number>();
    const transactions: InsightTransactionFact[] = [];
    let largestCents = -1;
    let largest: InsightFacts["largestExpense"] = null;
    for (const row of rows) {
        if (row.kind !== 0 && row.kind !== 1) {
            continue;
        }
        const date = row.occurred_at.slice(0, 10);
        const name = categoryNames.get(row.category_id) ?? "未分類";
        const merchant = row.merchant_id == null ? null : (merchantNames.get(row.merchant_id) ?? null);
        transactions.push({date, kind: row.kind === 0 ? "income" : "expense", name, merchant, dollars: formatDollars(row.amount_cents), note: cleanNote(row.note)});

        if (row.kind !== 1) {
            continue;
        }
        expenseByDay.set(date, (expenseByDay.get(date) ?? 0) + row.amount_cents);

        if (row.amount_cents > largestCents) {
            largestCents = row.amount_cents;
            largest = {
                dollars: formatDollars(row.amount_cents),
                name,
                date,
                share: ratio(row.amount_cents, data.expense_cents),
            };
        }
    }
    transactions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    let topExpenseDay: InsightFacts["topExpenseDay"] = null;
    let topExpenseDayCents = -1;
    for (const [date, cents] of expenseByDay) {
        if (cents > topExpenseDayCents) {
            topExpenseDayCents = cents;
            topExpenseDay = {date, dollars: formatDollars(cents)};
        }
    }

    const days = periodDays(data.range);
    const expenseCategories = categoryFacts(data.by_category, "expense");
    const expenseConcentration = expenseCategories.length === 0 ? null : expenseCategories.reduce((sum, fact) => sum + fact.share, 0);

    return {
        period,
        periodLabel: periodLabel(period, data.range),
        incomeDollars: formatDollars(data.income_cents),
        expenseDollars: formatDollars(data.expense_cents),
        netDollars: formatDollars(data.net_cents),
        savingsRate: ratio(data.net_cents, data.income_cents),
        expenseRatio: ratio(data.expense_cents, data.income_cents),
        transactionCount: data.transactions.meta.total,
        expenseCategories,
        incomeCategories: categoryFacts(data.by_category, "income"),
        expenseConcentration,
        transferCount: data.transfers.count,
        transferDollars: formatDollars(data.transfers.total_cents),
        largestExpense: largest,
        spendingDays: expenseByDay.size,
        periodDays: days,
        averageDailyExpenseDollars: days === 0 ? null : formatDollars(Math.round(data.expense_cents / days)),
        topExpenseDay,
        transactions,
        previous:
            previous === null
                ? null
                : {
                      incomeDollars: formatDollars(previous.income_cents),
                      expenseDollars: formatDollars(previous.expense_cents),
                      netDollars: formatDollars(previous.net_cents),
                      incomeDelta: formatDollars(data.income_cents - previous.income_cents),
                      incomeChange: change(data.income_cents, previous.income_cents),
                      expenseDelta: formatDollars(data.expense_cents - previous.expense_cents),
                      expenseChange: change(data.expense_cents, previous.expense_cents),
                      netDelta: formatDollars(data.net_cents - previous.net_cents),
                      netChange: change(data.net_cents, previous.net_cents),
                  },
    };
}

function percent(value: number | null): string {
    return value === null ? "不適用" : `${value}%`;
}

function categoryLine(label: string, facts: InsightCategoryFact[]): string {
    if (facts.length === 0) {
        return `${label}：無`;
    }
    return `${label}（由大至小）：${facts.map(fact => `${fact.name} HK$${fact.dollars}（${fact.share}%）`).join("、")}`;
}

function comparisonLine(previous: InsightComparison): string[] {
    const signed = (value: string) => (value.startsWith("-") ? value : `+${value}`);
    const changeText = (value: number | null) => (value === null ? "不適用" : `${value > 0 ? "+" : ""}${value}%`);
    return [
        `上一期收入：HK$${previous.incomeDollars}（變化 ${signed(previous.incomeDelta)}，${changeText(previous.incomeChange)}）`,
        `上一期支出：HK$${previous.expenseDollars}（變化 ${signed(previous.expenseDelta)}，${changeText(previous.expenseChange)}）`,
        `上一期淨額：HK$${previous.netDollars}（變化 ${signed(previous.netDelta)}，${changeText(previous.netChange)}）`,
    ];
}

/**
 * Renders the fact sheet handed to DeepSeek. Every number the model is
 * permitted to mention must appear in this text — the response is rejected
 * otherwise (see `src/ai/insight.ts`). Derived ratios are precomputed here so
 * the model can reason about them without doing any maths itself.
 */
export function insightFactSheet(facts: InsightFacts): string {
    const lines = [
        `期間：${facts.periodLabel}`,
        `收入：HK$${facts.incomeDollars}`,
        `支出：HK$${facts.expenseDollars}`,
        `淨額：HK$${facts.netDollars}`,
        `儲蓄率（淨額 ÷ 收入）：${percent(facts.savingsRate)}`,
        `支出佔收入：${percent(facts.expenseRatio)}`,
        `收入及支出交易筆數：${facts.transactionCount}`,
        `有支出嘅日數：${facts.spendingDays} / ${facts.periodDays}`,
    ];
    if (facts.averageDailyExpenseDollars !== null) {
        lines.push(`平均每日支出：HK$${facts.averageDailyExpenseDollars}`);
    }
    if (facts.largestExpense !== null) {
        lines.push(`最大單筆支出：HK$${facts.largestExpense.dollars}（${facts.largestExpense.name}，${facts.largestExpense.date}，佔總支出 ${percent(facts.largestExpense.share)}）`);
    }
    if (facts.topExpenseDay !== null) {
        lines.push(`支出最多嘅一日：${facts.topExpenseDay.date}，HK$${facts.topExpenseDay.dollars}`);
    }
    lines.push(categoryLine("支出分類", facts.expenseCategories));
    if (facts.expenseConcentration !== null) {
        lines.push(`首 3 大支出分類合共佔總支出：${facts.expenseConcentration}%`);
    }
    lines.push(categoryLine("收入分類", facts.incomeCategories));
    lines.push(`轉帳：${facts.transferCount} 筆，HK$${facts.transferDollars}`);
    if (facts.transactions.length > 0) {
        lines.push(`期內交易（按時間順序，共 ${facts.transactions.length} 筆）：`);
        for (const tx of facts.transactions) {
            const merchant = tx.merchant === null ? "" : ` 商戶：${tx.merchant}`;
            const note = tx.note === null ? "" : ` 備註：${tx.note}`;
            lines.push(`${tx.date} ${tx.kind === "income" ? "收入" : "支出"} 分類：${tx.name}${merchant} HK$${tx.dollars}${note}`);
        }
    }
    if (facts.previous !== null) {
        lines.push(...comparisonLine(facts.previous));
    }
    return lines.join("\n");
}
