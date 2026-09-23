import {Injectable} from "@nestjs/common";
import {InjectRepository} from "@nestjs/typeorm";
import {Repository} from "typeorm";

import {ApiError} from "../common/errors";
import * as time from "../common/time";
import {jsonParse, newId, sha256Hex} from "../common/util";
import {IdempotencyKey} from "../database/entities/idempotency-key.entity";

export interface IdempotentResponse {
    status: number;
    body: unknown;
}

export interface IdempotencyOptions {
    userId: string;
    method: string;
    path: string;
    rawBody: Buffer;
    idempotencyKey: string | null;
    run: () => Promise<IdempotentResponse>;
}

/**
 * `Idempotency-Key` semantics: a matching key within 24h replays the stored
 * response; the same key with a different request hash is a 422
 * `idempotency_conflict`.
 */
@Injectable()
export class IdempotencyService {
    constructor(
        @InjectRepository(IdempotencyKey)
        private readonly idempotencyKeys: Repository<IdempotencyKey>
    ) {}

    async wrap(options: IdempotencyOptions): Promise<IdempotentResponse> {
        const key = options.idempotencyKey?.trim() ?? "";
        if (key === "") {
            return this.execute(options.run);
        }

        const requestHash = sha256Hex(Buffer.concat([Buffer.from(options.method, "utf8"), Buffer.from([0]), Buffer.from(options.path, "utf8"), Buffer.from([0]), options.rawBody]));

        const existing = await this.idempotencyKeys.findOne({
            where: {user_id: options.userId, key},
        });

        if (existing) {
            const cutoff = time.toDbDatetime(time.addHours(time.nowLocal(), -24));
            if (existing.created_at > cutoff) {
                if (existing.request_hash !== requestHash) {
                    throw ApiError.idempotencyConflict();
                }
                const status = existing.response_status ?? 200;
                const body = existing.response_body ? jsonParse<unknown>(existing.response_body, {}) : {};
                return {status, body};
            }
        }

        const result = await this.execute(options.run);
        const now = time.toDbDatetime(time.nowLocal());

        if (existing) {
            await this.idempotencyKeys.update(
                {id: existing.id},
                {
                    request_hash: requestHash,
                    response_status: result.status,
                    response_body: JSON.stringify(result.body),
                    created_at: now,
                    updated_at: now,
                }
            );
        } else {
            try {
                await this.idempotencyKeys.insert({
                    id: newId(),
                    user_id: options.userId,
                    key,
                    request_hash: requestHash,
                    response_status: result.status,
                    response_body: JSON.stringify(result.body),
                    created_at: now,
                    updated_at: now,
                });
            } catch {
                // Concurrent insert with the same key: ignore, the other request owns it.
            }
        }

        return result;
    }

    private async execute(run: () => Promise<IdempotentResponse>): Promise<IdempotentResponse> {
        try {
            return await run();
        } catch (error) {
            if (error instanceof ApiError) {
                return {status: error.status, body: error.body()};
            }
            throw error;
        }
    }
}
