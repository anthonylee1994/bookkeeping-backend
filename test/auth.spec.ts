import {INestApplication} from "@nestjs/common";
import jwt from "jsonwebtoken";
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";

import {DataSource} from "typeorm";
import {User} from "../src/database/entities/user.entity";
import {createApp, http, HttpClient, resetDatabase} from "./helpers/app";
import {authHeader, registerAndLogin} from "./helpers/fixtures";

describe("auth", () => {
    let app: INestApplication;
    let client: HttpClient;
    let dataSource: DataSource;

    beforeAll(async () => {
        app = await createApp();
        client = http(app);
        dataSource = app.get(DataSource);
    });

    beforeEach(async () => {
        await resetDatabase(dataSource);
    });

    afterAll(async () => {
        await app.close();
    });

    it("register returns jwt and uuid without email", async () => {
        const response = await client.post("/api/v1/auth/register").send({username: "Alice", password: "secret123"});
        expect(response.status).toBe(201);
        const userId = response.body.data.user.id as string;
        expect(userId).toHaveLength(36);
        expect(userId).toMatch(/^[0-9a-f-]+$/);
        expect(response.body.data.user.username).toBe("alice");
        expect(response.body.data.token).toBeTruthy();
        expect(response.body.data.user.email).toBeUndefined();
    });

    it("register ignores email field", async () => {
        const response = await client.post("/api/v1/auth/register").send({username: "bob", password: "secret123", email: "bob@example.com"});
        expect(response.status).toBe(201);
        expect(response.body.data.user.email).toBeUndefined();
    });

    it("register rejects duplicate username case-insensitively", async () => {
        await registerAndLogin(client);
        const response = await client.post("/api/v1/auth/register").send({username: "ALICE", password: "secret123"});
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe("validation_error");
        expect(response.body.error.message).toBe("使用者名稱已被使用");
    });

    it("register rejects short password", async () => {
        const response = await client.post("/api/v1/auth/register").send({username: "alice", password: "short"});
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe("validation_error");
        expect(response.body.error.message).toBe("密碼至少需要 8 個字元");
    });

    it("login returns token for correct password and case-insensitive username", async () => {
        await registerAndLogin(client);
        const response = await client.post("/api/v1/auth/login").send({username: "ALICE", password: "secret123"});
        expect(response.status).toBe(200);
        expect(response.body.data.user.username).toBe("alice");
        expect(response.body.data.user.id).toHaveLength(36);
        expect(response.body.data.token).toBeTruthy();
    });

    it("login rejects wrong password and unknown username", async () => {
        await registerAndLogin(client);

        const wrong = await client.post("/api/v1/auth/login").send({username: "alice", password: "wrong-password"});
        expect(wrong.status).toBe(401);
        expect(wrong.body.error.code).toBe("invalid_credentials");
        expect(wrong.body.error.message).toBe("使用者名稱或密碼不正確");
        expect(wrong.body.error.request_id).toBeTruthy();

        const unknown = await client.post("/api/v1/auth/login").send({username: "nobody", password: "secret123"});
        expect(unknown.status).toBe(401);
        expect(unknown.body.error.code).toBe("invalid_credentials");
    });

    it("session endpoints are absent", async () => {
        expect((await client.delete("/api/v1/auth/logout")).status).toBe(404);
        expect((await client.get("/api/v1/sessions")).status).toBe(404);
    });

    it("me returns current user", async () => {
        const fixture = await registerAndLogin(client);
        const response = await client.get("/api/v1/me").set(authHeader(fixture.token));
        expect(response.status).toBe(200);
        expect(response.body.data.id).toBe(fixture.userId);
        expect(response.body.data.username).toBe("alice");
        expect(response.body.data.timezone).toBe("Asia/Hong_Kong");
        expect(response.body.data.currency).toBe("HKD");
    });

    it("me rejects missing, malformed and forged tokens", async () => {
        expect((await client.get("/api/v1/me")).status).toBe(401);

        const malformed = await client.get("/api/v1/me").set({Authorization: "Bearer not-a-jwt"});
        expect(malformed.status).toBe(401);
        expect(malformed.body.error.code).toBe("unauthorized");

        const fixture = await registerAndLogin(client);
        const forged = jwt.sign({user_id: fixture.userId, iat: 1_700_000_000}, "forged-secret", {
            algorithm: "HS256",
        });
        const response = await client.get("/api/v1/me").set({Authorization: `Bearer ${forged}`});
        expect(response.status).toBe(401);
    });

    it("me rejects token when user no longer exists", async () => {
        const fixture = await registerAndLogin(client);
        await dataSource.getRepository(User).delete({id: fixture.userId});
        const response = await client.get("/api/v1/me").set(authHeader(fixture.token));
        expect(response.status).toBe(401);
    });

    it("the same token works for multiple requests", async () => {
        const fixture = await registerAndLogin(client);
        const first = await client.get("/api/v1/me").set(authHeader(fixture.token));
        expect(first.status).toBe(200);
        const id = first.body.data.id;
        const second = await client.get("/api/v1/me").set(authHeader(fixture.token));
        expect(second.body.data.id).toBe(id);
    });

    it("update password success and login afterwards", async () => {
        const fixture = await registerAndLogin(client);
        const response = await client.patch("/api/v1/me/password").set(authHeader(fixture.token)).send({
            password_challenge: "secret123",
            password: "newsecret123",
            password_confirmation: "newsecret123",
        });
        expect(response.status).toBe(200);
        expect(response.body.data.username).toBe("alice");

        const login = await client.post("/api/v1/auth/login").send({username: "alice", password: "newsecret123"});
        expect(login.status).toBe(200);
        expect(login.body.data.token).toBeTruthy();

        const old = await client.post("/api/v1/auth/login").send({username: "alice", password: "secret123"});
        expect(old.status).toBe(401);
    });

    it("update password rejects bad input", async () => {
        const fixture = await registerAndLogin(client);
        const headers = authHeader(fixture.token);

        const wrong = await client.patch("/api/v1/me/password").set(headers).send({password_challenge: "wrong-password", password: "newsecret123"});
        expect(wrong.status).toBe(422);
        expect(wrong.body.error.code).toBe("invalid_current_password");
        expect(wrong.body.error.message).toBe("目前密碼不正確");

        const missingChallenge = await client.patch("/api/v1/me/password").set(headers).send({password: "newsecret123"});
        expect(missingChallenge.status).toBe(422);
        expect(missingChallenge.body.error.code).toBe("invalid_current_password");

        const short = await client.patch("/api/v1/me/password").set(headers).send({password_challenge: "secret123", password: "short"});
        expect(short.status).toBe(422);
        expect(short.body.error.code).toBe("validation_error");
        expect(short.body.error.message).toBe("密碼至少需要 8 個字元");

        const mismatch = await client.patch("/api/v1/me/password").set(headers).send({
            password_challenge: "secret123",
            password: "newsecret123",
            password_confirmation: "different123",
        });
        expect(mismatch.status).toBe(422);
        expect(mismatch.body.error.code).toBe("validation_error");

        const missingNew = await client.patch("/api/v1/me/password").set(headers).send({password_challenge: "secret123"});
        expect(missingNew.status).toBe(422);
        expect(missingNew.body.error.code).toBe("validation_error");

        const login = await client.post("/api/v1/auth/login").send({username: "alice", password: "secret123"});
        expect(login.status).toBe(200);
    });

    it("update password requires a token", async () => {
        await registerAndLogin(client);
        const response = await client.patch("/api/v1/me/password").send({password_challenge: "secret123", password: "newsecret123"});
        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe("unauthorized");
    });
});
