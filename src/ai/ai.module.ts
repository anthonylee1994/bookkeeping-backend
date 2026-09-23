import {Module} from "@nestjs/common";

import {IdempotencyModule} from "../idempotency/idempotency.module";
import {TransactionsModule} from "../transactions/transactions.module";
import {AiController} from "./ai.controller";
import {DeepseekService} from "./deepseek.service";

@Module({
    imports: [TransactionsModule, IdempotencyModule],
    controllers: [AiController],
    providers: [DeepseekService],
    exports: [DeepseekService],
})
export class AiModule {}
