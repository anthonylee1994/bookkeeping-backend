import {Body, Controller, HttpCode, Post} from "@nestjs/common";
import type {JsonObject} from "../common/params";
import {ApiError} from "../common/errors";
import {ValidationErrors} from "../common/validation";
import {isUniqueViolation} from "../database/db-errors";
import {userPayload} from "../views/serializers";
import {Public} from "./public.decorator";
import {AuthService} from "./auth.service";
import {normalizeUsername, UsersService} from "../users/users.service";

@Public()
@Controller("api/v1/auth")
export class AuthController {
    constructor(
        private readonly users: UsersService,
        private readonly auth: AuthService
    ) {}

    @Post("register")
    async register(@Body() body: JsonObject): Promise<unknown> {
        const username = typeof body.username === "string" ? body.username : "";
        const password = typeof body.password === "string" ? body.password : "";

        const errors = new ValidationErrors();
        const normalized = normalizeUsername(username);
        if (normalized === "") {
            errors.add("username", "使用者名稱", "不可為空白");
        } else if ([...normalized].length > 64) {
            errors.add("username", "使用者名稱", "最多可輸入 64 個字元");
        }
        if (password === "") {
            errors.add("password", "密碼", "不可為空白");
        } else if ([...password].length < 8) {
            errors.add("password", "密碼", "至少需要 8 個字元");
        }
        if (!errors.isEmpty) {
            throw errors.toApiError();
        }

        if ((await this.users.findByUsername(normalized)) !== null) {
            throw usernameTaken();
        }

        let user;
        try {
            user = await this.users.createUser(normalized, password);
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw usernameTaken();
            }
            throw error;
        }

        return {data: {token: this.auth.encodeToken(user.id), user: userPayload(user)}};
    }

    @Post("login")
    @HttpCode(200)
    async login(@Body() body: JsonObject): Promise<unknown> {
        const username = typeof body.username === "string" ? body.username : "";
        const password = typeof body.password === "string" ? body.password : "";

        const user = await this.users.findByUsername(username);
        if (!user || !this.users.verifyPassword(user, password)) {
            throw ApiError.invalidCredentials();
        }

        return {data: {token: this.auth.encodeToken(user.id), user: userPayload(user)}};
    }
}

function usernameTaken(): ApiError {
    return ApiError.validation("使用者名稱已被使用", {username: ["已被使用"]});
}
