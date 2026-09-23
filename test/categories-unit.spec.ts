import {beforeEach, describe, expect, it} from "vitest";

import {CategoriesController} from "../src/categories/categories.controller";
import {Category} from "../src/database/entities/category.entity";
import {Merchant} from "../src/database/entities/merchant.entity";
import {RecurringRule} from "../src/database/entities/recurring-rule.entity";
import {Transaction} from "../src/database/entities/transaction.entity";
import {categoryFixture, dataSource, MockDataSource, MockRepo, mockDataSource, mockRepo, repo, userFixture} from "./helpers/unit";

const USER = "user-1";

function uniqueViolation(): unknown {
    return {driverError: {code: "SQLITE_CONSTRAINT_UNIQUE"}};
}

describe("CategoriesController (unit)", () => {
    let categories: MockRepo;
    let ds: MockDataSource;
    let controller: CategoriesController;

    beforeEach(() => {
        categories = mockRepo();
        ds = mockDataSource();
        controller = new CategoriesController(repo<Category>(categories), dataSource(ds));
    });

    it("index returns serialized categories", async () => {
        categories.find.mockResolvedValue([categoryFixture({id: "c1", name: "飲食", kind: 1})]);

        const result = (await controller.index(userFixture({id: USER}))) as {data: Array<Record<string, unknown>>};

        expect(categories.find).toHaveBeenCalledWith({where: {user_id: USER}, order: {kind: "ASC", created_at: "ASC"}});
        expect(result.data[0]).toMatchObject({name: "飲食", kind: "expense"});
    });

    it("index filters by a valid kind", async () => {
        const result = (await controller.index(userFixture({id: USER}), "income")) as {data: unknown[]};
        expect(categories.find).toHaveBeenCalledWith({where: {user_id: USER, kind: 0}, order: {kind: "ASC", created_at: "ASC"}});
        expect(result.data).toEqual([]);
    });

    it("index short-circuits an unknown kind without querying", async () => {
        await expect(controller.index(userFixture({id: USER}), "nonsense")).resolves.toEqual({data: []});
        expect(categories.find).not.toHaveBeenCalled();
    });

    it("create rejects a blank name and a missing kind", async () => {
        await expect(controller.create(userFixture({id: USER}), {name: " "})).rejects.toMatchObject({status: 422, details: {name: ["不可為空白"], kind: ["不可為空白"]}});
    });

    it("create rejects a duplicate name within the same kind", async () => {
        categories.findOne.mockResolvedValue(categoryFixture());
        await expect(controller.create(userFixture({id: USER}), {name: "飲食", kind: "expense"})).rejects.toMatchObject({details: {name: ["已被使用"]}});
    });

    it("create trims the name and returns the payload", async () => {
        const result = (await controller.create(userFixture({id: USER}), {name: " 交通 ", kind: "expense", icon: "mdi:bus"})) as {data: Record<string, unknown>};

        const saved = categories.save.mock.calls[0]?.[0] as Category;
        expect(saved).toMatchObject({user_id: USER, name: "交通", kind: 1, icon: "mdi:bus"});
        expect(result.data).toMatchObject({name: "交通", kind: "expense"});
    });

    it("create maps a unique violation to a name-taken error", async () => {
        categories.save.mockRejectedValue(uniqueViolation());
        await expect(controller.create(userFixture({id: USER}), {name: "飲食", kind: "expense"})).rejects.toMatchObject({details: {name: ["已被使用"]}});
    });

    it("update 404s when the category is out of scope", async () => {
        categories.findOne.mockResolvedValue(null);
        await expect(controller.update(userFixture({id: USER}), "missing", {name: "x"})).rejects.toMatchObject({status: 404});
    });

    it("update checks collisions using the effective kind and name", async () => {
        categories.findOne.mockResolvedValueOnce(categoryFixture({id: "c1", name: "飲食", kind: 1})).mockResolvedValueOnce(categoryFixture({id: "c2"}));

        await expect(controller.update(userFixture({id: USER}), "c1", {kind: "income"})).rejects.toMatchObject({details: {name: ["已被使用"]}});

        const findArgs = categories.findOne.mock.calls[1]?.[0] as {where: Record<string, unknown>};
        expect(findArgs).toMatchObject({where: {user_id: USER, kind: 0, name: "飲食"}});
    });

    it("update applies the provided fields", async () => {
        categories.findOne.mockResolvedValueOnce(categoryFixture({id: "c1", name: "飲食", kind: 1})).mockResolvedValueOnce(null);

        const result = (await controller.update(userFixture({id: USER}), "c1", {color: "#fff"})) as {data: Record<string, unknown>};

        const saved = categories.save.mock.calls[0]?.[0] as Category;
        expect(saved.color).toBe("#fff");
        expect(result.data).toMatchObject({id: "c1"});
    });

    it("destroy nulls references then deletes inside one transaction", async () => {
        categories.findOne.mockResolvedValue(categoryFixture({id: "c1"}));

        await expect(controller.destroy(userFixture({id: USER}), "c1")).resolves.toBeUndefined();

        expect(ds.transaction).toHaveBeenCalledTimes(1);
        const updated = ds.manager.update.mock.calls.map(call => call[0]);
        expect(updated).toEqual([Transaction, Merchant, RecurringRule]);
        expect(ds.manager.delete).toHaveBeenCalledWith(Category, {id: "c1"});
    });
});
