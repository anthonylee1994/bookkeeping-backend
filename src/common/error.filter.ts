import {ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger} from "@nestjs/common";
import type {Response} from "express";

import {ApiError} from "./errors";

/**
 * Renders every uncaught exception with the unified error envelope and keeps
 * the `X-Request-Id` that `requestIdMiddleware` attached.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger("ApiExceptionFilter");

    catch(exception: unknown, host: ArgumentsHost): void {
        const response = host.switchToHttp().getResponse<Response>();

        if (exception instanceof ApiError) {
            response.status(exception.status).json(exception.body());
            return;
        }

        if (exception instanceof HttpException) {
            const status = exception.getStatus();
            const mapped =
                status === 404
                    ? ApiError.notFound()
                    : status === 401
                      ? ApiError.unauthorized()
                      : status === 429
                        ? ApiError.rateLimited()
                        : new ApiError(status, "internal_server_error", exception.message);
            response.status(mapped.status).json(mapped.body());
            return;
        }

        this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
        const internal = ApiError.internal();
        response.status(internal.status).json(internal.body());
    }
}
