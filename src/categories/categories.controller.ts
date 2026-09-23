import {Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query} from "@nestjs/common";
import {InjectRepository} from "@nestjs/typeorm";
import {DataSource, Not, Repository} from "typeorm";

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
import {RecurringRule} from "../database/entities/recurring-rule.entity";
import {Transaction} from "../database/entities/transaction.entity";
import type {User} from "../database/entities/user.entity";
import {parseCategoryKind} from "../views/enums";
import {categoryPayload} from "../views/serializers";

function categoryNameTaken(): ApiError {
    return ApiError.validation("分類名稱已被使用", {name: ["已被使用"]});
}

function mapDbError(error: unknown): never {
    if (isUniqueViolation(error)) {
        throw categoryNameTaken();
    }
    throw error;
}

@Controller("api/v1/categories")
export class CategoriesController {
    constructor(
        @InjectRepository(Category) private readonly categories: Repository<Category>,
        private readonly dataSource: DataSource
    ) {}

    private async findScoped(userId: string, id: string): Promise<Category> {
        const category = await this.categories.findOne({where: {id, user_id: userId}});
        if (!category) {
            throw ApiError.notFound();
        }
        return category;
    }

    private async existsName(userId: string, kind: number, name: string, exceptId?: string): Promise<boolean> {
        const found = await this.categories.findOne({
            where: {
                user_id: userId,
                kind,
                name,
                ...(exceptId ? {id: Not(exceptId)} : {}),
            },
        });
        return found !== null;
    }

    @Get()
    async index(@CurrentUser() user: User, @Query("kind") kind?: string): Promise<unknown> {
        const where: Record<string, unknown> = {user_id: user.id};
        if (kind !== undefined && kind !== "") {
            const parsed = parseCategoryKind(kind);
            if (parsed === null) {
                return {data: []};
            }
            where.kind = parsed;
        }
        const rows = await this.categories.find({
            where,
            order: {kind: "ASC", created_at: "ASC"},
        });
        return {data: rows.map(categoryPayload)};
    }

    @Post()
    async create(@CurrentUser() user: User, @Body() body: JsonObject): Promise<unknown> {
        const name = typeof body.name === "string" ? body.name : "";
        const kind = params.parseEnumField(body, "kind", parseCategoryKind);

        const errors = new ValidationErrors();
        if (name.trim() === "") {
            errors.add("name", "分類名稱", "不可為空白");
        }
        if (kind !== null) {
            if (name.trim() !== "" && (await this.existsName(user.id, kind, name.trim()))) {
                errors.add("name", "分類名稱", "已被使用");
            }
        } else {
            errors.add("kind", "分類類型", "不可為空白");
        }
        if (!errors.isEmpty) {
            throw errors.toApiError();
        }

        const now = time.toDbDatetime(time.nowLocal());
        try {
            const category = await this.categories.save({
                id: newId(),
                user_id: user.id,
                name: name.trim(),
                kind: kind ?? 0,
                icon: params.stringField(body, "icon"),
                color: params.stringField(body, "color"),
                created_at: now,
                updated_at: now,
            });
            return {data: categoryPayload(category)};
        } catch (error) {
            mapDbError(error);
        }
    }

    @Patch(":id")
    async update(@CurrentUser() user: User, @Param("id") id: string, @Body() body: JsonObject): Promise<unknown> {
        const category = await this.findScoped(user.id, id);
        const kind = params.parseEnumField(body, "kind", parseCategoryKind);
        const name = typeof body.name === "string" ? body.name : null;
        const effectiveKind = kind ?? category.kind;
        const effectiveName = name !== null ? name.trim() : category.name;

        const errors = new ValidationErrors();
        if (name !== null && name.trim() === "") {
            errors.add("name", "分類名稱", "不可為空白");
        }
        if (effectiveName !== "" && (await this.existsName(user.id, effectiveKind, effectiveName, category.id))) {
            errors.add("name", "分類名稱", "已被使用");
        }
        if (!errors.isEmpty) {
            throw errors.toApiError();
        }

        const data: Partial<Category> = {updated_at: time.toDbDatetime(time.nowLocal())};
        if (name !== null) data.name = name.trim();
        if (kind !== null) data.kind = kind;
        const icon = params.stringField(body, "icon");
        const color = params.stringField(body, "color");
        if (icon !== null) data.icon = icon;
        if (color !== null) data.color = color;

        try {
            const updated = await this.categories.save({...category, ...data});
            return {data: categoryPayload(updated)};
        } catch (error) {
            mapDbError(error);
        }
    }

    @Delete(":id")
    @HttpCode(204)
    async destroy(@CurrentUser() user: User, @Param("id") id: string): Promise<void> {
        const category = await this.findScoped(user.id, id);
        const now = time.toDbDatetime(time.nowLocal());
        await this.dataSource.transaction(async manager => {
            await manager.update(Transaction, {category_id: category.id}, {category_id: null, updated_at: now});
            await manager.update(Merchant, {default_category_id: category.id}, {default_category_id: null, updated_at: now});
            await manager.update(RecurringRule, {category_id: category.id}, {category_id: null, updated_at: now});
            await manager.delete(Category, {id: category.id});
        });
    }
}
