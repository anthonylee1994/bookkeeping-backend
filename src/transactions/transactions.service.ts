import {Injectable} from "@nestjs/common";
import {InjectRepository} from "@nestjs/typeorm";
import {Repository} from "typeorm";

import {ApiError} from "../common/errors";
import * as params from "../common/params";
import {JsonObject} from "../common/params";
import * as time from "../common/time";
import {newId} from "../common/util";
import {ValidationErrors} from "../common/validation";
import {Account} from "../database/entities/account.entity";
import {Category} from "../database/entities/category.entity";
import {Merchant} from "../database/entities/merchant.entity";
import {Transaction} from "../database/entities/transaction.entity";
import {parseTransactionKind, parseTransactionSource} from "../views/enums";

const KIND_EXPENSE = 1;
const KIND_TRANSFER = 2;

interface ValidatedFields {
    account_id: string | null;
    category_id: string | null;
    category_touched: boolean;
    merchant_id: string | null;
    merchant_touched: boolean;
    kind: number | null;
    amount_cents: number | null;
    currency: string | null;
    occurred_at: Date | null;
    note: string | null;
    note_touched: boolean;
    payment_method: string | null;
    payment_method_touched: boolean;
    image_urls: string[];
    image_urls_touched: boolean;
    source: number | null;
    transfer_account_id: string | null;
    transfer_account_touched: boolean;
}

interface EffectiveValues {
    account_id: string | null;
    category_id: string | null;
    merchant_id: string | null;
    kind: number | null;
    amount_cents: number | null;
    occurred_at: Date | null;
    transfer_account_id: string | null;
}

function imageUrlsError(): ApiError {
    return ApiError.validation("圖片網址格式無效", {image_urls: ["無效"]});
}

@Injectable()
export class TransactionsService {
    constructor(
        @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
        @InjectRepository(Account) private readonly accounts: Repository<Account>,
        @InjectRepository(Category) private readonly categories: Repository<Category>,
        @InjectRepository(Merchant) private readonly merchants: Repository<Merchant>
    ) {}

    private async owned(userId: string, table: "accounts" | "categories" | "merchants", id: string): Promise<boolean> {
        switch (table) {
            case "accounts":
                return (await this.accounts.findOne({where: {id, user_id: userId}})) !== null;
            case "categories":
                return (await this.categories.findOne({where: {id, user_id: userId}})) !== null;
            case "merchants":
                return (await this.merchants.findOne({where: {id, user_id: userId}})) !== null;
        }
    }

    private parseFields(body: JsonObject): ValidatedFields {
        const accountId = params.stringField(body, "account_id");
        const categoryTouched = params.touched(body, "category_id");
        const categoryId = params.stringField(body, "category_id");
        const merchantTouched = params.touched(body, "merchant_id");
        const merchantId = params.stringField(body, "merchant_id");
        const transferTouched = params.touched(body, "transfer_account_id");
        const transferAccountId = params.stringField(body, "transfer_account_id");

        const kind = params.parseEnumField(body, "kind", parseTransactionKind);
        const source = params.parseEnumField(body, "source", parseTransactionSource);
        const amountCents = params.parseI32Field(body, "amount_cents");
        const currency = params.stringField(body, "currency");
        const occurredAt = params.parseDatetimeField(body, "occurred_at");

        const noteTouched = params.touched(body, "note");
        const note = params.stringField(body, "note");
        const paymentTouched = params.touched(body, "payment_method");
        const paymentMethod = params.stringField(body, "payment_method");

        const imageUrlsTouched = params.touched(body, "image_urls");
        let imageUrls: string[] = [];
        const rawImageUrls = body.image_urls;
        if (rawImageUrls !== undefined) {
            if (!Array.isArray(rawImageUrls) || rawImageUrls.some(item => typeof item !== "string")) {
                throw imageUrlsError();
            }
            imageUrls = rawImageUrls as string[];
        }

        return {
            account_id: accountId,
            category_id: categoryId,
            category_touched: categoryTouched,
            merchant_id: merchantId,
            merchant_touched: merchantTouched,
            kind,
            amount_cents: amountCents,
            currency,
            occurred_at: occurredAt,
            note,
            note_touched: noteTouched,
            payment_method: paymentMethod,
            payment_method_touched: paymentTouched,
            image_urls: imageUrls,
            image_urls_touched: imageUrlsTouched,
            source,
            transfer_account_id: transferAccountId,
            transfer_account_touched: transferTouched,
        };
    }

