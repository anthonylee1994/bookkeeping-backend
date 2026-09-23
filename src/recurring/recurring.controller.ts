import {Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query} from "@nestjs/common";
import {InjectRepository} from "@nestjs/typeorm";
import {DataSource, Repository} from "typeorm";

import {CurrentUser} from "../auth/current-user.decorator";
import {ApiError} from "../common/errors";
import * as params from "../common/params";
import {JsonObject} from "../common/params";
import * as time from "../common/time";
import {newId} from "../common/util";
import {ValidationErrors} from "../common/validation";
import {Account} from "../database/entities/account.entity";
import {Category} from "../database/entities/category.entity";
import {Merchant} from "../database/entities/merchant.entity";
import {RecurringOccurrence} from "../database/entities/recurring-occurrence.entity";
import {RecurringRule} from "../database/entities/recurring-rule.entity";
import type {User} from "../database/entities/user.entity";
import {parseFrequency, parseStatus, parseTransactionKind} from "../views/enums";
import {rulePayload, transactionPayloadWithNet} from "../views/serializers";
import {AlreadyMaterializedError, RecurringService, STATUS_ACTIVE, STATUS_PAUSED} from "./recurring.service";

interface RuleFields {
    account_id: string | null;
    category_id: string | null;
    category_touched: boolean;
    merchant_id: string | null;
    merchant_touched: boolean;
    kind: number | null;
    frequency: number | null;
    amount_cents: number | null;
    interval: number | null;
    day_of_week: number | null;
    day_of_month: number | null;
    month_of_year: number | null;
    currency: string | null;
    status: number | null;
    note: string | null;
    note_touched: boolean;
    start_on: Date | null;
    end_on: {touched: boolean; value: Date | null};
    next_run_at: Date | null;
}

function parseRuleFields(body: JsonObject): RuleFields {
    let startOn: Date | null = null;
    if (typeof body.start_on === "string") {
        const parsed = time.parseDate(body.start_on);
        if (!parsed) {
            throw ApiError.invalidValue();
        }
        startOn = parsed;
    }

    let endOn: {touched: boolean; value: Date | null} = {touched: false, value: null};
    if (params.touched(body, "end_on")) {
        const value = body.end_on;
        if (value === null) {
            endOn = {touched: true, value: null};
        } else if (typeof value === "string") {
            const parsed = time.parseDate(value);
            if (!parsed) {
                throw ApiError.invalidValue();
            }
            endOn = {touched: true, value: parsed};
        } else {
            throw ApiError.invalidValue();
        }
    }

    return {
        account_id: params.stringField(body, "account_id"),
        category_touched: params.touched(body, "category_id"),
        category_id: params.stringField(body, "category_id"),
        merchant_touched: params.touched(body, "merchant_id"),
        merchant_id: params.stringField(body, "merchant_id"),
        kind: params.parseEnumField(body, "kind", parseTransactionKind),
        frequency: params.parseEnumField(body, "frequency", parseFrequency),
        amount_cents: params.parseI32Field(body, "amount_cents"),
        interval: params.parseI32Field(body, "interval"),
        day_of_week: params.parseI32Field(body, "day_of_week"),
        day_of_month: params.parseI32Field(body, "day_of_month"),
        month_of_year: params.parseI32Field(body, "month_of_year"),
        currency: params.stringField(body, "currency"),
        status: params.parseEnumField(body, "status", parseStatus),
        note_touched: params.touched(body, "note"),
        note: params.stringField(body, "note"),
        start_on: startOn,
        end_on: endOn,
        next_run_at: params.parseDatetimeField(body, "next_run_at"),
    };
}

/** Range checks shared by create and update (a missing interval is `1`). */
function validateFieldRanges(fields: RuleFields, errors: ValidationErrors): void {
    if ((fields.interval ?? 1) <= 0) {
        errors.add("interval", "間隔", "必須大於 0");
    }
    if (fields.day_of_week !== null && (fields.day_of_week < 0 || fields.day_of_week > 6)) {
        errors.add("day_of_week", "星期", "不在允許的範圍內");
    }
    if (fields.day_of_month !== null && (fields.day_of_month < 1 || fields.day_of_month > 31)) {
        errors.add("day_of_month", "日期", "不在允許的範圍內");
    }
    if (fields.month_of_year !== null && (fields.month_of_year < 1 || fields.month_of_year > 12)) {
        errors.add("month_of_year", "月份", "不在允許的範圍內");
    }
}

