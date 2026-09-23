import {MiddlewareConsumer, Module, NestModule, RequestMethod} from "@nestjs/common";

import {AccountsModule} from "./accounts/accounts.module";
import {AiModule} from "./ai/ai.module";
import {AuthModule} from "./auth/auth.module";
import {CategoriesModule} from "./categories/categories.module";
import {DashboardModule} from "./dashboard/dashboard.module";
import {DatabaseModule} from "./database/database.module";
import {DocsModule} from "./docs/docs.module";
import {HealthModule} from "./health/health.module";
import {MerchantsModule} from "./merchants/merchants.module";
import {RateLimitMiddleware} from "./rate-limit/rate-limit.middleware";
import {ReceiptsModule} from "./receipts/receipts.module";
import {RecurringModule} from "./recurring/recurring.module";
import {ReportingModule} from "./reports/reporting.service";
import {SummariesModule} from "./summaries/summaries.module";
import {TransactionsModule} from "./transactions/transactions.module";

@Module({
    imports: [
        DatabaseModule,
        ReportingModule,
        AuthModule,
        AccountsModule,
        CategoriesModule,
        MerchantsModule,
        TransactionsModule,
        RecurringModule,
        AiModule,
        ReceiptsModule,
        DashboardModule,
        SummariesModule,
        HealthModule,
        DocsModule,
    ],
    providers: [RateLimitMiddleware],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
        consumer.apply(RateLimitMiddleware).forRoutes({path: "*", method: RequestMethod.ALL});
    }
}
