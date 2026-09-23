import "dotenv/config";
import {DataSource} from "typeorm";

import * as time from "../common/time";
import {buildDataSourceOptions} from "../database/data-source-options";
import {IdempotencyKey} from "../database/entities/idempotency-key.entity";

/** Deletes IdempotencyKey rows older than 24 hours. */
export async function cleanup(dataSource: DataSource): Promise<number> {
    const cutoff = time.toDbDatetime(time.addHours(time.nowLocal(), -24));
    const result = await dataSource.createQueryBuilder().delete().from(IdempotencyKey).where("created_at < :cutoff", {cutoff}).execute();
    return result.affected ?? 0;
}

async function main(): Promise<void> {
    const dataSource = new DataSource(buildDataSourceOptions());
    await dataSource.initialize();
    try {
        const deleted = await cleanup(dataSource);
        console.log(`maintenance cleanup done: deleted ${deleted} idempotency keys`);
    } finally {
        await dataSource.destroy();
    }
}

if (require.main === module) {
    void main();
}
