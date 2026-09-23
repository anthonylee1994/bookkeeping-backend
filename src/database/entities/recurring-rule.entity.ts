import {Column, Entity, Index, PrimaryColumn} from "typeorm";

@Entity("recurring_rules")
@Index("index_recurring_rules_on_user_id", ["user_id"])
@Index("index_recurring_rules_on_account_id", ["account_id"])
@Index("index_recurring_rules_on_category_id", ["category_id"])
@Index("index_recurring_rules_on_merchant_id", ["merchant_id"])
@Index("index_recurring_rules_on_user_id_and_status_and_next_run_at", ["user_id", "status", "next_run_at"])
export class RecurringRule {
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

    @Column({type: "integer"})
    frequency!: number;

    @Column({type: "integer", default: 1})
    interval!: number;

    @Column({type: "integer", nullable: true})
    day_of_week!: number | null;

    @Column({type: "integer", nullable: true})
    day_of_month!: number | null;

    @Column({type: "integer", nullable: true})
    month_of_year!: number | null;

    @Column({type: "varchar"})
    start_on!: string;

    @Column({type: "varchar", nullable: true})
    end_on!: string | null;

    @Column({type: "varchar"})
    next_run_at!: string;

    @Column({type: "varchar", nullable: true})
    last_run_at!: string | null;

    @Column({type: "integer", default: 0})
    status!: number;

    @Column({type: "text", nullable: true})
    note!: string | null;

    @Column({type: "varchar"})
    created_at!: string;

    @Column({type: "varchar"})
    updated_at!: string;
}
