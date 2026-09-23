import {describe, expect, it} from "vitest";

import {allowedNumericTokens, firstDisallowedNumber, insightPrompt, normalizeNumericToken, validateInsight} from "../src/ai/insight";
import {buildInsightFacts, cleanNote, formatDollars, insightFactSheet, parseInsightPeriod, periodKey, periodLabel, previousPeriodDate, summaryFingerprint} from "../src/summaries/insight";
import type {SummaryData} from "../src/summaries/insight";

function summary(overrides: Partial<SummaryData> = {}): SummaryData {
    return {
        range: {from: "2026-09-01T00:00:00+08:00", to: "2026-09-30T23:59:59+08:00"},
        income_cents: 100_000,
        expense_cents: 40_000,
        net_cents: 60_000,
        daily: [{date: "2026-09-16", net_cents: 60_000}],
        by_category: [
            {category_id: "c1", name: "飲食", income_cents: 0, expense_cents: 40_000},
            {category_id: "c2", name: "薪金", income_cents: 100_000, expense_cents: 0},
        ],
        by_account: [{account_id: "a1", name: "現金", income_cents: 100_000, expense_cents: 40_000}],
        transfers: {count: 0, total_cents: 0},
        transactions: {data: [], meta: {page: 1, per_page: 1, total: 2, total_pages: 2}},
        ...overrides,
    };
}

const ROWS = [{kind: 1, amount_cents: 40_000, category_id: "c1", merchant_id: "m1", occurred_at: "2026-09-16 10:00:00.000", note: "同朋友食飯"}];

describe("summaries/insight (unit)", () => {
    it("parses only supported periods", () => {
        expect(parseInsightPeriod("monthly")).toBe("monthly");
        expect(parseInsightPeriod("weekly")).toBe("weekly");
        expect(parseInsightPeriod("daily")).toBeNull();
        expect(parseInsightPeriod("yearly")).toBeNull();
    });

    it("keys monthly by YYYY-MM and weekly by date", () => {
        expect(periodKey("monthly", {from: "2026-09-01T00:00:00+08:00"})).toBe("2026-09");
        expect(periodKey("weekly", {from: "2026-09-14T00:00:00+08:00"})).toBe("2026-09-14");
    });

    it("computes the previous period representative date", () => {
        expect(previousPeriodDate("weekly", {from: "2026-09-14T00:00:00+08:00"})).toBe("2026-09-07");
        expect(previousPeriodDate("monthly", {from: "2026-09-01T00:00:00+08:00"})).toBe("2026-08-01");
    });

    it("fingerprint changes with amounts and row count but ignores pagination", () => {
        const base = summaryFingerprint(summary());
        expect(summaryFingerprint(summary())).toBe(base);
        expect(summaryFingerprint(summary({income_cents: 100_001}))).not.toBe(base);
        expect(summaryFingerprint(summary({transactions: {data: [], meta: {page: 2, per_page: 25, total: 2, total_pages: 1}}}))).toBe(base);
        expect(summaryFingerprint(summary({transactions: {data: [], meta: {page: 1, per_page: 25, total: 3, total_pages: 1}}}))).not.toBe(base);
    });

    it("formats dollars and period labels", () => {
        expect(formatDollars(123_450)).toBe("1,234.50");
        expect(formatDollars(-500)).toBe("-5.00");
        expect(periodLabel("monthly", {from: "2026-09-01T00:00:00+08:00", to: "2026-09-30T23:59:59+08:00"})).toBe("2026年9月");
        expect(periodLabel("weekly", {from: "2026-09-14T00:00:00+08:00", to: "2026-09-20T23:59:59+08:00"})).toBe("2026年9月14日至9月20日");
    });

    it("builds a fact sheet containing only precomputed numbers", () => {
        const facts = buildInsightFacts("monthly", summary(), summary({income_cents: 80_000, expense_cents: 20_000, net_cents: 60_000}), ROWS, new Map([["m1", "大快活"]]));
        const sheet = insightFactSheet(facts);

        expect(sheet).toContain("收入：HK$1,000.00");
        expect(sheet).toContain("儲蓄率（淨額 ÷ 收入）：60%");
        expect(sheet).toContain("支出分類（由大至小）：飲食 HK$400.00（100%）");
        expect(sheet).toContain("最大單筆支出：HK$400.00（飲食，2026-09-16，佔總支出 100%）");
        expect(sheet).toContain("支出最多嘅一日：2026-09-16，HK$400.00");
        expect(sheet).toContain("期內交易（按時間順序，共 1 筆）：");
        expect(sheet).toContain("2026-09-16 支出 分類：飲食 商戶：大快活 HK$400.00 備註：同朋友食飯");
        expect(facts.transactions).toEqual([{date: "2026-09-16", kind: "expense", name: "飲食", merchant: "大快活", dollars: "400.00", note: "同朋友食飯"}]);
        expect(sheet).toContain("上一期收入：HK$800.00");
        expect(facts.previous?.expenseChange).toBe(100);
        expect(facts.expenseConcentration).toBe(100);
        expect(facts.averageDailyExpenseDollars).toBe("13.33");
    });

    it("lists every transaction in date order and labels uncategorised rows", () => {
        const facts = buildInsightFacts("monthly", summary(), null, [
            {kind: 1, amount_cents: 5_000, category_id: "c1", occurred_at: "2026-09-18 13:00:00.000"},
            {kind: 0, amount_cents: 100_000, category_id: null, occurred_at: "2026-09-16 09:00:00.000"},
            {kind: 2, amount_cents: 200_000, category_id: null, occurred_at: "2026-09-17 10:00:00.000"},
        ]);

        expect(facts.transactions).toEqual([
            {date: "2026-09-16", kind: "income", name: "未分類", merchant: null, dollars: "1,000.00", note: null},
            {date: "2026-09-18", kind: "expense", name: "飲食", merchant: null, dollars: "50.00", note: null},
        ]);
        expect(insightFactSheet(facts)).toContain("期內交易（按時間順序，共 2 筆）：");
    });

    it("collapses whitespace in notes without truncating", () => {
        expect(cleanNote(null)).toBeNull();
        expect(cleanNote("   ")).toBeNull();
        expect(cleanNote("  交租\n9 月  ")).toBe("交租 9 月");
        expect(cleanNote("x".repeat(500))).toBe("x".repeat(500));
    });

    it("fingerprint changes when a note or merchant changes", () => {
        const names = new Map([["m1", "大快活"]]);
        const base = summaryFingerprint(summary(), ROWS, names);
        expect(summaryFingerprint(summary(), ROWS, names)).toBe(base);
        expect(summaryFingerprint(summary(), [{...ROWS[0], note: "第二餐"}], names)).not.toBe(base);
        expect(summaryFingerprint(summary(), ROWS, new Map([["m1", "大家樂"]]))).not.toBe(base);
    });

    it("marks a largest expense as uncategorised when the row has no category", () => {
        const facts = buildInsightFacts("monthly", summary(), null, [{kind: 1, amount_cents: 100, category_id: null, occurred_at: "2026-09-16 10:00:00.000"}]);
        expect(facts.largestExpense?.name).toBe("未分類");
        expect(facts.previous).toBeNull();
    });
});