@Controller("api/v1/recurring_rules")
export class RecurringController {
    constructor(
        @InjectRepository(RecurringRule) private readonly rules: Repository<RecurringRule>,
        @InjectRepository(Account) private readonly accounts: Repository<Account>,
        @InjectRepository(Category) private readonly categories: Repository<Category>,
        @InjectRepository(Merchant) private readonly merchants: Repository<Merchant>,
        private readonly dataSource: DataSource,
        private readonly recurring: RecurringService
    ) {}

    private async findScoped(userId: string, id: string): Promise<RecurringRule> {
        const rule = await this.rules.findOne({where: {id, user_id: userId}});
        if (!rule) {
            throw ApiError.notFound();
        }
        return rule;
    }

    private async validateOwnership(userId: string, accountId: string | null, categoryId: string | null, merchantId: string | null, errors: ValidationErrors): Promise<void> {
        if (accountId !== null && accountId !== "") {
            const owned = await this.accounts.findOne({where: {id: accountId, user_id: userId}});
            if (!owned) {
                errors.add("account", "帳戶", "無效");
            }
        } else {
            errors.add("account", "帳戶", "不可缺少");
        }

        if (categoryId !== null) {
            const owned = await this.categories.findOne({where: {id: categoryId, user_id: userId}});
            if (!owned) {
                errors.add("category", "分類", "無效");
            }
        }

        if (merchantId !== null) {
            const owned = await this.merchants.findOne({where: {id: merchantId, user_id: userId}});
            if (!owned) {
                errors.add("merchant", "商家", "無效");
            }
        }
    }

    @Get()
    async index(@CurrentUser() user: User, @Query("status") status?: string): Promise<unknown> {
        let where: Record<string, unknown> = {user_id: user.id};
        if (status !== undefined && status !== "") {
            const parsed = parseStatus(status);
            if (parsed === null) {
                return {data: []};
            }
            where = {...where, status: parsed};
        }
        const rows = await this.rules.find({
            where,
            order: {created_at: "ASC"},
        });
        return {data: rows.map(rulePayload)};
    }

    @Post()
    async create(@CurrentUser() user: User, @Body() body: JsonObject): Promise<unknown> {
        const fields = parseRuleFields(body);
        const errors = new ValidationErrors();

        if (fields.start_on === null) {
            errors.add("start_on", "開始日期", "不可為空白");
            throw errors.toApiError();
        }
        const startOn = fields.start_on;

        if (fields.amount_cents === null || fields.amount_cents <= 0) {
            errors.add("amount_cents", "金額", "必須大於 0");
        }
        validateFieldRanges(fields, errors);
        if (fields.kind === null) {
            errors.add("kind", "類型", "不可缺少");
        }
        if (fields.frequency === null) {
            errors.add("frequency", "頻率", "不可缺少");
        }
        await this.validateOwnership(user.id, fields.account_id, fields.category_id, fields.merchant_id, errors);
        if (!errors.isEmpty) {
            throw errors.toApiError();
        }

        const now = time.toDbDatetime(time.nowLocal());
        const rule = await this.rules.save({
            id: newId(),
            user_id: user.id,
            account_id: fields.account_id ?? "",
            category_id: fields.category_id,
            merchant_id: fields.merchant_id,
            kind: fields.kind ?? 1,
            amount_cents: fields.amount_cents ?? 0,
            currency: fields.currency ?? "HKD",
            frequency: fields.frequency ?? 0,
            interval: fields.interval ?? 1,
            day_of_week: fields.day_of_week,
            day_of_month: fields.day_of_month,
            month_of_year: fields.month_of_year,
            start_on: time.toDbDate(startOn),
            end_on: fields.end_on.value ? time.toDbDate(fields.end_on.value) : null,
            next_run_at: time.toDbDatetime(fields.next_run_at ?? time.beginningOfDay(startOn)),
            last_run_at: null,
            status: fields.status ?? STATUS_ACTIVE,
            note: fields.note,
            created_at: now,
            updated_at: now,
        });

        return {data: rulePayload(rule)};
    }

