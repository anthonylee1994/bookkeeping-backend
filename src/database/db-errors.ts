/**
 * Detects a SQLite unique-constraint violation raised through the TypeORM
 * `QueryFailedError` wrapper (the original better-sqlite3 error lives on
 * `driverError`). The legacy Prisma `P2002` code is still accepted so error
 * handling stays stable across the ORM migration.
 */
export function isUniqueViolation(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
        return false;
    }

    const candidate = error as {
        code?: string;
        message?: string;
        driverError?: {code?: string; message?: string};
    };

    if (candidate.code === "P2002") {
        return true;
    }

    const driverCode = candidate.driverError?.code ?? candidate.code;
    if (driverCode === "SQLITE_CONSTRAINT_UNIQUE" || driverCode === "SQLITE_CONSTRAINT_PRIMARYKEY") {
        return true;
    }

    const message = candidate.driverError?.message ?? candidate.message ?? "";
    return /UNIQUE constraint failed/i.test(message);
}
