import {currentRequestId} from "./request-id";

export type ErrorDetails = Record<string, string[]>;

export interface ErrorBody {
    error: {
        code: string;
        message: string;
        details?: ErrorDetails;
        request_id: string;
    };
}

/**
 * Unified API error matching the documented envelope:
 * `{ "error": { "code", "message", "details"?, "request_id" } }`
 */
export class ApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: string,
        message: string,
        public readonly details?: ErrorDetails
    ) {
        super(message);
        this.name = "ApiError";
    }

    withDetails(details: ErrorDetails): ApiError {
        return new ApiError(this.status, this.code, this.message, details);
    }

    body(): ErrorBody {
        const error: ErrorBody["error"] = {
            code: this.code,
            message: this.message,
            request_id: currentRequestId() ?? "",
        };
        if (this.details) {
            error.details = this.details;
        }
        return {error};
    }

    static unauthorized(): ApiError {
        return new ApiError(401, "unauthorized", "請先登入");
    }

    static invalidCredentials(): ApiError {
        return new ApiError(401, "invalid_credentials", "使用者名稱或密碼不正確");
    }

    static invalidCurrentPassword(): ApiError {
        return new ApiError(422, "invalid_current_password", "目前密碼不正確");
    }

    static notFound(): ApiError {
        return new ApiError(404, "not_found", "找不到指定的資料");
    }

    static parameterMissing(parameter: string): ApiError {
        return new ApiError(422, "validation_error", `缺少必要參數或參數不可為空：${parameter}`);
    }

    static invalidValue(): ApiError {
        return new ApiError(422, "validation_error", "參數值無效");
    }

    static validation(message: string, details: ErrorDetails): ApiError {
        return new ApiError(422, "validation_error", message, details);
    }

    static accountInUse(): ApiError {
        return new ApiError(422, "account_in_use", "帳戶已有交易或週期性規則，無法刪除");
    }

    static idempotencyConflict(): ApiError {
        return new ApiError(422, "idempotency_conflict", "相同的 Idempotency-Key 已用於不同請求");
    }

    static alreadyMaterialized(): ApiError {
        return new ApiError(409, "already_materialized", "該次週期交易已經建立");
    }

    static upstreamError(message: string): ApiError {
        return new ApiError(502, "upstream_error", message);
    }

    static rateLimited(): ApiError {
        return new ApiError(429, "rate_limited", "請求過於頻繁，請稍後再試");
    }

    static internal(): ApiError {
        return new ApiError(500, "internal_server_error", "Internal Server Error");
    }
}
