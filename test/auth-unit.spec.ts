import {beforeEach, describe, expect, it, vi} from "vitest";
import jwt from "jsonwebtoken";

import {AuthController} from "../src/auth/auth.controller";
import {MeController} from "../src/auth/me.controller";
import {AuthService} from "../src/auth/auth.service";
import {UsersService} from "../src/users/users.service";
import {userFixture} from "./helpers/unit";

describe("AuthService (JWT)", () => {
    const auth = new AuthService();
    const secret = process.env.JWT_SECRET ?? "dev-jwt-secret";

    function decode(token: string, signingSecret: string): Record<string, unknown> | null {
        const payload = jwt.verify(token, signingSecret, {
            algorithms: ["HS256"],
            ignoreExpiration: true,
        });
        return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
    }

    it("encodes with HS256 and omits exp and jti", () => {
        const token = auth.encodeToken("user-1");
        expect(jwt.decode(token, {complete: true})?.header.alg).toBe("HS256");

        const payload = decode(token, secret);
        expect(payload?.user_id).toBe("user-1");
        expect(typeof payload?.iat).toBe("number");
        expect(payload?.exp).toBeUndefined();
        expect(payload?.jti).toBeUndefined();
    });

    it("decodes a valid token", () => {
        const token = auth.encodeToken("user-2");
        expect(auth.decodeToken(token)).toBe("user-2");
    });

    it("rejects a token signed with another secret", () => {
        const token = jwt.sign({user_id: "user-3", iat: 1_700_000_000}, "other-secret", {
            algorithm: "HS256",
        });
        expect(auth.decodeToken(token)).toBeNull();
    });

    it("rejects a malformed token", () => {
        expect(auth.decodeToken("not-a-jwt")).toBeNull();
    });

    it("rejects an alg=none token", () => {
        const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
        const token = `${encode({alg: "none", typ: "JWT"})}.${encode({user_id: "user-4"})}.`;
        expect(auth.decodeToken(token)).toBeNull();
    });

    it("accepts an expired exp", () => {
        const token = jwt.sign({user_id: "user-5", iat: 1, exp: 1}, secret, {
            algorithm: "HS256",
        });
        expect(auth.decodeToken(token)).toBe("user-5");
    });

    it("decodeTokenUnsafe reads claims without verification", () => {
        const token = jwt.sign({user_id: "user-6", iat: 1}, "other-secret", {algorithm: "HS256"});
        expect(auth.decodeTokenUnsafe(token)).toBe("user-6");
    });

    it("parses bearer tokens case-insensitively", () => {
        expect(auth.bearerToken("Bearer abc")).toBe("abc");
        expect(auth.bearerToken("bearer abc")).toBe("abc");
        expect(auth.bearerToken("Basic abc")).toBeNull();
        expect(auth.bearerToken("Bearer   ")).toBeNull();
        expect(auth.bearerToken(undefined)).toBeNull();
    });
});

