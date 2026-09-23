import {afterEach, describe, expect, it, vi} from "vitest";

import {LihkgError, LihkgService} from "../src/receipts/lihkg.service";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([0, 0, 0, 0])]);

function uploadResponse(body: unknown): {ok: boolean; status: number; json: () => Promise<unknown>} {
    return {ok: true, status: 200, json: async () => body};
}

describe("LihkgService (unit)", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it("rejects an empty file", async () => {
        await expect(new LihkgService().upload({bytes: Buffer.alloc(0), filename: "x.jpg"})).rejects.toMatchObject({kind: "invalid"});
    });

    it("rejects a file over the size limit", async () => {
        vi.stubEnv("MAX_UPLOAD_BYTES", "10");
        await expect(new LihkgService().upload({bytes: Buffer.alloc(11, 1), filename: "x.jpg"})).rejects.toMatchObject({kind: "invalid"});
    });

    it("rejects an unsupported file type", async () => {
        await expect(new LihkgService().upload({bytes: Buffer.from("MZxxxx"), filename: "x.exe"})).rejects.toMatchObject({kind: "invalid"});
    });

    it("uploads a jpeg and reads the top-level url", async () => {
        const fetchMock = vi.fn().mockResolvedValue(uploadResponse({url: "https://img.eservice-hk.net/a.jpg"}));
        vi.stubGlobal("fetch", fetchMock);

        await expect(new LihkgService().upload({bytes: JPEG, filename: "a.jpg"})).resolves.toBe("https://img.eservice-hk.net/a.jpg");

        const init = fetchMock.mock.calls[0]?.[1] as {headers: Record<string, string>};
        expect(init.headers.Origin).toBe("https://lihkg.com");
    });

    it("detects PNG magic numbers", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(uploadResponse({url: "https://img/b.png"})));
        await expect(new LihkgService().upload({bytes: PNG, filename: "b.png"})).resolves.toBe("https://img/b.png");
    });

    it("reads a nested data.url or result.url", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(uploadResponse({data: {url: "https://img/c.jpg"}})));
        await expect(new LihkgService().upload({bytes: JPEG, filename: "c.jpg"})).resolves.toBe("https://img/c.jpg");

        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(uploadResponse({result: {url: "https://img/d.jpg"}})));
        await expect(new LihkgService().upload({bytes: JPEG, filename: "d.jpg"})).resolves.toBe("https://img/d.jpg");
    });

    it("maps a non-ok response to an upstream error", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok: false, status: 500, json: async () => ({})}));
        await expect(new LihkgService().upload({bytes: JPEG, filename: "a.jpg"})).rejects.toMatchObject({kind: "upstream"});
    });

    it("maps a network failure to an upstream error", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
        await expect(new LihkgService().upload({bytes: JPEG, filename: "a.jpg"})).rejects.toMatchObject({kind: "upstream"});
    });

    it("maps unreadable JSON and a missing url to upstream errors", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok: true, status: 200, json: async () => Promise.reject(new Error("bad"))}));
        await expect(new LihkgService().upload({bytes: JPEG, filename: "a.jpg"})).rejects.toMatchObject({kind: "upstream"});

        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(uploadResponse({unexpected: true})));
        await expect(new LihkgService().upload({bytes: JPEG, filename: "a.jpg"})).rejects.toMatchObject({kind: "upstream"});
    });

    it("opens the circuit after repeated failures and short-circuits", async () => {
        vi.stubEnv("LIHKG_CIRCUIT_FAILURES", "2");
        const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
        vi.stubGlobal("fetch", fetchMock);
        const service = new LihkgService();

        await expect(service.upload({bytes: JPEG, filename: "a.jpg"})).rejects.toBeInstanceOf(LihkgError);
        await expect(service.upload({bytes: JPEG, filename: "a.jpg"})).rejects.toBeInstanceOf(LihkgError);

        await expect(service.upload({bytes: JPEG, filename: "a.jpg"})).rejects.toMatchObject({kind: "circuit"});
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("resets the failure counter after a success", async () => {
        vi.stubEnv("LIHKG_CIRCUIT_FAILURES", "2");
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(new Error("boom"))
            .mockResolvedValueOnce(uploadResponse({url: "https://img/ok.jpg"}))
            .mockRejectedValueOnce(new Error("boom"));
        vi.stubGlobal("fetch", fetchMock);
        const service = new LihkgService();

        await expect(service.upload({bytes: JPEG, filename: "a.jpg"})).rejects.toMatchObject({kind: "upstream"});
        await expect(service.upload({bytes: JPEG, filename: "a.jpg"})).resolves.toBe("https://img/ok.jpg");
        await expect(service.upload({bytes: JPEG, filename: "a.jpg"})).rejects.toMatchObject({kind: "upstream"});
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});
