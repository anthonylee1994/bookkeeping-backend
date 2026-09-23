import {isAbsolute, resolve} from "node:path";

import type {BetterSqlite3DataSourceOptions} from "typeorm/driver/better-sqlite3/BetterSqlite3DataSourceOptions";

import {ENTITIES} from "./entities";
import {InitSchema20260921000000} from "./migrations/20260921000000-init";
import {SummaryInsights20260923000000} from "./migrations/20260923000000-summary-insights";

const DEFAULT_DATABASE_URL = "file:../storage/development.sqlite3";

/**
 * Resolves a `file:` SQLite URL to an absolute filesystem path.
 *
 * Legacy Prisma URLs were relative to `prisma/schema.prisma`, so the canonical
 * value is `file:../storage/<env>.sqlite3`. To stay 100% compatible with
 * existing deployments those `..`-prefixed URLs are still resolved against
 * `<root>/prisma` (which points back at `<root>/storage`). Any other relative
 * URL is resolved against the process working directory (the repository root),
 * so `file:./storage/development.sqlite3` also works.
 */
export function resolveDatabasePath(url: string | undefined = process.env.DATABASE_URL): string {
    const value = (url ?? DEFAULT_DATABASE_URL).trim();
    const withoutScheme = value.startsWith("file:") ? value.slice("file:".length) : value;
    if (withoutScheme === "" || withoutScheme === ":memory:") {
        return ":memory:";
    }
    if (isAbsolute(withoutScheme)) {
        return withoutScheme;
    }
    const base = withoutScheme.startsWith("..") ? resolve(process.cwd(), "prisma") : process.cwd();
    return resolve(base, withoutScheme);
}

/** Options shared by the Nest application DataSource and the CLI tasks. */
export function buildDataSourceOptions(overrides: Partial<BetterSqlite3DataSourceOptions> = {}): BetterSqlite3DataSourceOptions {
    return {
        type: "better-sqlite3",
        database: resolveDatabasePath(),
        entities: ENTITIES,
        migrations: [InitSchema20260921000000, SummaryInsights20260923000000],
        migrationsTableName: "migrations",
        migrationsRun: true,
        synchronize: false,
        enableWAL: true,
        prepareDatabase: (db: {pragma: (sql: string) => unknown}) => {
            // WAL + foreign keys are set by the driver; keep durability cheap.
            db.pragma("synchronous = NORMAL");
        },
        ...overrides,
    };
}
