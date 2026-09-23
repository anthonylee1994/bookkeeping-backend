import {Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query} from "@nestjs/common";
import {InjectRepository} from "@nestjs/typeorm";
import {DataSource, Like, Not, Repository} from "typeorm";

import {CurrentUser} from "../auth/current-user.decorator";
import {ApiError} from "../common/errors";
import * as params from "../common/params";
import {JsonObject} from "../common/params";
import * as time from "../common/time";
import {newId} from "../common/util";
import {ValidationErrors} from "../common/validation";
import {isUniqueViolation} from "../database/db-errors";
import {Category} from "../database/entities/category.entity";
import {Merchant} from "../database/entities/merchant.entity";
import {Transaction} from "../database/entities/transaction.entity";
import type {User} from "../database/entities/user.entity";
import {merchantPayload} from "../views/serializers";

function merchantNameTaken(): ApiError {
    return ApiError.validation("商家名稱已被使用", {name: ["已被使用"]});
}

function mapDbError(error: unknown): never {
    if (isUniqueViolation(error)) {
        throw merchantNameTaken();
    }
    throw error;
}

@Controller("api/v1/merchants")
export class MerchantsController {
    constructor(
        @InjectRepository(Merchant) private readonly merchants: Repository<Merchant>,
        @InjectRepository(Category) private readonly categories: Repository<Category>,
        @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
        private readonly dataSource: DataSource
    ) {}

    private async findScoped(userId: string, id: string): Promise<Merchant> {
        const merchant = await this.merchants.findOne({where: {id, user_id: userId}});
        if (!merchant) {
            throw ApiError.notFound();
        }
        return merchant;
    }

    private async existsName(userId: string, name: string, exceptId?: string): Promise<boolean> {
        const found = await this.merchants.findOne({
            where: {user_id: userId, name, ...(exceptId ? {id: Not(exceptId)} : {})},
        });
        return found !== null;
    }

    private async categoryOwned(userId: string, categoryId: string): Promise<boolean> {
        const found = await this.categories.findOne({where: {id: categoryId, user_id: userId}});
        return found !== null;
    }

    @Get()
    async index(@CurrentUser() user: User, @Query("q") q?: string): Promise<unknown> {
        const trimmed = q?.trim();
        const where: Record<string, unknown> = {user_id: user.id};
        if (trimmed !== undefined && trimmed !== "") {
            where.name = Like(`%${trimmed}%`);
        }
        const rows = await this.merchants.find({
            where,
            order: {usage_count: "DESC", name: "ASC"},
            ...(q !== undefined ? {take: 10} : {}),
        });
        return {data: rows.map(merchantPayload)};
    }

    @Post()
    async create(@CurrentUser() user: User, @Body() body: JsonObject): Promise<unknown> {
        const name = typeof body.name === "string" ? body.name : "";
        const defaultCategoryId = params.stringField(body, "default_category_id");

        const errors = new ValidationErrors();
        if (name.trim() === "") {
            errors.add("name", "商家名稱", "不可為空白");
        } else if (await this.existsName(user.id, name.trim())) {
            errors.add("name", "商家名稱", "已被使用");
        }
        if (defaultCategoryId !== null && !(await this.categoryOwned(user.id, defaultCategoryId))) {
            errors.add("default_category", "預設分類", "無效");
        }
        if (!errors.isEmpty) {
            throw errors.toApiError();
        }

        const now = time.toDbDatetime(time.nowLocal());
        try {
            const merchant = await this.merchants.save({
                id: newId(),
                user_id: user.id,
                name: name.trim(),
                default_category_id: defaultCategoryId,
                usage_count: 0,
                created_at: now,
                updated_at: now,
            });
            return {data: merchantPayload(merchant)};
        } catch (error) {
            mapDbError(error);
        }
    }

    @Patch(":id")
    async update(@CurrentUser() user: User, @Param("id") id: string, @Body() body: JsonObject): Promise<unknown> {
        const merchant = await this.findScoped(user.id, id);
        const name = typeof body.name === "string" ? body.name : null;

        const errors = new ValidationErrors();
        if (name !== null) {
            if (name.trim() === "") {
                errors.add("name", "商家名稱", "不可為空白");
            } else if (await this.existsName(user.id, name.trim(), merchant.id)) {
                errors.add("name", "商家名稱", "已被使用");
            }
        }
        if (params.touched(body, "default_category_id")) {
            const categoryId = params.stringField(body, "default_category_id");
            if (categoryId !== null && !(await this.categoryOwned(user.id, categoryId))) {
                errors.add("default_category", "預設分類", "無效");
            }
        }
        if (!errors.isEmpty) {
            throw errors.toApiError();
        }

        const data: Partial<Merchant> = {updated_at: time.toDbDatetime(time.nowLocal())};
        if (name !== null) data.name = name.trim();
        if (params.touched(body, "default_category_id")) {
            data.default_category_id = params.stringField(body, "default_category_id");
        }

        try {
            const updated = await this.merchants.save({...merchant, ...data});
            return {data: merchantPayload(updated)};
        } catch (error) {
            mapDbError(error);
        }
    }

    @Delete(":id")
    @HttpCode(204)
    async destroy(@CurrentUser() user: User, @Param("id") id: string): Promise<void> {
        const merchant = await this.findScoped(user.id, id);
        const now = time.toDbDatetime(time.nowLocal());
        await this.dataSource.transaction(async manager => {
            await manager.update(Transaction, {merchant_id: merchant.id}, {merchant_id: null, updated_at: now});
            await manager.delete(Merchant, {id: merchant.id});
        });
    }
}
