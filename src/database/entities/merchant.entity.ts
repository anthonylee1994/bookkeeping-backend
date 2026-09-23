import {Column, Entity, Index, PrimaryColumn} from "typeorm";

@Entity("merchants")
@Index("index_merchants_on_user_id", ["user_id"])
@Index("index_merchants_on_user_id_and_name", ["user_id", "name"], {unique: true})
@Index("index_merchants_on_default_category_id", ["default_category_id"])
export class Merchant {
    @PrimaryColumn({type: "varchar", length: 36})
    id!: string;

    @Column({type: "varchar", length: 36})
    user_id!: string;

    @Column({type: "varchar"})
    name!: string;

    @Column({type: "varchar", length: 36, nullable: true})
    default_category_id!: string | null;

    @Column({type: "integer", default: 0})
    usage_count!: number;

    @Column({type: "varchar"})
    created_at!: string;

    @Column({type: "varchar"})
    updated_at!: string;
}
