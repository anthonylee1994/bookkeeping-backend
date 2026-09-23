import {Module} from "@nestjs/common";

import {AiModule} from "../ai/ai.module";
import {SummariesController} from "./summaries.controller";
import {SummariesInsightController} from "./summaries-insight.controller";
import {SummariesService} from "./summaries.service";

@Module({
    imports: [AiModule],
    controllers: [SummariesController, SummariesInsightController],
    providers: [SummariesService],
})
export class SummariesModule {}
