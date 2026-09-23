import {execSync} from "node:child_process";
import {mkdirSync, readdirSync, rmSync} from "node:fs";
import Database from "better-sqlite3";
import {config} from "dotenv";

import {resolveDatabasePath} from "../src/database/data-source-options";

/** Runs once before any test file: build a migrated template database. */
export default function globalSetup(): void {
    config({path: ".env.test", override: true});
    process.env.NODE_ENV = "test";
    mkdirSync("storage", {recursive: true});

    for (const entry of readdirSync("storage")) {
        if (/^test.*\.sqlite3(-wal|-shm)?$/.test(entry)) {
            rmSync(`storage/${entry}`, {force: true});
        }
    }

    const template = "test-template.sqlite3";
    process.env.DATABASE_URL = `file:../storage/${template}`;
    execSync("pnpm exec tsx src/tasks/migrate.ts", {stdio: "inherit", env: process.env});

    // Fold the WAL back into the main file so a plain file copy is complete.
    const db = new Database(resolveDatabasePath(process.env.DATABASE_URL));
    try {
        db.pragma("wal_checkpoint(TRUNCATE)");
        db.pragma("journal_mode = DELETE");
    } finally {
        db.close();
    }
    for (const suffix of ["-wal", "-shm"]) {
        rmSync(`storage/${template}${suffix}`, {force: true});
    }
}
