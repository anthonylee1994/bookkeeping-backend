import {Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, RawBodyRequest, Req, Res} from "@nestjs/common";
import {InjectRepository} from "@nestjs/typeorm";
import type {Request, Response} from "express";
import {Between, DataSource, FindOptionsOrder, FindOptionsWhere, In, LessThanOrEqual, Like, MoreThanOrEqual, Repository} from "typeorm";

import {CurrentUser} from "../auth/current-user.decorator";
import {datetimeRange} from "../common/datetime-range";
import {ApiError} from "../common/errors";
import {JsonObject} from "../common/params";
import * as time from "../common/time";
import {clampPage, clampPerPage, jsonParse, newId, totalPages} from "../common/util";
import {AiImportLog} from "../database/entities/ai-import-log.entity";
import {Merchant} from "../database/entities/merchant.entity";
import {RecurringOccurrence} from "../database/entities/recurring-occurrence.entity";
import {Transaction} from "../database/entities/transaction.entity";
import type {User} from "../database/entities/user.entity";
import {IdempotencyService} from "../idempotency/idempotency.service";
import {parseTransactionKind} from "../views/enums";
import {transactionPayload} from "../views/serializers";
import {TransactionsService} from "./transactions.service";

function parseAmount(value: string): number {
    const trimmed = value.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
        throw ApiError.invalidValue();
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isNaN(parsed)) {
        throw ApiError.invalidValue();
    }
    return parsed;
}

@Controller("api/v1/transactions")
export class TransactionsController {
    constructor(
        @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
        @InjectRepository(Merchant) private readonly merchants: Repository<Merchant>,
        private readonly dataSource: DataSource,
        private readonly transactionsService: TransactionsService,
        private readonly idempotency: IdempotencyService
    ) {}

    private async findScoped(userId: string, id: string): Promise<Transaction> {
        const transaction = await this.transactions.findOne({where: {id, user_id: userId}});
        if (!transaction) {
            throw ApiError.notFound();
        }
        return transaction;
    }

    @Get()
    async index(
        @CurrentUser() user: User,
        @Query("from") from?: string,
        @Query("to") to?: string,
        @Query("kind") kind?: string,
        @Query("category_id") categoryId?: string,
        @Query("account_id") accountId?: string,
        @Query("merchant_id") merchantId?: string,
        @Query("q") q?: string,
        @Query("min_amount") minAmount?: string,
        @Query("max_amount") maxAmount?: string,
        @Query("sort") sort?: string,
        @Query("page") page?: string,
        @Query("per_page") perPage?: string
    ): Promise<unknown> {
        const base: FindOptionsWhere<Transaction> = {user_id: user.id};
        const pageNumber = clampPage(page);
        const perPageNumber = clampPerPage(perPage);

        if (from !== undefined && to !== undefined) {
            const fromDate = time.parseDatetime(from);
            const toDate = time.parseDatetime(to);
            if (!fromDate || !toDate) {
                throw ApiError.invalidValue();
            }
            base.occurred_at = datetimeRange(time.beginningOfDay(fromDate), time.endOfDay(toDate));
        }

        if (kind !== undefined && kind !== "") {
            const parsed = parseTransactionKind(kind);
            if (parsed === null) {
                return emptyPage(pageNumber, perPageNumber);
            }
            base.kind = parsed;
        }

        if (categoryId !== undefined && categoryId !== "") base.category_id = categoryId;
        if (accountId !== undefined && accountId !== "") base.account_id = accountId;
        if (merchantId !== undefined && merchantId !== "") base.merchant_id = merchantId;

        if (minAmount !== undefined && minAmount !== "") {
            const min = parseAmount(minAmount);
            base.amount_cents = maxAmount !== undefined && maxAmount !== "" ? Between(min, parseAmount(maxAmount)) : MoreThanOrEqual(min);
        } else if (maxAmount !== undefined && maxAmount !== "") {
            base.amount_cents = LessThanOrEqual(parseAmount(maxAmount));
        }

        let where: FindOptionsWhere<Transaction> | FindOptionsWhere<Transaction>[] = base;
        if (q !== undefined && q !== "") {
            const matched = await this.merchants.find({
                where: {user_id: user.id, name: Like(`%${q}%`)},
                select: {id: true},
            });
            const or: Array<FindOptionsWhere<Transaction>> = [{note: Like(`%${q}%`)}, {payment_method: Like(`%${q}%`)}];
            if (matched.length > 0) {
                or.push({merchant_id: In(matched.map(merchant => merchant.id))});
            }
            where = or.map(condition => ({...base, ...condition}));
        }

        const {column, descending} = parseSort(sort);
        const order = {[column]: descending ? "DESC" : "ASC"} as FindOptionsOrder<Transaction>;

        const total = await this.transactions.count({where});
        const rows = await this.transactions.find({
            where,
            order,
            skip: (pageNumber - 1) * perPageNumber,
            take: perPageNumber,
        });

        return {
            data: rows.map(transactionPayload),
            meta: {
                page: pageNumber,
                per_page: perPageNumber,
                total,
                total_pages: totalPages(total, perPageNumber),
            },
        };
    }

