import {Module} from "@nestjs/common";

import {ReceiptsController} from "./receipts.controller";
import {LihkgService} from "./lihkg.service";

@Module({
    controllers: [ReceiptsController],
    providers: [LihkgService],
    exports: [LihkgService],
})
export class ReceiptsModule {}
