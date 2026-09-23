import {Column, Entity, Index, PrimaryColumn} from "typeorm";

@Entity("users")
@Index("index_users_on_username", ["username"], {unique: true})
export class User {
    @PrimaryColumn({type: "varchar", length: 36})
    id!: string;

    @Column({type: "varchar"})
    username!: string;

    @Column({type: "varchar"})
    password_digest!: string;

    @Column({type: "varchar", default: "Asia/Hong_Kong"})
    timezone!: string;

    @Column({type: "varchar", default: "HKD"})
    currency!: string;

    @Column({type: "varchar"})
    created_at!: string;

    @Column({type: "varchar"})
    updated_at!: string;
}
