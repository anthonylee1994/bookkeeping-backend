import {INestApplication} from "@nestjs/common";
import {Test} from "@nestjs/testing";
import request from "supertest";
import type {DataSource} from "typeorm";

import {AppModule} from "../../src/app.module";
import {configureApp} from "../../src/app.setup";
import {AiImportLog} from "../../src/database/entities/ai-import-log.entity";
import {Account} from "../../src/database/entities/account.entity";
import {Category} from "../../src/database/entities/category.entity";
import {IdempotencyKey} from "../../src/database/entities/idempotency-key.entity";
import {Merchant} from "../../src/database/entities/merchant.entity";
import {RecurringOccurrence} from "../../src/database/entities/recurring-occurrence.entity";
import {RecurringRule} from "../../src/database/entities/recurring-rule.entity";
import {Transaction} from "../../src/database/entities/transaction.entity";
import {User} from "../../src/database/entities/user.entity";

export async function createApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({imports: [AppModule]}).compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    return app;
}

export function http(app: INestApplication) {
    return request(app.getHttpServer());
}

export type HttpClient = ReturnType<typeof http>;

export async function resetDatabase(dataSource: DataSource): Promise<void> {
    await dataSource.transaction(async manager => {
        for (const entity of [IdempotencyKey, AiImportLog, RecurringOccurrence, RecurringRule, Transaction, Merchant, Category, Account, User]) {
            await manager.createQueryBuilder().delete().from(entity).execute();
        }
    });
}
