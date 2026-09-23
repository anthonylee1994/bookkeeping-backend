import {Module} from "@nestjs/common";

import {SummariesController} from "./summaries.controller";

@Module({
    controllers: [SummariesController],
})
export class SummariesModule {}
