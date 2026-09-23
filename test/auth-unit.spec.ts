import {describe, expect, it} from "vitest";
import jwt from "jsonwebtoken";

import {AuthService} from "../src/auth/auth.service";

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
