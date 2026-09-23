import bcrypt from "bcryptjs";
import {beforeEach, describe, expect, it} from "vitest";

import {Account} from "../src/database/entities/account.entity";
import {Category} from "../src/database/entities/category.entity";
import {User} from "../src/database/entities/user.entity";
import {normalizeUsername, UsersService} from "../src/users/users.service";
import {dataSource, MockDataSource, MockRepo, mockDataSource, mockRepo, repo} from "./helpers/unit";

describe("UsersService (unit)", () => {
    let users: MockRepo;
    let accounts: MockRepo;
    let categories: MockRepo;
    let ds: MockDataSource;
    let service: UsersService;

    beforeEach(() => {
        users = mockRepo();
        accounts = mockRepo();
        categories = mockRepo();
        ds = mockDataSource();
        service = new UsersService(repo<User>(users), repo<Account>(accounts), repo<Category>(categories), dataSource(ds));
    });

    it("normalizeUsername trims and lowercases", () => {
        expect(normalizeUsername("  Alice ")).toBe("alice");
    });

    it("findByUsername normalizes the lookup key", async () => {
        await service.findByUsername("  Alice ");
        expect(users.findOne).toHaveBeenCalledWith({where: {username: "alice"}});
    });

    it("verifyPassword compares bcrypt digests and survives a malformed digest", () => {
        const digest = bcrypt.hashSync("secret123", 4);
        expect(service.verifyPassword({password_digest: digest} as User, "secret123")).toBe(true);
        expect(service.verifyPassword({password_digest: digest} as User, "wrong")).toBe(false);
        expect(service.verifyPassword({password_digest: "not-a-hash"} as User, "secret123")).toBe(false);
    });

    it("createUser seeds the default account and categories in one transaction", async () => {
        const user = await service.createUser("  Alice ", "secret123");

        const savedKinds = ds.manager.save.mock.calls.map(call => call[0]);
        expect(savedKinds[0]).toBe(User);
        expect(savedKinds[1]).toBe(Account);
        expect(savedKinds.filter(kind => kind === Category)).toHaveLength(13);

        const savedUser = ds.manager.save.mock.calls[0]?.[1] as User;
        expect(savedUser.username).toBe("alice");
        expect(savedUser.password_digest).not.toBe("secret123");
        expect(bcrypt.compareSync("secret123", savedUser.password_digest)).toBe(true);
        expect(user.id).toBe(savedUser.id);
    });

    it("updatePassword rewrites the digest and returns the fresh row", async () => {
        const before = {id: "u1"} as User;
        users.findOneByOrFail.mockResolvedValue({id: "u1", username: "alice"} as User);

        const updated = await service.updatePassword(before, "newsecret123");

        const updateArgs = users.update.mock.calls[0] as [{id: string}, {password_digest: string}];
        expect(updateArgs[0]).toEqual({id: "u1"});
        expect(bcrypt.compareSync("newsecret123", updateArgs[1].password_digest)).toBe(true);
        expect(updated.username).toBe("alice");
    });
});