describe("ai/insight (unit)", () => {
    const factSheet = "期間：2026年9月\n收入：HK$1,000.00\n支出：HK$400.00\n淨額：HK$600.00\n收入及支出交易筆數：2";

    it("normalises thousands separators and leading zeros", () => {
        expect(normalizeNumericToken("1,200.00")).toBe("1200.00");
        expect(normalizeNumericToken("09")).toBe("9");
        expect(firstDisallowedNumber("支出 400.00", allowedNumericTokens(factSheet))).toBeNull();
    });

    it("accepts the integer form of a decimal amount", () => {
        const allowed = allowedNumericTokens(factSheet);
        expect(allowed.has("1000")).toBe(true);
        expect(firstDisallowedNumber("支出 HK$1,000", allowed)).toBeNull();
    });

    it("rejects a number that is not in the fact sheet", () => {
        const error = firstDisallowedNumber("支出 HK$999.00", allowedNumericTokens(factSheet));
        expect(error).toBe("999.00");
    });

    it("validates a well-formed response", () => {
        const allowed = allowedNumericTokens(factSheet);
        const result = validateInsight({summary: "9月收入 HK$1,000.00，支出 HK$400.00。", highlights: ["淨額 HK$600.00。"]}, allowed);
        expect("insight" in result && result.insight.text).toContain("收入");
    });

    it("rejects an invented number", () => {
        const result = validateInsight({summary: "支出 HK$999.00。"}, allowedNumericTokens(factSheet));
        expect(result).toMatchObject({error: expect.stringContaining("999.00")});
    });

    it("rejects a missing summary", () => {
        expect(validateInsight({highlights: []}, new Set())).toMatchObject({error: expect.stringContaining("summary")});
    });

    it("caps the number of highlights", () => {
        const allowed = allowedNumericTokens(factSheet);
        const result = validateInsight({summary: "支出 HK$400.00。", highlights: ["a", "b", "c", "d", "e", "f"]}, allowed);
        expect("insight" in result && result.insight.highlights).toHaveLength(3);
    });

    it("keeps long summary and highlights in full without truncating", () => {
        const allowed = allowedNumericTokens(factSheet);
        const longHighlight = `支出 HK$400.00。${"額外觀察".repeat(60)}`;
        const longSummary = `支出 HK$400.00。${"總結內容".repeat(80)}`;
        const result = validateInsight({summary: longSummary, highlights: [longHighlight]}, allowed);

        expect("insight" in result && result.insight.text).toBe(longSummary);
        expect("insight" in result && result.insight.highlights[0]).toBe(longHighlight);
    });

    it("prompt asks for JSON with summary and highlights", () => {
        const prompt = insightPrompt(factSheet);
        expect(prompt).toContain("summary");
        expect(prompt).toContain("highlights");
        expect(prompt).toContain(factSheet);
    });
});
