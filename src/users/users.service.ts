import {Injectable} from "@nestjs/common";
import {InjectRepository} from "@nestjs/typeorm";
import bcrypt from "bcryptjs";
import {DataSource, Repository} from "typeorm";

import * as time from "../common/time";
import {newId} from "../common/util";
import {Account} from "../database/entities/account.entity";
import {Category} from "../database/entities/category.entity";
import {User} from "../database/entities/user.entity";

const DEFAULT_COLOR = "#ecf0f1";

const DEFAULT_EXPENSE_CATEGORIES: Array<[string, string]> = [
    ["飲食", "mdi:food"],
    ["交通", "mdi:bus"],
    ["娛樂", "mdi:music"],
    ["購物", "mdi:cart"],
    ["醫療", "mdi:medical-bag"],
    ["住屋", "mdi:home"],
    ["水電", "mdi:lightning-bolt"],
    ["其他支出", "mdi:credit-card"],
];

const DEFAULT_INCOME_CATEGORIES: Array<[string, string]> = [
    ["薪水", "mdi:bank"],
    ["獎金", "mdi:gift"],
    ["投資", "mdi:piggy-bank"],
    ["兼職", "mdi:cash"],
    ["其他收入", "mdi:wallet"],
];

export function normalizeUsername(username: string): string {
    return username.trim().toLowerCase();
}

function hashPassword(password: string): string {
    return bcrypt.hashSync(password, 10);
}

@Injectable()
export class UsersService {
    constructor(
        @InjectRepository(User) private readonly users: Repository<User>,
        @InjectRepository(Account) private readonly accounts: Repository<Account>,
        @InjectRepository(Category) private readonly categories: Repository<Category>,
        private readonly dataSource: DataSource
    ) {}

    findByUsername(username: string): Promise<User | null> {
        return this.users.findOne({where: {username: normalizeUsername(username)}});
    }

    findById(id: string): Promise<User | null> {
        return this.users.findOne({where: {id}});
    }

    verifyPassword(user: User, password: string): boolean {
        try {
            return bcrypt.compareSync(password, user.password_digest);
        } catch {
            return false;
        }
    }

    /**
     * Registers a user and, in the same transaction, seeds the default cash
     * account and bookkeeping categories (mirrors the Rails `after_create`).
     */
    async createUser(username: string, password: string): Promise<User> {
        const now = time.nowLocal();
        const nowDb = time.toDbDatetime(now);
        const userId = newId();

        return this.dataSource.transaction(async manager => {
            const user = await manager.save(User, {
                id: userId,
                username: normalizeUsername(username),
                password_digest: hashPassword(password),
                timezone: "Asia/Hong_Kong",
                currency: "HKD",
                created_at: nowDb,
                updated_at: nowDb,
            });

            await manager.save(Account, {
                id: newId(),
                user_id: userId,
                name: "現金",
                kind: 0,
                icon: "mdi:cash",
                color: DEFAULT_COLOR,
                initial_balance_cents: 0,
                currency: "HKD",
                created_at: nowDb,
                updated_at: nowDb,
            });

            // Rails inserts each row with its own microsecond timestamp and category
            // lists are ordered by `created_at`; stagger by 1ms so insertion order is
            // preserved here too.
            let tick = 1;
            for (const [kind, list] of [
                [1, DEFAULT_EXPENSE_CATEGORIES],
                [0, DEFAULT_INCOME_CATEGORIES],
            ] as Array<[number, Array<[string, string]>]>) {
                for (const [name, icon] of list) {
                    const staggered = time.toDbDatetime(new Date(now.getTime() + tick));
                    tick += 1;
                    await manager.save(Category, {
                        id: newId(),
                        user_id: userId,
                        name,
                        kind,
                        icon,
                        color: DEFAULT_COLOR,
                        created_at: staggered,
                        updated_at: staggered,
                    });
                }
            }

            return user;
        });
    }

    async updatePassword(user: User, password: string): Promise<User> {
        await this.users.update(
            {id: user.id},
            {
                password_digest: hashPassword(password),
                updated_at: time.toDbDatetime(time.nowLocal()),
            }
        );
        return this.users.findOneByOrFail({id: user.id});
    }
}