    @Patch(":id")
    async update(@CurrentUser() user: User, @Param("id") id: string, @Body() body: JsonObject): Promise<unknown> {
        const rule = await this.findScoped(user.id, id);
        const fields = parseRuleFields(body);
        const errors = new ValidationErrors();

        if (fields.amount_cents !== null && fields.amount_cents <= 0) {
            errors.add("amount_cents", "金額", "必須大於 0");
        }
        validateFieldRanges(fields, errors);

        const effectiveAccount = fields.account_id ?? rule.account_id;
        await this.validateOwnership(user.id, effectiveAccount, fields.category_id ?? rule.category_id, fields.merchant_id ?? rule.merchant_id, errors);
        if (!errors.isEmpty) {
            throw errors.toApiError();
        }

        const data: Partial<RecurringRule> = {updated_at: time.toDbDatetime(time.nowLocal())};
        if (fields.account_id !== null) data.account_id = fields.account_id;
        if (fields.category_touched) data.category_id = fields.category_id;
        if (fields.merchant_touched) data.merchant_id = fields.merchant_id;
        if (fields.kind !== null) data.kind = fields.kind;
        if (fields.amount_cents !== null) data.amount_cents = fields.amount_cents;
        if (fields.currency !== null) data.currency = fields.currency;
        if (fields.frequency !== null) data.frequency = fields.frequency;
        if (fields.interval !== null) data.interval = fields.interval;
        if (fields.day_of_week !== null) data.day_of_week = fields.day_of_week;
        if (fields.day_of_month !== null) data.day_of_month = fields.day_of_month;
        if (fields.month_of_year !== null) data.month_of_year = fields.month_of_year;
        if (fields.start_on !== null) data.start_on = time.toDbDate(fields.start_on);
        if (fields.end_on.touched) {
            data.end_on = fields.end_on.value ? time.toDbDate(fields.end_on.value) : null;
        }
        if (fields.next_run_at !== null) data.next_run_at = time.toDbDatetime(fields.next_run_at);
        if (fields.status !== null) data.status = fields.status;
        if (fields.note_touched) data.note = fields.note;

        const updated = await this.rules.save({...rule, ...data});
        return {data: rulePayload(updated)};
    }

    @Delete(":id")
    @HttpCode(204)
    async destroy(@CurrentUser() user: User, @Param("id") id: string): Promise<void> {
        const rule = await this.findScoped(user.id, id);
        await this.dataSource.transaction(async manager => {
            await manager.delete(RecurringOccurrence, {recurring_rule_id: rule.id});
            await manager.delete(RecurringRule, {id: rule.id});
        });
    }

    @Post(":id/pause")
    @HttpCode(200)
    async pause(@CurrentUser() user: User, @Param("id") id: string): Promise<unknown> {
        return this.setStatus(user.id, id, STATUS_PAUSED);
    }

    @Post(":id/resume")
    @HttpCode(200)
    async resume(@CurrentUser() user: User, @Param("id") id: string): Promise<unknown> {
        const rule = await this.findScoped(user.id, id);
        const now = time.nowLocal();
        const nextRunAt = time.compare(time.fromDbDatetime(rule.next_run_at), now) > 0 ? rule.next_run_at : time.toDbDatetime(now);
        await this.rules.update(
            {id: rule.id},
            {
                status: STATUS_ACTIVE,
                next_run_at: nextRunAt,
                updated_at: time.toDbDatetime(now),
            }
        );
        const updated = await this.rules.findOneByOrFail({id: rule.id});
        return {data: rulePayload(updated)};
    }

    private async setStatus(userId: string, id: string, status: number): Promise<unknown> {
        const rule = await this.findScoped(userId, id);
        await this.rules.update({id: rule.id}, {status, updated_at: time.toDbDatetime(time.nowLocal())});
        const updated = await this.rules.findOneByOrFail({id: rule.id});
        return {data: rulePayload(updated)};
    }

    @Post(":id/run_now")
    @HttpCode(200)
    async runNow(@CurrentUser() user: User, @Param("id") id: string): Promise<unknown> {
        const rule = await this.findScoped(user.id, id);
        try {
            const transaction = await this.recurring.runNow(user.id, rule);
            return {data: transactionPayloadWithNet(transaction, false)};
        } catch (error) {
            if (error instanceof AlreadyMaterializedError) {
                throw ApiError.alreadyMaterialized();
            }
            throw error;
        }
    }

    @Post(":id/skip_next")
    @HttpCode(200)
    async skipNext(@CurrentUser() user: User, @Param("id") id: string): Promise<unknown> {
        const rule = await this.findScoped(user.id, id);
        const updated = await this.recurring.skipNext(rule);
        return {data: rulePayload(updated)};
    }
}
