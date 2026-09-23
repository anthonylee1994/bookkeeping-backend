import type {MigrationInterface, QueryRunner} from "typeorm";

/**
 * Adds `ai_import_logs.source`, distinguishing 圖片單據（`receipt`）同
 * 自然語言打字記帳（`text`）兩種來源。舊有記錄一律回填 `receipt`。
 *
 * SQLite 嘅 `ALTER TABLE ... ADD COLUMN` 唔支援 `IF NOT EXISTS`，但
 * TypeORM 嘅 migrations table 保證只跑一次。
 */
export class AiImportLogSource20260923010000 implements MigrationInterface {
    name = "AiImportLogSource20260923010000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE ai_import_logs ADD COLUMN source varchar NOT NULL DEFAULT 'receipt'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE ai_import_logs DROP COLUMN source`);
    }
}
