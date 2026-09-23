import {AsyncLocalStorage} from "node:async_hooks";
import {randomUUID} from "node:crypto";
import type {NextFunction, Request, Response} from "express";

export const REQUEST_ID_HEADER = "x-request-id";

const storage = new AsyncLocalStorage<{requestId: string}>();

export function currentRequestId(): string | undefined {
    return storage.getStore()?.requestId;
}

/** Express middleware: reads/creates `X-Request-Id`, exposes it, echoes it back. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers[REQUEST_ID_HEADER];
    const incoming = Array.isArray(header) ? header[0] : header;
    const trimmed = typeof incoming === "string" ? incoming.trim() : "";
    const requestId = trimmed !== "" ? trimmed : randomUUID();

    res.setHeader("X-Request-Id", requestId);
    storage.run({requestId}, () => next());
}
