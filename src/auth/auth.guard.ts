import {CanActivate, ExecutionContext, Injectable} from "@nestjs/common";
import {Reflector} from "@nestjs/core";
import {InjectRepository} from "@nestjs/typeorm";
import {Repository} from "typeorm";

import {ApiError} from "../common/errors";
import {User} from "../database/entities/user.entity";
import {RecurringService} from "../recurring/recurring.service";
import {AuthService} from "./auth.service";
import {AuthenticatedRequest} from "./current-user.decorator";
import {IS_PUBLIC_KEY} from "./public.decorator";

/**
 * Authenticated-user guard. Decodes the Bearer token, loads the user and runs
 * recurring catch-up before the handler executes.
 */
@Injectable()
export class AuthGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly auth: AuthService,
        @InjectRepository(User) private readonly users: Repository<User>,
        private readonly recurring: RecurringService
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
        if (isPublic) {
            return true;
        }

        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        const header = request.headers.authorization;
        const raw = Array.isArray(header) ? header[0] : header;
        const token = this.auth.bearerToken(raw);
        if (!token) {
            throw ApiError.unauthorized();
        }

        const userId = this.auth.decodeToken(token);
        if (!userId) {
            throw ApiError.unauthorized();
        }

        const user = await this.users.findOne({where: {id: userId}});
        if (!user) {
            throw ApiError.unauthorized();
        }

        request.user = user;
        await this.recurring.catchUp(user.id);
        return true;
    }
}
