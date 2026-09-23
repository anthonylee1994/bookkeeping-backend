import {beforeEach, describe, expect, it, vi} from "vitest";

import {sha256Hex} from "../src/common/util";
import {LihkgError, LihkgService} from "../src/receipts/lihkg.service";
import {ReceiptsController} from "../src/receipts/receipts.controller";

function file(buffer: Buffer, originalname = "receipt.jpg"): Express.Multer.File {
    return {buffer, originalname} as Express.Multer.File;
}

describe("ReceiptsController (unit)", () => {
    let lihkg: {upload: ReturnType<typeof vi.fn>};
    let controller: ReceiptsController;

    beforeEach(() => {
        lihkg = {upload: vi.fn()};
        controller = new ReceiptsController(lihkg as unknown as LihkgService);
    });

    it("requires a file", async () => {
        await expect(controller.upload(undefined)).rejects.toMatchObject({status: 422, code: "validation_error", message: "file is required"});
    });

    it("uploads and returns the url plus digest", async () => {
        const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
        lihkg.upload.mockResolvedValue("https://img.eservice-hk.net/a.jpg");

        const result = (await controller.upload(file(bytes, "receipt.jpg"))) as {data: {url: string; sha256: string}};

        expect(lihkg.upload).toHaveBeenCalledWith({bytes, filename: "receipt.jpg"});
        expect(result.data.url).toBe("https://img.eservice-hk.net/a.jpg");
        expect(result.data.sha256).toBe(sha256Hex(bytes));
    });

    it("defaults a missing filename", async () => {
        const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
        lihkg.upload.mockResolvedValue("https://img.eservice-hk.net/b.jpg");

        await controller.upload(file(bytes, ""));

        expect(lihkg.upload).toHaveBeenCalledWith({bytes, filename: "upload"});
    });

    it("maps an invalid upload to a 422", async () => {
        lihkg.upload.mockRejectedValue(new LihkgError("invalid", "unsupported file type"));
        await expect(controller.upload(file(Buffer.from([1, 2, 3])))).rejects.toMatchObject({status: 422, code: "validation_error"});
    });

    it("maps a circuit or upstream failure to a 502", async () => {
        lihkg.upload.mockRejectedValue(new LihkgError("circuit", "LIHKG circuit is open"));
        await expect(controller.upload(file(Buffer.from([0xff, 0xd8, 0xff])))).rejects.toMatchObject({status: 502, code: "upstream_error"});
    });
});
