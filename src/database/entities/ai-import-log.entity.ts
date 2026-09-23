import {Column, Entity, Index, PrimaryColumn} from "typeorm";

@Entity("ai_import_logs")
@Index("index_ai_import_logs_on_user_id", ["user_id"])
@Index("index_ai_import_logs_on_image_sha256", ["image_sha256"])
@Index("index_ai_import_logs_on_transaction_id", ["transaction_id"])
@Index("idx_on_user_id_image_sha256_created_at_a5f17f3d34", ["user_id", "image_sha256", "created_at"])
@Index("idx_ai_import_logs_cache_lookup", ["user_id", "image_sha256", "parse_signature"])
export class AiImportLog {
    @PrimaryColumn({type: "varchar", length: 36})
    id!: string;

    @Column({type: "varchar", length: 36})
    user_id!: string;

    @Column({type: "text", default: "[]"})
    image_urls!: string;

    @Column({type: "varchar"})
    image_sha256!: string;

    @Column({type: "varchar", nullable: true})
    parse_signature!: string | null;

    /** Origin of the parse: `receipt`（圖片）或 `text`（自然語言打字記帳）。 */
    @Column({type: "varchar", default: "receipt"})
    source!: string;

    @Column({type: "varchar", default: "deepseek"})
    provider!: string;

    @Column({type: "varchar", default: "deepseek-flash"})
    model!: string;

    @Column({type: "integer", nullable: true})
    tokens_in!: number | null;

    @Column({type: "integer", nullable: true})
    tokens_out!: number | null;

    @Column({type: "integer", nullable: true})
    latency_ms!: number | null;

    @Column({type: "integer", default: 0})
    status!: number;

    @Column({type: "text", nullable: true})
    raw_response!: string | null;

    @Column({type: "text", nullable: true})
    parsed_json!: string | null;

    @Column({type: "text", nullable: true})
    error_message!: string | null;

    @Column({type: "varchar", length: 36, nullable: true})
    transaction_id!: string | null;

    @Column({type: "varchar", nullable: true})
    idempotency_key!: string | null;

    @Column({type: "varchar"})
    created_at!: string;

    @Column({type: "varchar"})
    updated_at!: string;
}
