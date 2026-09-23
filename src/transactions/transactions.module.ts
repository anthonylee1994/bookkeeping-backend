import {Module} from "@nestjs/common";

import {IdempotencyModule} from "../idempotency/idempotency.module";
import {TransactionsController} from "./transactions.controller";
import {TransactionsService} from "./transactions.service";

@Module({
    imports: [IdempotencyModule],
    controllers: [TransactionsController],
    providers: [TransactionsService],
    exports: [TransactionsService],
})
export class TransactionsModule {}