    private async validateEffective(userId: string, values: EffectiveValues): Promise<void> {
        const errors = new ValidationErrors();

        if (values.kind === null) {
            errors.add("kind", "類型", "不可缺少");
            throw errors.toApiError();
        }
        const kind = values.kind;

        if (values.amount_cents !== null) {
            if (values.amount_cents <= 0) {
                errors.add("amount_cents", "金額", "必須大於 0");
            }
        } else {
            errors.add("amount_cents", "金額", "不可為空白");
        }

        if (values.occurred_at === null) {
            errors.add("occurred_at", "交易時間", "不可為空白");
        }

        let accountId: string;
        if (values.account_id !== null && values.account_id !== "") {
            accountId = values.account_id;
        } else {
            errors.add("account", "帳戶", "不可缺少");
            throw errors.toApiError();
        }

        if (!(await this.owned(userId, "accounts", accountId))) {
            errors.add("account", "帳戶", "無效");
        }
        if (values.category_id !== null && !(await this.owned(userId, "categories", values.category_id))) {
            errors.add("category", "分類", "無效");
        }
        if (values.merchant_id !== null && !(await this.owned(userId, "merchants", values.merchant_id))) {
            errors.add("merchant", "商家", "無效");
        }
        if (values.transfer_account_id !== null && !(await this.owned(userId, "accounts", values.transfer_account_id))) {
            errors.add("transfer_account", "轉帳帳戶", "無效");
        }

        if (kind === KIND_TRANSFER) {
            if (values.category_id !== null) {
                errors.add("category", "分類", "無效");
            }
            if (values.transfer_account_id === null) {
                errors.add("transfer_account", "轉帳帳戶", "不可為空白");
            } else if (values.transfer_account_id === accountId) {
                errors.add("transfer_account", "轉帳帳戶", "無效");
            }
        } else if (values.transfer_account_id !== null) {
            errors.add("transfer_account", "轉帳帳戶", "無效");
        }

        if (!errors.isEmpty) {
            throw errors.toApiError();
        }
    }

    private async fromRequest(userId: string, body: JsonObject, existing: Transaction | null): Promise<ValidatedFields> {
        const fields = this.parseFields(body);

        const effective: EffectiveValues = {
            account_id: fields.account_id ?? existing?.account_id ?? null,
            category_id: fields.category_touched ? fields.category_id : (existing?.category_id ?? null),
            merchant_id: fields.merchant_touched ? fields.merchant_id : (existing?.merchant_id ?? null),
            kind: fields.kind ?? existing?.kind ?? null,
            amount_cents: fields.amount_cents ?? existing?.amount_cents ?? null,
            occurred_at: fields.occurred_at ?? (existing ? time.fromDbDatetime(existing.occurred_at) : null),
            transfer_account_id: fields.transfer_account_touched ? fields.transfer_account_id : (existing?.transfer_account_id ?? null),
        };

        await this.validateEffective(userId, effective);
        return fields;
    }

    /** Shared create path used by `POST /transactions` and `POST /ai/confirm`. */
    async createValidated(userId: string, body: JsonObject, sourceOverride?: number): Promise<Transaction> {
        const fields = await this.fromRequest(userId, body, null);
        const now = time.toDbDatetime(time.nowLocal());

        return this.transactions.save({
            id: newId(),
            user_id: userId,
            account_id: fields.account_id ?? "",
            category_id: fields.category_id,
            merchant_id: fields.merchant_id,
            kind: fields.kind ?? KIND_EXPENSE,
            amount_cents: fields.amount_cents ?? 0,
            currency: fields.currency ?? "HKD",
            occurred_at: time.toDbDatetime(fields.occurred_at ?? time.nowLocal()),
            note: fields.note,
            payment_method: fields.payment_method,
            image_urls: JSON.stringify(fields.image_urls),
            source: sourceOverride ?? fields.source ?? 0,
            transfer_account_id: fields.transfer_account_id,
            idempotency_key: null,
            created_at: now,
            updated_at: now,
        });
    }

    async incrementMerchantUsage(transaction: Transaction): Promise<void> {
        if (transaction.merchant_id === null) {
            return;
        }
        const merchant = await this.merchants.findOne({where: {id: transaction.merchant_id}});
        if (!merchant) {
            return;
        }
        await this.merchants.update(
            {id: merchant.id},
            {
                usage_count: merchant.usage_count + 1,
                updated_at: time.toDbDatetime(time.nowLocal()),
            }
        );
    }

    /** Parses + validates an update body against an existing transaction. */
    async updateValidated(userId: string, existing: Transaction, body: JsonObject): Promise<Transaction> {
        const fields = await this.fromRequest(userId, body, existing);

        const data: Partial<Transaction> = {updated_at: time.toDbDatetime(time.nowLocal())};
        if (fields.account_id !== null) data.account_id = fields.account_id;
        if (fields.category_touched) data.category_id = fields.category_id;
        if (fields.merchant_touched) data.merchant_id = fields.merchant_id;
        if (fields.kind !== null) data.kind = fields.kind;
        if (fields.amount_cents !== null) data.amount_cents = fields.amount_cents;
        if (fields.currency !== null) data.currency = fields.currency;
        if (fields.occurred_at !== null) data.occurred_at = time.toDbDatetime(fields.occurred_at);
        if (fields.note_touched) data.note = fields.note;
        if (fields.payment_method_touched) data.payment_method = fields.payment_method;
        if (fields.image_urls_touched) data.image_urls = JSON.stringify(fields.image_urls);
        if (fields.source !== null) data.source = fields.source;
        if (fields.transfer_account_touched) data.transfer_account_id = fields.transfer_account_id;

        return this.transactions.save({...existing, ...data});
    }
}
