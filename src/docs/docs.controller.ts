import {Controller, Get, Res} from "@nestjs/common";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import type {Response} from "express";

import {Public} from "../auth/public.decorator";

@Public()
@Controller()
export class DocsController {
    @Get("api-docs")
    spec(@Res() response: Response): void {
        const path = join(process.cwd(), "swagger", "v1", "swagger.yaml");
        response.type("application/yaml").send(readFileSync(path, "utf8"));
    }
}
