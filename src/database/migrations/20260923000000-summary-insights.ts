import type {MigrationInterface, QueryRunner} from "typeorm";

/**
 * Adds `summary_insights`, the cache table for AI-generated period insights.
 *
 * Follows the init migration conventions: SQLite TEXT-affinity `varchar`
 * timestamps, `IF NOT EXISTS` so the migration is safe to re-run against a
 * database that already has the table.
 */
export class SummaryInsights20260923000000 implements MigrationInterface {
    name = "SummaryInsights20260923000000";

    private readonly statements: string[] = [
        `CREATE TABLE IF NOT EXISTS summary_insights (
        id varchar(36) NOT NULL PRIMARY KEY,
        user_id varchar(36) NOT NULL,
        period varchar NOT NULL,
        period_key varchar NOT NULL,
        fingerprint varchar NOT NULL,
        prompt_version varchar NOT NULL,
        provider varchar NOT NULL DEFAULT 'deepseek',
        model varchar NOT NULL DEFAULT 'deepseek-flash',
        status integer NOT NULL DEFAULT 0,
        text text,
        highlights_json text NOT NULL DEFAULT '[]',
        raw_response text,
        error_message text,
        tokens_in integer,
        tokens_out integer,
        latency_ms integer,
        created_at varchar NOT NULL,
        updated_at varchar NOT NULL,
        CONSTRAINT fk_summary_insights_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )`,
        `CREATE INDEX IF NOT EXISTS index_summary_insights_on_user_id ON summary_insights (user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_summary_insights_lookup ON summary_insights (user_id, period, period_key, fingerprint, prompt_version)`,
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const statement of this.statements) {
            await queryRunner.query(statement);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const statement of [`DROP TABLE IF EXISTS summary_insights`]) {
            await queryRunner.query(statement);
        }
    }
}
