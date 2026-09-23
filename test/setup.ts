import "reflect-metadata";
import {copyFileSync, mkdirSync} from "node:fs";
import {config} from "dotenv";

config({path: ".env.test", override: true});
process.env.NODE_ENV = "test";

mkdirSync("storage", {recursive: true});

// Each test file gets its own SQLite database (a copy of the migrated
// template) so files can never wipe each other's fixtures, even when Vitest
// starts them in parallel.
const unique = `test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
copyFileSync("storage/test-template.sqlite3", `storage/${unique}.sqlite3`);
process.env.DATABASE_URL = `file:../storage/${unique}.sqlite3`;
