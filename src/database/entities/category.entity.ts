import {Column, Entity, Index, PrimaryColumn} from "typeorm";

@Entity("categories")
@Index("index_categories_on_user_id", ["user_id"])
@Index("index_categories_on_user_id_and_kind_and_name", ["user_id", "kind", "name"], {
    unique: true,
})
export class Category {
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

    @Column({type: "varchar"})
    created_at!: string;

    @Column({type: "varchar"})
    updated_at!: string;
}
