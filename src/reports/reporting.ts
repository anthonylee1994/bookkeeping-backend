import type {Transaction} from "../database/entities/transaction.entity";

import * as time from "../common/time";

export interface Totals {
    income: number;
    expense: number;
}

export function categoryTotals(rows: Transaction[]): Map<string | null, Totals> {
    const map = new Map<string | null, Totals>();
    for (const row of rows) {
        if (row.kind === 2) {
            continue;
        }
        const entry = map.get(row.category_id) ?? {income: 0, expense: 0};
        if (row.kind === 0) {
            entry.income += row.amount_cents;
        } else if (row.kind === 1) {
            entry.expense += row.amount_cents;
        }
        map.set(row.category_id, entry);
    }
    return map;
}

export function accountTotals(rows: Transaction[]): Map<string, Totals> {
    const map = new Map<string, Totals>();
    for (const row of rows) {
        if (row.kind === 2) {
            continue;
        }
        const entry = map.get(row.account_id) ?? {income: 0, expense: 0};
        if (row.kind === 0) {
            entry.income += row.amount_cents;
        } else if (row.kind === 1) {
            entry.expense += row.amount_cents;
        }
        map.set(row.account_id, entry);
    }
    return map;
}

export function sortedCategoryRows(categoryNames: Map<string, string>, totals: Map<string | null, Totals>): Array<Record<string, unknown>> {
    return [...totals.entries()]
        .map(([categoryId, total]) => ({
            category_id: categoryId,
            name: categoryId !== null ? (categoryNames.get(categoryId) ?? null) : null,
            income_cents: total.income,
            expense_cents: total.expense,
        }))
        .sort((a, b) => {
            if (b.expense_cents !== a.expense_cents) {
                return b.expense_cents - a.expense_cents;
            }
            return b.income_cents - a.income_cents;
        });
}

export function dailyBreakdown(rows: Transaction[]): Array<Record<string, unknown>> {
    const map = new Map<string, number>();
    for (const row of rows) {
        const date = time.toDbDate(time.fromDbDatetime(row.occurred_at));
        const current = map.get(date) ?? 0;
        if (row.kind === 0) {
            map.set(date, current + row.amount_cents);
        } else if (row.kind === 1) {
            map.set(date, current - row.amount_cents);
        } else {
            map.set(date, current);
        }
    }
    return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([date, net]) => ({date, net_cents: net}));
}
