import {Column, Entity, Index, PrimaryColumn} from "typeorm";

/**
 * Cache for AI-generated period insights (`GET /summaries/:period/insight`).
 *
 * A row is keyed by `(user_id, period, period_key, fingerprint, prompt_version)`
 * where `fingerprint` is a hash of the deterministic summary data. When the
 * underlying transactions change the fingerprint changes, so the next read
 * regenerates instead of serving stale text — no eager write-path updates.
 */
@Entity("summary_insights")
@Index("index_summary_insights_on_user_id", ["user_id"])
@Index("idx_summary_insights_lookup", ["user_id", "period", "period_key", "fingerprint", "prompt_version"])
export class SummaryInsight {
    @PrimaryColumn({type: "varchar", length: 36})
    id!: string;

    @Column({type: "varchar", length: 36})
    user_id!: string;

    @Column({type: "varchar"})
    period!: string;

    @Column({type: "varchar"})
    period_key!: string;

    @Column({type: "varchar"})
    fingerprint!: string;

    @Column({type: "varchar"})
    prompt_version!: string;

    @Column({type: "varchar", default: "deepseek"})
    provider!: string;

    @Column({type: "varchar", default: "deepseek-flash"})
    model!: string;

    @Column({type: "integer", default: 0})
    status!: number;

    @Column({type: "text", nullable: true})
    text!: string | null;

    @Column({type: "text", default: "[]"})
    highlights_json!: string;

    @Column({type: "text", nullable: true})
    raw_response!: string | null;

    @Column({type: "text", nullable: true})
    error_message!: string | null;

    @Column({type: "integer", nullable: true})
    tokens_in!: number | null;

    @Column({type: "integer", nullable: true})
    tokens_out!: number | null;

    @Column({type: "integer", nullable: true})
    latency_ms!: number | null;

    @Column({type: "varchar"})
    created_at!: string;

    @Column({type: "varchar"})
    updated_at!: string;
}
