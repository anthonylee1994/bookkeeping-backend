import {createParamDecorator, ExecutionContext} from "@nestjs/common";
import type {Request} from "express";

import type {User} from "../database/entities/user.entity";

export type AuthenticatedRequest = Request & {user: User};

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): User => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
});
