import {Column, Entity, Index, PrimaryColumn} from "typeorm";

@Entity("transactions")
@Index("index_transactions_on_user_id", ["user_id"])
@Index("index_transactions_on_account_id", ["account_id"])
@Index("index_transactions_on_category_id", ["category_id"])
@Index("index_transactions_on_merchant_id", ["merchant_id"])
@Index("index_transactions_on_transfer_account_id", ["transfer_account_id"])
@Index("index_transactions_on_user_id_and_occurred_at", ["user_id", "occurred_at"])
@Index("index_transactions_on_user_id_and_kind_and_occurred_at", ["user_id", "kind", "occurred_at"])
@Index("index_transactions_on_user_id_and_occurred_at_and_kind", ["user_id", "occurred_at", "kind"])
export class Transaction {
    @PrimaryColumn({type: "varchar", length: 36})
    id!: string;

    @Column({type: "varchar", length: 36})
    user_id!: string;

    @Column({type: "varchar", length: 36})
    account_id!: string;

    @Column({type: "varchar", length: 36, nullable: true})
    category_id!: string | null;

    @Column({type: "varchar", length: 36, nullable: true})
    merchant_id!: string | null;

    @Column({type: "integer"})
    kind!: number;

    @Column({type: "integer"})
    amount_cents!: number;

    @Column({type: "varchar", default: "HKD"})
    currency!: string;

    @Column({type: "varchar"})
    occurred_at!: string;

    @Column({type: "text", nullable: true})
    note!: string | null;

    @Column({type: "varchar", nullable: true})
    payment_method!: string | null;

    @Column({type: "text", default: "[]"})
    image_urls!: string;

    @Column({type: "integer", default: 0})
    source!: number;

    @Column({type: "varchar", length: 36, nullable: true})
    transfer_account_id!: string | null;

    @Column({type: "varchar", nullable: true})
    idempotency_key!: string | null;

    @Column({type: "varchar"})
    created_at!: string;

    @Column({type: "varchar"})
    updated_at!: string;
}
