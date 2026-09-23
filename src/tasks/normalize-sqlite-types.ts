import "dotenv/config";
import Database from "better-sqlite3";

import {resolveDatabasePath} from "../database/data-source-options";

interface TableRow {
    name: string;
    sql: string;
}

/**
 * Legacy Rails / loco.rs databases declare their date/time columns as
 * `datetime(6)` / `date`. The application now uses TypeORM, which (unlike
 * Prisma) reads those TEXT-affinity values as plain strings, so the rewrite is
 * no longer strictly required — it is kept to normalise the declared types so
 * the schema stays canonical and portable.
 *
 * This rewrites the declarations in place to `varchar` (TEXT affinity),
 * preserving every row — no table rebuild needed.
 */
export function rewriteSql(sql: string): string {
    return sql
        .replace(/\bdatetime\(6\)/gi, "varchar")
        .replace(/\sdatetime\b/gi, " varchar")
        .replace(/\stimestamp\b/gi, " varchar")
        .replace(/\sdate\b/gi, " varchar")
        .replace(/\stime\b/gi, " varchar");
}

/**
 * Rewrites unsupported temporal column declarations to `varchar`. The legacy
 * Prisma `_prisma_migrations` bookkeeping table is skipped (its `DATETIME`
 * columns must stay native for old databases). Idempotent: returns the number
 * of tables changed (0 when the database is already clean).
 */
export function normalizeSqliteTypes(db: Database.Database): number {
    const rows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL " + "AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'").all() as TableRow[];

    const edits = rows.map(row => ({name: row.name, sql: rewriteSql(row.sql), previous: row.sql})).filter(row => row.sql !== row.previous);
    if (edits.length === 0) {
        return 0;
    }

    db.unsafeMode(true);
    db.pragma("writable_schema = ON");
    try {
        const update = db.prepare("UPDATE sqlite_master SET sql = ? WHERE name = ? AND type = ?");
        for (const edit of edits) {
            update.run(edit.sql, edit.name, "table");
        }
    } finally {
        db.pragma("writable_schema = OFF");
        db.unsafeMode(false);
    }

    // Force this connection (and, via the schema cookie, any others) to re-read
    // the rewritten declarations instead of the cached schema.
    db.pragma("writable_schema = RESET");
    const row = db.prepare("PRAGMA schema_version").get() as {schema_version: number};
    db.pragma(`schema_version = ${Number(row.schema_version) + 1}`);

    return edits.length;
}

function main(): void {
    const db = new Database(resolveDatabasePath());
    try {
        const changed = normalizeSqliteTypes(db);
        console.log(`sqlite type normalization done: rewrote ${changed} table(s)`);
    } finally {
        db.close();
    }
}

if (require.main === module) {
    main();
}