    @Post()
    @HttpCode(201)
    async create(@CurrentUser() user: User, @Req() request: RawBodyRequest<Request>, @Res() response: Response): Promise<void> {
        const raw = request.rawBody ?? Buffer.from("");
        const header = request.headers["idempotency-key"];
        const idempotencyKey = Array.isArray(header) ? (header[0] ?? null) : (header ?? null);

        const result = await this.idempotency.wrap({
            userId: user.id,
            method: "POST",
            path: "/api/v1/transactions",
            rawBody: raw,
            idempotencyKey,
            run: async () => {
                const body = jsonParse<JsonObject>(raw.toString("utf8"), {});
                const transaction = await this.transactionsService.createValidated(user.id, body);
                await this.transactionsService.incrementMerchantUsage(transaction);
                return {status: 201, body: {data: transactionPayload(transaction)}};
            },
        });

        response.status(result.status).json(result.body);
    }

    @Get(":id")
    async show(@CurrentUser() user: User, @Param("id") id: string): Promise<unknown> {
        const transaction = await this.findScoped(user.id, id);
        return {data: transactionPayload(transaction)};
    }

    @Patch(":id")
    async update(@CurrentUser() user: User, @Param("id") id: string, @Body() body: JsonObject): Promise<unknown> {
        const transaction = await this.findScoped(user.id, id);
        const updated = await this.transactionsService.updateValidated(user.id, transaction, body);
        return {data: transactionPayload(updated)};
    }

    @Delete(":id")
    @HttpCode(204)
    async destroy(@CurrentUser() user: User, @Param("id") id: string): Promise<void> {
        const transaction = await this.findScoped(user.id, id);
        const now = time.toDbDatetime(time.nowLocal());
        await this.dataSource.transaction(async manager => {
            await manager.update(RecurringOccurrence, {transaction_id: transaction.id}, {transaction_id: null, updated_at: now});
            await manager.update(AiImportLog, {transaction_id: transaction.id}, {transaction_id: null, updated_at: now});
            await manager.delete(Transaction, {id: transaction.id});
        });
    }

    @Post(":id/duplicate")
    async duplicate(@CurrentUser() user: User, @Param("id") id: string): Promise<unknown> {
        const original = await this.findScoped(user.id, id);
        const now = time.toDbDatetime(time.nowLocal());
        const copy = await this.transactions.save({
            id: newId(),
            user_id: original.user_id,
            account_id: original.account_id,
            category_id: original.category_id,
            merchant_id: original.merchant_id,
            kind: original.kind,
            amount_cents: original.amount_cents,
            currency: original.currency,
            occurred_at: now,
            note: original.note,
            payment_method: original.payment_method,
            image_urls: original.image_urls,
            source: original.source,
            transfer_account_id: original.transfer_account_id,
            idempotency_key: original.idempotency_key,
            created_at: now,
            updated_at: now,
        });
        return {data: transactionPayload(copy)};
    }
}

function parseSort(sort: string | undefined): {column: string; descending: boolean} {
    const allowed = ["occurred_at", "amount_cents", "created_at"];
    const value = sort ?? "";
    if (value.startsWith("-") && allowed.includes(value.slice(1))) {
        return {column: value.slice(1), descending: true};
    }
    if (allowed.includes(value)) {
        return {column: value, descending: false};
    }
    return {column: "occurred_at", descending: false};
}

function emptyPage(page: number, perPage: number): unknown {
    return {
        data: [],
        meta: {page, per_page: perPage, total: 0, total_pages: 0},
    };
}
