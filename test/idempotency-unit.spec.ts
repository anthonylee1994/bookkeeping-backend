import {beforeEach, describe, expect, it, vi} from "vitest";

import {ApiError} from "../src/common/errors";
import * as time from "../src/common/time";
import {sha256Hex} from "../src/common/util";
import {IdempotencyKey} from "../src/database/entities/idempotency-key.entity";
import {IdempotencyService} from "../src/idempotency/idempotency.service";
import {idempotencyFixture, MockRepo, mockRepo, repo} from "./helpers/unit";

function requestHash(method: string, path: string, rawBody: Buffer): string {
    return sha256Hex(Buffer.concat([Buffer.from(method, "utf8"), Buffer.from([0]), Buffer.from(path, "utf8"), Buffer.from([0]), rawBody]));
}

describe("IdempotencyService (unit)", () => {
    let keys: MockRepo;
    let service: IdempotencyService;
    const rawBody = Buffer.from(JSON.stringify({amount_cents: 1000}));
    const run = vi.fn();

    function options(idempotencyKey: string | null) {
        return {userId: "user-1", method: "POST", path: "/api/v1/transactions", rawBody, idempotencyKey, run};
    }

    beforeEach(() => {
        keys = mockRepo();
        service = new IdempotencyService(repo<IdempotencyKey>(keys));
        run.mockReset();
        run.mockResolvedValue({status: 201, body: {data: {id: "t1"}}});
    });

    it("executes directly when the key is missing or blank", async () => {
        await expect(service.wrap(options(null))).resolves.toEqual({status: 201, body: {data: {id: "t1"}}});
        await expect(service.wrap(options("   "))).resolves.toEqual({status: 201, body: {data: {id: "t1"}}});
        expect(keys.findOne).not.toHaveBeenCalled();
        expect(keys.insert).not.toHaveBeenCalled();
        expect(run).toHaveBeenCalledTimes(2);
    });

    it("replays a stored response for a matching recent key", async () => {
        keys.findOne.mockResolvedValue(
            idempotencyFixture({request_hash: requestHash("POST", "/api/v1/transactions", rawBody), response_status: 200, response_body: JSON.stringify({data: {id: "old"}})})
        );

        await expect(service.wrap(options("k1"))).resolves.toEqual({status: 200, body: {data: {id: "old"}}});
        expect(run).not.toHaveBeenCalled();
    });

    it("rejects a reused key with a different request body", async () => {
        keys.findOne.mockResolvedValue(idempotencyFixture({request_hash: "different"}));

        await expect(service.wrap(options("k1"))).rejects.toMatchObject({status: 422, code: "idempotency_conflict"});
        expect(run).not.toHaveBeenCalled();
    });

    it("runs and inserts a new record when no key exists", async () => {
        keys.findOne.mockResolvedValue(null);

        await service.wrap(options("k1"));

        expect(run).toHaveBeenCalledTimes(1);
        const inserted = keys.insert.mock.calls[0]?.[0] as IdempotencyKey;
        expect(inserted).toMatchObject({user_id: "user-1", key: "k1", response_status: 201, request_hash: requestHash("POST", "/api/v1/transactions", rawBody)});
    });

    it("overwrites an expired record instead of replaying it", async () => {
        keys.findOne.mockResolvedValue(idempotencyFixture({id: "old", created_at: time.toDbDatetime(time.addHours(time.nowLocal(), -25)), request_hash: "stale"}));

        await service.wrap(options("k1"));

        expect(run).toHaveBeenCalledTimes(1);
        expect(keys.update).toHaveBeenCalledWith({id: "old"}, expect.objectContaining({response_status: 201, request_hash: requestHash("POST", "/api/v1/transactions", rawBody)}));
        expect(keys.insert).not.toHaveBeenCalled();
    });

    it("records an ApiError response instead of throwing", async () => {
        keys.findOne.mockResolvedValue(null);
        run.mockRejectedValue(ApiError.invalidValue());

        const result = await service.wrap(options("k1"));

        expect(result.status).toBe(422);
        expect(keys.insert).toHaveBeenCalledTimes(1);
    });

    it("swallows a concurrent insert collision", async () => {
        keys.findOne.mockResolvedValue(null);
        keys.insert.mockRejectedValue({driverError: {code: "SQLITE_CONSTRAINT_UNIQUE"}});

        await expect(service.wrap(options("k1"))).resolves.toEqual({status: 201, body: {data: {id: "t1"}}});
    });

    it("falls back to an empty body when the stored body is missing", async () => {
        keys.findOne.mockResolvedValue(idempotencyFixture({request_hash: requestHash("POST", "/api/v1/transactions", rawBody), response_status: null, response_body: null}));

        await expect(service.wrap(options("k1"))).resolves.toEqual({status: 200, body: {}});
    });
});
