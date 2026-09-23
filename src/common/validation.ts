import {ApiError, ErrorDetails} from "./errors";

/**
 * Collects Rails-style validation errors: a per-field `details` map plus the
 * first full message used as the top-level `message`.
 */
export class ValidationErrors {
    private readonly details: ErrorDetails = {};
    private first?: string;

    /**
     * `human` is the localized attribute name, `message` the localized message;
     * the reported full message is the concatenation (Rails `errors.format` =
     * `%{attribute}%{message}`).
     */
    add(field: string, human: string, message: string): void {
        if (this.first === undefined) {
            this.first = `${human}${message}`;
        }
        (this.details[field] ??= []).push(message);
    }

    get isEmpty(): boolean {
        return Object.keys(this.details).length === 0;
    }

    toApiError(): ApiError {
        if (this.isEmpty) {
            return ApiError.invalidValue();
        }
        return ApiError.validation(this.first ?? "", this.details);
    }
}
