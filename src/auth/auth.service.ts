import {Injectable} from "@nestjs/common";
import jwt from "jsonwebtoken";

import {envOr} from "../config/env";

const TOKEN_ALGORITHM = "HS256";

export interface AuthClaims {
    user_id: string;
    iat: number;
}

/**
 * JWT + password helpers. Tokens carry `user_id` + `iat` and deliberately no
 * `exp`, matching the spec: every environment ignores expiration and logout is
 * client-side only.
 */
@Injectable()
export class AuthService {
    private readonly secret = envOr("JWT_SECRET", "dev-jwt-secret");

    encodeToken(userId: string): string {
        const claims: AuthClaims = {user_id: userId, iat: Math.floor(Date.now() / 1000)};
        return jwt.sign(claims, this.secret, {algorithm: TOKEN_ALGORITHM});
    }

    decodeToken(token: string): string | null {
        try {
            const payload = jwt.verify(token, this.secret, {
                algorithms: [TOKEN_ALGORITHM],
                ignoreExpiration: true,
            });
            if (typeof payload === "object" && payload !== null && typeof payload.user_id === "string") {
                return payload.user_id;
            }
            return null;
        } catch {
            return null;
        }
    }

    /** Best-effort decode without signature verification (rate-limit keys). */
    decodeTokenUnsafe(token: string): string | null {
        const payload = jwt.decode(token);
        if (payload && typeof payload === "object" && typeof payload.user_id === "string") {
            return payload.user_id;
        }
        return null;
    }

    bearerToken(header: string | undefined): string | null {
        if (header === undefined) {
            return null;
        }
        const trimmed = header.trim();
        const space = trimmed.indexOf(" ");
        if (space === -1) {
            return null;
        }
        const scheme = trimmed.slice(0, space);
        if (scheme.toLowerCase() !== "bearer") {
            return null;
        }
        const token = trimmed.slice(space + 1).trim();
        return token === "" ? null : token;
    }
}
