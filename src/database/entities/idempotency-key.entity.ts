import {Column, Entity, Index, PrimaryColumn} from "typeorm";

@Entity("idempotency_keys")
@Index("index_idempotency_keys_on_user_id", ["user_id"])
@Index("index_idempotency_keys_on_user_id_and_key", ["user_id", "key"], {unique: true})
@Index("index_idempotency_keys_on_created_at", ["created_at"])
export class IdempotencyKey {
    @PrimaryColumn({type: "varchar", length: 36})
    id!: string;

    @Column({type: "varchar", length: 36})
    user_id!: string;

    @Column({type: "varchar"})
    key!: string;

    @Column({type: "varchar"})
    request_hash!: string;

    @Column({type: "integer", nullable: true})
    response_status!: number | null;

    @Column({type: "text", nullable: true})
    response_body!: string | null;

    @Column({type: "varchar"})
    created_at!: string;

    @Column({type: "varchar"})
    updated_at!: string;
}
