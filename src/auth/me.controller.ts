import {Body, Controller, Get, Patch} from "@nestjs/common";
import type {JsonObject} from "../common/params";
import {ApiError} from "../common/errors";
import {ValidationErrors} from "../common/validation";
import type {User} from "../database/entities/user.entity";
import {userPayload} from "../views/serializers";
import {CurrentUser} from "./current-user.decorator";
import {UsersService} from "../users/users.service";

@Controller("api/v1")
export class MeController {
    constructor(private readonly users: UsersService) {}

    @Get("me")
    show(@CurrentUser() user: User): unknown {
        return {data: userPayload(user)};
    }

    @Patch("me/password")
    async updatePassword(@CurrentUser() user: User, @Body() body: JsonObject): Promise<unknown> {
        const challenge = typeof body.password_challenge === "string" ? body.password_challenge : "";
        if (!this.users.verifyPassword(user, challenge)) {
            throw ApiError.invalidCurrentPassword();
        }

        if (typeof body.password !== "string") {
            throw ApiError.parameterMissing("password");
        }
        const password = body.password;
        const confirmation = typeof body.password_confirmation === "string" ? body.password_confirmation : undefined;

        const errors = new ValidationErrors();
        if ([...password].length < 8) {
            errors.add("password", "密碼", "至少需要 8 個字元");
        }
        if (confirmation !== undefined && confirmation !== password) {
            errors.add("password_confirmation", "確認密碼", "與密碼不一致");
        }
        if (!errors.isEmpty) {
            throw errors.toApiError();
        }

        const updated = await this.users.updatePassword(user, password);
        return {data: userPayload(updated)};
    }
}
