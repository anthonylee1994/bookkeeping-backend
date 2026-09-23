import {Injectable} from "@nestjs/common";

import {envInt, envOr} from "../config/env";

export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export type LihkgErrorKind = "invalid" | "circuit" | "upstream";

export class LihkgError extends Error {
    constructor(
        public readonly kind: LihkgErrorKind,
        message: string
    ) {
        super(message);
    }
}

interface CircuitState {
    failures: number;
    openUntil: number | null;
}

export interface UploadFile {
    bytes: Buffer;
    filename: string;
}

function detectContentType(bytes: Buffer): string | null {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return "image/jpeg";
    }
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return "image/png";
    }
    if (bytes.length >= 6 && (bytes.subarray(0, 6).toString("latin1") === "GIF87a" || bytes.subarray(0, 6).toString("latin1") === "GIF89a")) {
        return "image/gif";
    }
    if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") {
        return "image/webp";
    }
    return null;
}

@Injectable()
export class LihkgService {
    private circuit: CircuitState = {failures: 0, openUntil: null};

    private maxBytes(): number {
        return envInt("MAX_UPLOAD_BYTES", 10 * 1024 * 1024);
    }

    private circuitFailures(): number {
        return envInt("LIHKG_CIRCUIT_FAILURES", 5);
    }

    private circuitCooldownMs(): number {
        return envInt("LIHKG_CIRCUIT_COOLDOWN", 60) * 1000;
    }

    private circuitIsOpen(): boolean {
        if (this.circuit.openUntil !== null) {
            if (Date.now() < this.circuit.openUntil) {
                return true;
            }
            this.circuit.openUntil = null;
            this.circuit.failures = 0;
        }
        return false;
    }

    private recordSuccess(): void {
        this.circuit.failures = 0;
        this.circuit.openUntil = null;
    }

    private recordFailure(): void {
        this.circuit.failures += 1;
        if (this.circuit.failures >= this.circuitFailures()) {
            this.circuit.openUntil = Date.now() + this.circuitCooldownMs();
        }
    }

    /**
     * Uploads to the (unofficial) LIHKG image host. The outbound request MUST
     * carry `Origin: https://lihkg.com`; the host rejects anything else.
     */
    async upload(file: UploadFile): Promise<string> {
        if (file.bytes.length === 0) {
            throw new LihkgError("invalid", "file is required");
        }
        if (file.bytes.length > this.maxBytes()) {
            throw new LihkgError("invalid", "file is too large");
        }
        const contentType = detectContentType(file.bytes);
        if (!contentType || !ALLOWED_TYPES.includes(contentType)) {
            throw new LihkgError("invalid", "unsupported file type");
        }

        if (this.circuitIsOpen()) {
            throw new LihkgError("circuit", "LIHKG circuit is open");
        }

        const url = envOr("LIHKG_UPLOAD_URL", "https://img.eservice-hk.net/api.php?version=2");

        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(file.bytes)], {type: contentType}), file.filename);

        let response: Response;
        try {
            response = await fetch(url, {
                method: "POST",
                headers: {Origin: "https://lihkg.com"},
                body: form,
                signal: AbortSignal.timeout(10_000),
            });
        } catch (error) {
            this.recordFailure();
            throw new LihkgError("upstream", String(error));
        }

        if (!response.ok) {
            this.recordFailure();
            throw new LihkgError("upstream", `LIHKG upload failed (${response.status})`);
        }

        let body: Record<string, unknown>;
        try {
            body = (await response.json()) as Record<string, unknown>;
        } catch (error) {
            this.recordFailure();
            throw new LihkgError("upstream", String(error));
        }

        const found =
            (typeof body.url === "string" ? body.url : null) ??
            (typeof (body.data as Record<string, unknown> | undefined)?.url === "string" ? ((body.data as Record<string, unknown>).url as string) : null) ??
            (typeof (body.result as Record<string, unknown> | undefined)?.url === "string" ? ((body.result as Record<string, unknown>).url as string) : null);

        if (!found) {
            this.recordFailure();
            throw new LihkgError("upstream", "LIHKG response did not contain a URL");
        }

        this.recordSuccess();
        return found;
    }
}
