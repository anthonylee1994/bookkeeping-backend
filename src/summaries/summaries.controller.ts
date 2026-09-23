import {Controller, Get, Query} from "@nestjs/common";

import {CurrentUser} from "../auth/current-user.decorator";
import type {User} from "../database/entities/user.entity";
import type {InsightPeriod} from "./insight";
import {SummariesService} from "./summaries.service";

@Controller("api/v1/summaries")
export class SummariesController {
    constructor(private readonly summaries: SummariesService) {}

    @Get("daily")
    daily(@CurrentUser() user: User, @Query("date") date?: string, @Query("page") page?: string, @Query("per_page") perPage?: string): Promise<unknown> {
        return this.summarize(user, "daily", date, page, perPage);
    }

    @Get("weekly")
    weekly(@CurrentUser() user: User, @Query("date") date?: string, @Query("page") page?: string, @Query("per_page") perPage?: string): Promise<unknown> {
        return this.summarize(user, "weekly", date, page, perPage);
    }

    @Get("monthly")
    monthly(@CurrentUser() user: User, @Query("date") date?: string, @Query("page") page?: string, @Query("per_page") perPage?: string): Promise<unknown> {
        return this.summarize(user, "monthly", date, page, perPage);
    }

    private async summarize(user: User, period: InsightPeriod, dateParam?: string, pageParam?: string, perPageParam?: string): Promise<unknown> {
        const {data} = await this.summaries.build(user.id, period, dateParam, pageParam, perPageParam);
        return {data};
    }
}