describe("AuthController (unit)", () => {
    let users: {findByUsername: ReturnType<typeof vi.fn>; verifyPassword: ReturnType<typeof vi.fn>; createUser: ReturnType<typeof vi.fn>};
    let auth: {encodeToken: ReturnType<typeof vi.fn>};
    let controller: AuthController;

    beforeEach(() => {
        users = {findByUsername: vi.fn().mockResolvedValue(null), verifyPassword: vi.fn(), createUser: vi.fn()};
        auth = {encodeToken: vi.fn().mockReturnValue("signed-token")};
        controller = new AuthController(users as unknown as UsersService, auth as unknown as AuthService);
    });

    it("register rejects a blank username and a short password", async () => {
        await expect(controller.register({username: "  ", password: "short"})).rejects.toMatchObject({details: {username: ["不可為空白"], password: ["至少需要 8 個字元"]}});
    });

    it("register rejects an over-long username", async () => {
        await expect(controller.register({username: "a".repeat(65), password: "secret123"})).rejects.toMatchObject({details: {username: ["最多可輸入 64 個字元"]}});
    });

    it("register lowercases the username and rejects duplicates", async () => {
        users.findByUsername.mockResolvedValue(userFixture({username: "alice"}));
        await expect(controller.register({username: "Alice", password: "secret123"})).rejects.toMatchObject({details: {username: ["已被使用"]}});
        expect(users.findByUsername).toHaveBeenCalledWith("alice");
    });

    it("register maps a unique violation race to a duplicate error", async () => {
        users.createUser.mockRejectedValue({driverError: {code: "SQLITE_CONSTRAINT_UNIQUE"}});
        await expect(controller.register({username: "alice", password: "secret123"})).rejects.toMatchObject({details: {username: ["已被使用"]}});
    });

    it("register returns a token and the user payload", async () => {
        users.createUser.mockResolvedValue(userFixture({id: "u1", username: "alice"}));

        const result = (await controller.register({username: "Alice", password: "secret123"})) as {data: {token: string; user: Record<string, unknown>}};

        expect(users.createUser).toHaveBeenCalledWith("alice", "secret123");
        expect(result.data.token).toBe("signed-token");
        expect(result.data.user).toMatchObject({id: "u1", username: "alice", currency: "HKD"});
    });

    it("login rejects unknown users and wrong passwords", async () => {
        await expect(controller.login({username: "nobody", password: "secret123"})).rejects.toMatchObject({status: 401, code: "invalid_credentials"});

        users.findByUsername.mockResolvedValue(userFixture());
        users.verifyPassword.mockReturnValue(false);
        await expect(controller.login({username: "alice", password: "wrong"})).rejects.toMatchObject({code: "invalid_credentials"});
    });

    it("login returns a token for correct credentials", async () => {
        users.findByUsername.mockResolvedValue(userFixture({id: "u1", username: "alice"}));
        users.verifyPassword.mockReturnValue(true);

        const result = (await controller.login({username: "alice", password: "secret123"})) as {data: {token: string}};
        expect(result.data.token).toBe("signed-token");
    });
});

describe("MeController (unit)", () => {
    let users: {verifyPassword: ReturnType<typeof vi.fn>; updatePassword: ReturnType<typeof vi.fn>};
    let controller: MeController;

    beforeEach(() => {
        users = {verifyPassword: vi.fn(), updatePassword: vi.fn()};
        controller = new MeController(users as unknown as UsersService);
    });

    it("show returns the current user", () => {
        const result = controller.show(userFixture({id: "u1", username: "alice"})) as {data: Record<string, unknown>};
        expect(result.data).toMatchObject({id: "u1", username: "alice"});
    });

    it("updatePassword rejects a bad current password", async () => {
        users.verifyPassword.mockReturnValue(false);
        await expect(controller.updatePassword(userFixture(), {password_challenge: "wrong", password: "newsecret123"})).rejects.toMatchObject({code: "invalid_current_password"});
    });

    it("updatePassword requires a new password and matching confirmation", async () => {
        users.verifyPassword.mockReturnValue(true);

        await expect(controller.updatePassword(userFixture(), {password_challenge: "secret123"})).rejects.toMatchObject({status: 422});

        const mismatch = controller.updatePassword(userFixture(), {password_challenge: "secret123", password: "newsecret123", password_confirmation: "different123"});
        await expect(mismatch).rejects.toMatchObject({details: {password_confirmation: ["與密碼不一致"]}});
    });

    it("updatePassword rejects a short password", async () => {
        users.verifyPassword.mockReturnValue(true);
        await expect(controller.updatePassword(userFixture(), {password_challenge: "secret123", password: "short"})).rejects.toMatchObject({details: {password: ["至少需要 8 個字元"]}});
    });

    it("updatePassword persists and returns the updated user", async () => {
        users.verifyPassword.mockReturnValue(true);
        users.updatePassword.mockResolvedValue(userFixture({id: "u1", username: "alice"}));

        const result = (await controller.updatePassword(userFixture({id: "u1"}), {password_challenge: "secret123", password: "newsecret123", password_confirmation: "newsecret123"})) as {
            data: Record<string, unknown>;
        };

        expect(users.updatePassword).toHaveBeenCalledWith(expect.objectContaining({id: "u1"}), "newsecret123");
        expect(result.data.username).toBe("alice");
    });
});
