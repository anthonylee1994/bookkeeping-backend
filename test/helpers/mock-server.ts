import {IncomingHttpHeaders, createServer} from "node:http";

export interface RecordedRequest {
    method: string;
    path: string;
    headers: IncomingHttpHeaders;
    body: Buffer;
}

export interface MockResponse {
    status?: number;
    headers?: Record<string, string>;
    body?: Buffer | string;
}

export interface MockServer {
    uri: string;
    requests: RecordedRequest[];
    close(): Promise<void>;
    countRequests(path: string): number;
}

/** Minimal HTTP mock used in place of the Rust `wiremock` test server. */
export async function startMockServer(handler: (request: RecordedRequest) => MockResponse): Promise<MockServer> {
    const requests: RecordedRequest[] = [];

    const server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
            const recorded: RecordedRequest = {
                method: req.method ?? "",
                path: req.url ?? "",
                headers: req.headers,
                body: Buffer.concat(chunks),
            };
            requests.push(recorded);

            const result = handler(recorded);
            res.statusCode = result.status ?? 200;
            for (const [key, value] of Object.entries(result.headers ?? {})) {
                res.setHeader(key, value);
            }
            res.end(result.body ?? "");
        });
    });

    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;

    return {
        uri: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise<void>(resolve => server.close(() => resolve())),
        countRequests: (path: string) => requests.filter(request => request.path.split("?")[0] === path).length,
    };
}
