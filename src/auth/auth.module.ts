import {Module} from "@nestjs/common";
import {APP_GUARD} from "@nestjs/core";

import {RecurringModule} from "../recurring/recurring.module";
import {UsersModule} from "../users/users.module";
import {AuthGuard} from "./auth.guard";
import {AuthService} from "./auth.service";
import {AuthController} from "./auth.controller";
import {MeController} from "./me.controller";

@Module({
    imports: [UsersModule, RecurringModule],
    controllers: [AuthController, MeController],
    providers: [AuthService, AuthGuard, {provide: APP_GUARD, useClass: AuthGuard}],
    exports: [AuthService],
})
export class AuthModule {}
