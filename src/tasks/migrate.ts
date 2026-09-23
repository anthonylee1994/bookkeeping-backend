import "dotenv/config";
import {DataSource} from "typeorm";

import {buildDataSourceOptions} from "../database/data-source-options";

/** Applies every pending migration, then exits. Used by CI/tests and Dokku. */
export async function runMigrations(): Promise<void> {
    const dataSource = new DataSource(buildDataSourceOptions({migrationsRun: false}));
    await dataSource.initialize();
    try {
        const applied = await dataSource.runMigrations();
        console.log(`migrations applied: ${applied.length}`);
    } finally {
        await dataSource.destroy();
    }
}

if (require.main === module) {
    void runMigrations();
}
