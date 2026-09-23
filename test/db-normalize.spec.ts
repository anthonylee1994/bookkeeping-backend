import Database from "better-sqlite3";
import {afterAll, beforeAll, describe, expect, it} from "vitest";

import {resolveDatabasePath} from "../src/database/data-source-options";
import {normalizeSqliteTypes, rewriteSql} from "../src/tasks/normalize-sqlite-types";

interface ColumnInfo {
    name: string;
    type: string;
}

describe("rewriteSql", () => {
    it("rewrites legacy temporal declarations to varchar", () => {
        const legacy = 'CREATE TABLE "recurring_rules" ("id" varchar(36) NOT NULL, "start_on" date NOT NULL, ' + '"occurred_at" datetime(6) NOT NULL, "created_at" datetime(6) NOT NULL)';
        const fixed = rewriteSql(legacy);
        expect(fixed).not.toContain("datetime");
        expect(fixed).toContain('"start_on" varchar');
        expect(fixed).toContain('"occurred_at" varchar');
        expect(fixed).toContain('"created_at" varchar');
    });

    it('does not touch a quoted column literally named "date"', () => {
        const sql = 'CREATE TABLE t ("date" varchar NOT NULL, "id" varchar(36))';
        expect(rewriteSql(sql)).toBe(sql);
    });

    it("leaves the canonical schema unchanged", () => {
        const canonical = 'CREATE TABLE t ("id" varchar(36) NOT NULL, "start_on" varchar NOT NULL, ' + '"updated_at" varchar NOT NULL)';
        expect(rewriteSql(canonical)).toBe(canonical);
    });
});

describe("normalizeSqliteTypes", () => {
    let db: Database.Database;

    beforeAll(() => {
        db = new Database(resolveDatabasePath());
    });

    afterAll(() => {
        db.exec("DROP TABLE IF EXISTS legacy_probe");
        db.close();
    });

    it("repairs a legacy declared type so TypeORM can read the table", () => {
        db.exec("DROP TABLE IF EXISTS legacy_probe");
        db.exec('CREATE TABLE legacy_probe ("id" varchar(36) NOT NULL PRIMARY KEY, "created_at" datetime(6) NOT NULL, "occurred_on" date NOT NULL)');
        db.prepare("INSERT INTO legacy_probe (id, created_at, occurred_on) VALUES (?, ?, ?)").run("p1", "2026-09-01 10:00:00.000", "2026-09-01");

        const changed = normalizeSqliteTypes(db);
        expect(changed).toBeGreaterThanOrEqual(1);

        const columns = db.prepare("PRAGMA table_info(legacy_probe)").all() as ColumnInfo[];
        const types = Object.fromEntries(columns.map(column => [column.name, column.type]));
        expect(types.created_at).toBe("varchar");
        expect(types.occurred_on).toBe("varchar");

        const rows = db.prepare("SELECT created_at FROM legacy_probe").all() as Array<{
            created_at: string;
        }>;
        expect(rows[0].created_at).toBe("2026-09-01 10:00:00.000");

        // Idempotent: a second run changes nothing.
        expect(normalizeSqliteTypes(db)).toBe(0);
    });
});
