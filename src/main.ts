import "dotenv/config";
import "reflect-metadata";
import {Logger} from "@nestjs/common";
import {NestFactory} from "@nestjs/core";

import {AppModule} from "./app.module";
import {configureApp} from "./app.setup";
import {envInt, envOr} from "./config/env";

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule, {rawBody: false});
    configureApp(app);

    const port = envInt("PORT", 3000);
    const host = envOr("HOST", "0.0.0.0");
    await app.listen(port, host);
    new Logger("Bootstrap").log(`Bookkeeping API listening on http://${host}:${port}`);
}

void bootstrap();
