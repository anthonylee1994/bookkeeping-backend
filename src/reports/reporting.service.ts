import {Global, Injectable, Module} from "@nestjs/common";
import {InjectRepository} from "@nestjs/typeorm";
import {Repository} from "typeorm";

import {Account} from "../database/entities/account.entity";
import {Category} from "../database/entities/category.entity";
import {Merchant} from "../database/entities/merchant.entity";
import {Transaction} from "../database/entities/transaction.entity";
import {accountTotals, Totals} from "./reporting";

@Injectable()
export class ReportingService {
    constructor(
        @InjectRepository(Category) private readonly categories: Repository<Category>,
        @InjectRepository(Account) private readonly accounts: Repository<Account>,
        @InjectRepository(Merchant) private readonly merchants: Repository<Merchant>,
        @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>
    ) {}

    async loadCategoryNames(userId: string): Promise<Map<string, string>> {
        const rows = await this.categories.find({where: {user_id: userId}});
        return new Map(rows.map(row => [row.id, row.name]));
    }

    async loadMerchantNames(userId: string): Promise<Map<string, string>> {
        const rows = await this.merchants.find({where: {user_id: userId}});
        return new Map(rows.map(row => [row.id, row.name]));
    }

    async loadAccountNames(userId: string): Promise<Map<string, string>> {
        const rows = await this.accounts.find({where: {user_id: userId}});
        return new Map(rows.map(row => [row.id, row.name]));
    }

    async accountBalances(userId: string): Promise<Array<Record<string, unknown>>> {
        const all = await this.transactions.find({where: {user_id: userId}});
        const totals = accountTotals(all);

        const rows = await this.accounts.find({
            where: {user_id: userId},
            order: {created_at: "ASC"},
        });

        return rows.map(account => {
            const total: Totals | undefined = totals.get(account.id);
            const income = total?.income ?? 0;
            const expense = total?.expense ?? 0;
            return {
                id: account.id,
                name: account.name,
                currency: account.currency,
                initial_balance_cents: account.initial_balance_cents,
                balance_cents: account.initial_balance_cents + income - expense,
            };
        });
    }
}

@Global()
@Module({
    providers: [ReportingService],
    exports: [ReportingService],
})
export class ReportingModule {}
