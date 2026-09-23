import {INestApplication} from "@nestjs/common";
import {json} from "express";
import type {Request} from "express";

import {ApiExceptionFilter} from "./common/error.filter";
import {requestIdMiddleware} from "./common/request-id";
import {envList} from "./config/env";

/**
 * Shared bootstrap so tests and `main.ts` apply the exact same middleware:
 * request id -> JSON body parser (captures `rawBody` for idempotency) -> CORS.
 */
export function configureApp(app: INestApplication): void {
    app.use(requestIdMiddleware);
    app.use(
        json({
            limit: "12mb",
            verify: (request, _response, buffer) => {
                (request as Request & {rawBody?: Buffer}).rawBody = Buffer.from(buffer);
            },
        })
    );

    app.enableCors({
        origin: envList("CORS_ORIGINS"),
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
        allowedHeaders: "*",
        exposedHeaders: ["authorization", "x-request-id"],
    });

    app.useGlobalFilters(new ApiExceptionFilter());
}
