import {Column, Entity, Index, PrimaryColumn} from "typeorm";

@Entity("accounts")
@Index("index_accounts_on_user_id", ["user_id"])
@Index("index_accounts_on_user_id_and_name", ["user_id", "name"], {unique: true})
export class Account {
    @PrimaryColumn({type: "varchar", length: 36})
    id!: string;

    @Column({type: "varchar", length: 36})
    user_id!: string;

    @Column({type: "varchar"})
    name!: string;

    @Column({type: "integer"})
    kind!: number;

    @Column({type: "varchar", nullable: true})
    icon!: string | null;

    @Column({type: "varchar", nullable: true})
    color!: string | null;

    @Column({type: "integer", default: 0})
    initial_balance_cents!: number;

    @Column({type: "varchar", default: "HKD"})
    currency!: string;

    @Column({type: "varchar"})
    created_at!: string;

    @Column({type: "varchar"})
    updated_at!: string;
}
