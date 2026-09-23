import {beforeEach, describe, expect, it} from "vitest";

import {MerchantsController} from "../src/merchants/merchants.controller";
import {Category} from "../src/database/entities/category.entity";
import {Merchant} from "../src/database/entities/merchant.entity";
import {Transaction} from "../src/database/entities/transaction.entity";
import {categoryFixture, dataSource, merchantFixture, MockDataSource, MockRepo, mockDataSource, mockRepo, repo, userFixture} from "./helpers/unit";

const USER = "user-1";

describe("MerchantsController (unit)", () => {
    let merchants: MockRepo;
    let categories: MockRepo;
    let transactions: MockRepo;
    let ds: MockDataSource;
    let controller: MerchantsController;

    beforeEach(() => {
        merchants = mockRepo();
        categories = mockRepo();
        transactions = mockRepo();
        ds = mockDataSource();
        controller = new MerchantsController(repo<Merchant>(merchants), repo<Category>(categories), repo<Transaction>(transactions), dataSource(ds));
    });

    it("index lists without a limit when there is no query", async () => {
        merchants.find.mockResolvedValue([merchantFixture({id: "m1", name: "Starbucks", usage_count: 3})]);

        const result = (await controller.index(userFixture({id: USER}))) as {data: Array<Record<string, unknown>>};

        expect(merchants.find).toHaveBeenCalledWith({where: {user_id: USER}, order: {usage_count: "DESC", name: "ASC"}});
        expect(result.data[0]).toMatchObject({name: "Starbucks", usage_count: 3});
    });

    it("index applies a Like filter and a 10-row limit when searching", async () => {
        await controller.index(userFixture({id: USER}), "  star  ");

        const call = merchants.find.mock.calls[0]?.[0] as {where: Record<string, unknown>; take?: number};
        expect(call.take).toBe(10);
        expect(call.where.name).toBeDefined();
        expect(call.where.user_id).toBe(USER);
    });

    it("index leaves a blank query unfiltered", async () => {
        await controller.index(userFixture({id: USER}), "   ");
        const call = merchants.find.mock.calls[0]?.[0] as {where: Record<string, unknown>};
        expect(call.where.name).toBeUndefined();
    });

    it("create rejects a blank name", async () => {
        await expect(controller.create(userFixture({id: USER}), {name: " "})).rejects.toMatchObject({status: 422, details: {name: ["不可為空白"]}});
    });

    it("create rejects a duplicate name", async () => {
        merchants.findOne.mockResolvedValue(merchantFixture());
        await expect(controller.create(userFixture({id: USER}), {name: "Starbucks"})).rejects.toMatchObject({details: {name: ["已被使用"]}});
    });

    it("create rejects a default category owned by someone else", async () => {
        categories.findOne.mockResolvedValue(null);
        await expect(controller.create(userFixture({id: USER}), {name: "Starbucks", default_category_id: "other"})).rejects.toMatchObject({details: {default_category: ["無效"]}});
    });

    it("create stores the merchant with a zero usage count", async () => {
        categories.findOne.mockResolvedValue(categoryFixture({id: "c1"}));

        const result = (await controller.create(userFixture({id: USER}), {name: " Starbucks ", default_category_id: "c1"})) as {data: Record<string, unknown>};

        const saved = merchants.save.mock.calls[0]?.[0] as Merchant;
        expect(saved).toMatchObject({user_id: USER, name: "Starbucks", default_category_id: "c1", usage_count: 0});
        expect(result.data).toMatchObject({name: "Starbucks"});
    });

    it("update 404s when the merchant is out of scope", async () => {
        merchants.findOne.mockResolvedValue(null);
        await expect(controller.update(userFixture({id: USER}), "missing", {name: "x"})).rejects.toMatchObject({status: 404});
    });

    it("update rejects a blank or duplicate name", async () => {
        merchants.findOne.mockResolvedValueOnce(merchantFixture({id: "m1"})).mockResolvedValueOnce(merchantFixture({id: "m2"}));
        await expect(controller.update(userFixture({id: USER}), "m1", {name: "Starbucks"})).rejects.toMatchObject({details: {name: ["已被使用"]}});
    });

    it("update clears the default category when explicitly null", async () => {
        merchants.findOne.mockResolvedValueOnce(merchantFixture({id: "m1", default_category_id: "c1"}));

        await controller.update(userFixture({id: USER}), "m1", {default_category_id: null});

        expect(categories.findOne).not.toHaveBeenCalled();
        const saved = merchants.save.mock.calls[0]?.[0] as Merchant;
        expect(saved.default_category_id).toBeNull();
    });

    it("update validates a touched default category", async () => {
        merchants.findOne.mockResolvedValueOnce(merchantFixture({id: "m1"}));
        categories.findOne.mockResolvedValue(null);

        await expect(controller.update(userFixture({id: USER}), "m1", {default_category_id: "bad"})).rejects.toMatchObject({details: {default_category: ["無效"]}});
    });

    it("destroy nulls transactions then deletes inside one transaction", async () => {
        merchants.findOne.mockResolvedValue(merchantFixture({id: "m1"}));

        await controller.destroy(userFixture({id: USER}), "m1");

        expect(ds.manager.update).toHaveBeenCalledWith(Transaction, {merchant_id: "m1"}, expect.objectContaining({merchant_id: null}));
        expect(ds.manager.delete).toHaveBeenCalledWith(Merchant, {id: "m1"});
    });
});
