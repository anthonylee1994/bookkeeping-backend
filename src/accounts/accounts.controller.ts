import {Body, Controller, Delete, Get, HttpCode, Param, Patch, Post} from "@nestjs/common";
import {InjectRepository} from "@nestjs/typeorm";
import {Not, Repository} from "typeorm";

import {CurrentUser} from "../auth/current-user.decorator";
import {ApiError} from "../common/errors";
import * as params from "../common/params";
import {JsonObject} from "../common/params";
import * as time from "../common/time";
import {newId} from "../common/util";
import {ValidationErrors} from "../common/validation";
import {isUniqueViolation} from "../database/db-errors";
import {Account} from "../database/entities/account.entity";
import {RecurringRule} from "../database/entities/recurring-rule.entity";
import {Transaction} from "../database/entities/transaction.entity";
import type {User} from "../database/entities/user.entity";
import {parseAccountKind} from "../views/enums";
import {accountPayload} from "../views/serializers";

function accountNameTaken(): ApiError {
    return ApiError.validation("帳戶名稱已被使用", {name: ["已被使用"]});
}

function mapDbError(error: unknown): never {
    if (isUniqueViolation(error)) {
        throw accountNameTaken();
    }
    throw error;
}

@Controller("api/v1/accounts")
export class AccountsController {
    constructor(
        @InjectRepository(Account) private readonly accounts: Repository<Account>,
        @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
        @InjectRepository(RecurringRule) private readonly recurringRules: Repository<RecurringRule>
    ) {}

    private async findScoped(userId: string, id: string): Promise<Account> {
        const account = await this.accounts.findOne({where: {id, user_id: userId}});
        if (!account) {
            throw ApiError.notFound();
        }
        return account;
    }

    private async existsName(userId: string, name: string, exceptId?: string): Promise<boolean> {
        const found = await this.accounts.findOne({
            where: {user_id: userId, name, ...(exceptId ? {id: Not(exceptId)} : {})},
        });
        return found !== null;
    }

    @Get()
    async index(@CurrentUser() user: User): Promise<unknown> {
        const rows = await this.accounts.find({
            where: {user_id: user.id},
            order: {created_at: "ASC"},
        });
        return {data: rows.map(accountPayload)};
    }

    @Post()
    async create(@CurrentUser() user: User, @Body() body: JsonObject): Promise<unknown> {
        const name = typeof body.name === "string" ? body.name : "";
        const kind = params.parseEnumField(body, "kind", parseAccountKind);
        const initialBalance = params.parseI32Field(body, "initial_balance_cents");

        const errors = new ValidationErrors();
        if (name.trim() === "") {
            errors.add("name", "帳戶名稱", "不可為空白");
        } else if (await this.existsName(user.id, name.trim())) {
            errors.add("name", "帳戶名稱", "已被使用");
        }
        if (kind === null) {
            errors.add("kind", "帳戶類型", "不可為空白");
        }
        if (!errors.isEmpty) {
            throw errors.toApiError();
        }

        const now = time.toDbDatetime(time.nowLocal());
        try {
            const account = await this.accounts.save({
                id: newId(),
                user_id: user.id,
                name: name.trim(),
                kind: kind ?? 0,
                icon: params.stringField(body, "icon"),
                color: params.stringField(body, "color"),
                initial_balance_cents: initialBalance ?? 0,
                currency: params.stringField(body, "currency") ?? "HKD",
                created_at: now,
                updated_at: now,
            });
            return {data: accountPayload(account)};
        } catch (error) {
            mapDbError(error);
        }
    }

    @Patch(":id")
    async update(@CurrentUser() user: User, @Param("id") id: string, @Body() body: JsonObject): Promise<unknown> {
        const account = await this.findScoped(user.id, id);
        const kind = params.parseEnumField(body, "kind", parseAccountKind);
        const initialBalance = params.parseI32Field(body, "initial_balance_cents");
        const name = typeof body.name === "string" ? body.name : null;

        const errors = new ValidationErrors();
        if (name !== null) {
            if (name.trim() === "") {
                errors.add("name", "帳戶名稱", "不可為空白");
            } else if (await this.existsName(user.id, name.trim(), account.id)) {
                errors.add("name", "帳戶名稱", "已被使用");
            }
        }
        if (!errors.isEmpty) {
            throw errors.toApiError();
        }

        const data: Partial<Account> = {updated_at: time.toDbDatetime(time.nowLocal())};
        if (name !== null) data.name = name.trim();
        if (kind !== null) data.kind = kind;
        if (initialBalance !== null) data.initial_balance_cents = initialBalance;
        const icon = params.stringField(body, "icon");
        const color = params.stringField(body, "color");
        const currency = params.stringField(body, "currency");
        if (icon !== null) data.icon = icon;
        if (color !== null) data.color = color;
        if (currency !== null) data.currency = currency;

        try {
            const updated = await this.accounts.save({...account, ...data});
            return {data: accountPayload(updated)};
        } catch (error) {
            mapDbError(error);
        }
    }

    @Delete(":id")
    @HttpCode(204)
    async destroy(@CurrentUser() user: User, @Param("id") id: string): Promise<void> {
        const account = await this.findScoped(user.id, id);

        const usedAsAccount = await this.transactions.findOne({where: {account_id: account.id}});
        const usedAsTransfer = await this.transactions.findOne({
            where: {transfer_account_id: account.id},
        });
        const usedByRule = await this.recurringRules.findOne({where: {account_id: account.id}});

        if (usedAsAccount || usedAsTransfer || usedByRule) {
            throw ApiError.accountInUse();
        }

        await this.accounts.delete({id: account.id});
    }
}
