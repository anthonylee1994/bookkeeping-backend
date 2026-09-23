import {Controller, Get, Query} from "@nestjs/common";
import {InjectRepository} from "@nestjs/typeorm";
import {Between, Repository} from "typeorm";

import {CurrentUser} from "../auth/current-user.decorator";
import {ApiError} from "../common/errors";
import * as time from "../common/time";
import {clampPage, clampPerPage, totalPages} from "../common/util";
import {Transaction} from "../database/entities/transaction.entity";
import type {User} from "../database/entities/user.entity";
import {accountTotals, categoryTotals, dailyBreakdown, sortedCategoryRows} from "../reports/reporting";
import {ReportingService} from "../reports/reporting.service";
import {transactionRow} from "../views/serializers";

type Period = "daily" | "weekly" | "monthly";

function boundaries(period: Period, date: Date): {from: Date; to: Date} {
    let first: Date;
    let last: Date;
    switch (period) {
        case "weekly":
            first = time.beginningOfWeekMonday(date);
            last = time.endOfWeekMonday(date);
            break;
        case "monthly":
            first = time.beginningOfMonth(date);
            last = time.endOfMonth(date);
            break;
        case "daily":
        default:
            first = date;
            last = date;
            break;
    }
    return {from: time.beginningOfDay(first), to: time.endOfDay(last)};
}

@Controller("api/v1/summaries")
export class SummariesController {
    constructor(
        @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
        private readonly reporting: ReportingService
    ) {}

    @Get("daily")
    daily(@CurrentUser() user: User, @Query("date") date?: string, @Query("page") page?: string, @Query("per_page") perPage?: string): Promise<unknown> {
        return this.summarize(user, "daily", date, page, perPage);
    }

    @Get("weekly")
    weekly(@CurrentUser() user: User, @Query("date") date?: string, @Query("page") page?: string, @Query("per_page") perPage?: string): Promise<unknown> {
        return this.summarize(user, "weekly", date, page, perPage);
    }

    @Get("monthly")
    monthly(@CurrentUser() user: User, @Query("date") date?: string, @Query("page") page?: string, @Query("per_page") perPage?: string): Promise<unknown> {
        return this.summarize(user, "monthly", date, page, perPage);
    }

    private async summarize(user: User, period: Period, dateParam?: string, pageParam?: string, perPageParam?: string): Promise<unknown> {
        let date: Date;
        if (dateParam !== undefined && dateParam !== "") {
            const parsed = time.parseDate(dateParam);
            if (!parsed) {
                throw ApiError.invalidValue();
            }
            date = parsed;
        } else {
            date = time.today();
        }

        const {from, to} = boundaries(period, date);

        const scope = await this.transactions.find({
            where: {
                user_id: user.id,
                occurred_at: Between(time.toDbDatetime(from), time.toDbDatetime(to)),
            },
        });

        const regular = scope.filter(tx => tx.kind !== 2);
        const transfers = scope.filter(tx => tx.kind === 2);

        const income = regular.filter(tx => tx.kind === 0).reduce((sum, tx) => sum + tx.amount_cents, 0);
        const expense = regular.filter(tx => tx.kind === 1).reduce((sum, tx) => sum + tx.amount_cents, 0);

        const categoryNames = await this.reporting.loadCategoryNames(user.id);
        const byCategory = sortedCategoryRows(categoryNames, categoryTotals(regular));

        const accountNames = await this.reporting.loadAccountNames(user.id);
        const byAccount = [...accountTotals(regular).entries()]
            .map(([accountId, total]) => ({
                account_id: accountId,
                name: accountNames.get(accountId) ?? null,
                income_cents: total.income,
                expense_cents: total.expense,
            }))
            .sort((a, b) => (a.account_id < b.account_id ? -1 : a.account_id > b.account_id ? 1 : 0));

        const page = clampPage(pageParam);
        const perPage = clampPerPage(perPageParam);
        const total = regular.length;
        const ordered = [...regular].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : a.occurred_at > b.occurred_at ? -1 : 0));
        const start = (page - 1) * perPage;
        const pageRows = ordered.slice(start, start + perPage).map(transactionRow);

        return {
            data: {
                range: {
                    from: time.formatDatetimeSeconds(from),
                    to: time.formatDatetimeSeconds(to),
                },
                income_cents: income,
                expense_cents: expense,
                net_cents: income - expense,
                daily: dailyBreakdown(regular),
                by_category: byCategory,
                by_account: byAccount,
                transfers: {
                    count: transfers.length,
                    total_cents: transfers.reduce((sum, tx) => sum + tx.amount_cents, 0),
                },
                transactions: {
                    data: pageRows,
                    meta: {
                        page,
                        per_page: perPage,
                        total,
                        total_pages: totalPages(total, perPage),
                    },
                },
            },
        };
    }
}
