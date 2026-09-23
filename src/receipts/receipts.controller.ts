import {Controller, HttpCode, Post, UploadedFile, UseInterceptors} from "@nestjs/common";
import {FileInterceptor} from "@nestjs/platform-express";

import {ApiError} from "../common/errors";
import {sha256Hex} from "../common/util";
import {LihkgError, LihkgService, UploadFile} from "./lihkg.service";

@Controller("api/v1/receipts")
export class ReceiptsController {
    constructor(private readonly lihkg: LihkgService) {}

    @Post("upload")
    @HttpCode(201)
    @UseInterceptors(FileInterceptor("file"))
    async upload(@UploadedFile() file?: Express.Multer.File): Promise<unknown> {
        if (!file) {
            throw new ApiError(422, "validation_error", "file is required");
        }

        const upload: UploadFile = {
            bytes: file.buffer,
            filename: file.originalname || "upload",
        };
        const sha = sha256Hex(file.buffer);

        try {
            const url = await this.lihkg.upload(upload);
            return {data: {url, sha256: sha}};
        } catch (error) {
            if (error instanceof LihkgError) {
                if (error.kind === "invalid") {
                    throw new ApiError(422, "validation_error", error.message);
                }
                throw ApiError.upstreamError(error.message);
            }
            throw error;
        }
    }
}
