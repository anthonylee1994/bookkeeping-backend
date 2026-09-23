import {Column, Entity, Index, PrimaryColumn} from "typeorm";

@Entity("recurring_occurrences")
@Index("idx_recurring_occurrences_unique", ["recurring_rule_id", "occurred_on"], {unique: true})
@Index("index_recurring_occurrences_on_recurring_rule_id", ["recurring_rule_id"])
@Index("index_recurring_occurrences_on_transaction_id", ["transaction_id"])
export class RecurringOccurrence {
    @PrimaryColumn({type: "varchar", length: 36})
    id!: string;

    @Column({type: "varchar", length: 36})
    recurring_rule_id!: string;

    @Column({type: "varchar"})
    occurred_on!: string;

    @Column({type: "varchar", length: 36, nullable: true})
    transaction_id!: string | null;

    @Column({type: "varchar"})
    created_at!: string;

    @Column({type: "varchar"})
    updated_at!: string;
}
