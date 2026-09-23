import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {DeepseekService, DeepSeekError, STATUS_PARTIAL, STATUS_SUCCESS} from "../src/ai/deepseek.service";

function llm(content: string, usage: Record<string, number> = {prompt_tokens: 11, completion_tokens: 7}): {ok: boolean; status: number; text: () => Promise<string>} {
    return {ok: true, status: 200, text: async () => JSON.stringify({choices: [{message: {content}}], usage})};
}

const valid = JSON.stringify({amount_cents: 1234, kind: "expense", occurred_at: "2026-09-14T10:00:00+08:00", confidence: 0.9});

describe("DeepseekService (unit)", () => {
    let service: DeepseekService;

    beforeEach(() => {
        service = new DeepseekService();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it("throws when the api key is missing", async () => {
        vi.stubEnv("DEEPSEEK_API_KEY", "");
        await expect(service.call("AAAA", "image/jpeg", [])).rejects.toBeInstanceOf(DeepSeekError);
    });

    it("parses a valid completion", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(llm(valid)));

        const outcome = await service.call("AAAA", "image/jpeg", []);

        expect(outcome.status).toBe(STATUS_SUCCESS);
        expect(outcome.parsed).toMatchObject({amount_cents: 1234, kind: "expense"});
        expect(outcome.tokens_in).toBe(11);
        expect(outcome.tokens_out).toBe(7);
        expect(typeof outcome.latency_ms).toBe("number");
        expect(outcome.error_message).toBeNull();
    });

    it("extracts the JSON object from noisy content", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(llm(`Sure! Here it is:\n${valid}\nHope that helps.`)));

        const outcome = await service.call("AAAA", "image/jpeg", []);
        expect(outcome.parsed).toMatchObject({amount_cents: 1234});
    });

    it("prefers the last candidate that looks like a receipt", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(llm(`{"note":"ignore"}\n${valid}`)));

        const outcome = await service.call("AAAA", "image/jpeg", []);
        expect(outcome.parsed).toMatchObject({amount_cents: 1234});
    });

    it("strips the json_object marker", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(llm(JSON.stringify({type: "json_object", amount_cents: 100, kind: "income", occurred_at: "x"}))));

        const outcome = await service.call("AAAA", "image/jpeg", []);
        expect((outcome.parsed as Record<string, unknown>).type).toBeUndefined();
    });

    it("returns a partial outcome when no object is present", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(llm("no json here")));

        const outcome = await service.call("AAAA", "image/jpeg", []);
        expect(outcome.status).toBe(STATUS_PARTIAL);
        expect(outcome.parsed).toBeNull();
        expect(outcome.error_message).toContain("did not contain a JSON object");
    });

    it("flags a parsed object that fails validation", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(llm(JSON.stringify({amount_cents: 0, kind: "expense", occurred_at: "x"}))));

        const outcome = await service.call("AAAA", "image/jpeg", []);
        expect(outcome.status).toBe(STATUS_PARTIAL);
        expect(outcome.error_message).toBe("amount_cents must be >= 1");
    });

    it("throws on a non-ok response", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok: false, status: 500, text: async () => ""}));
        await expect(service.call("AAAA", "image/jpeg", [])).rejects.toThrow(/500/);
    });

    it("throws when the response body is not JSON", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok: true, status: 200, text: async () => "not json"}));
        await expect(service.call("AAAA", "image/jpeg", [])).rejects.toBeInstanceOf(DeepSeekError);
    });

    it("throws when the request itself fails", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
        await expect(service.call("AAAA", "image/jpeg", [])).rejects.toBeInstanceOf(DeepSeekError);
    });

    it("lists categories in the prompt, split by kind", async () => {
        const fetchMock = vi.fn().mockResolvedValue(llm(valid));
        vi.stubGlobal("fetch", fetchMock);

        await service.call("AAAA", "image/jpeg", [
            {kind: 1, name: "飲食"},
            {kind: 0, name: "薪水"},
        ]);

        const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {messages: Array<{content: Array<{text: string}>}>};
        const prompt = body.messages[0]?.content[0]?.text ?? "";
        expect(prompt).toContain('EXPENSE categories: ["飲食"]');
        expect(prompt).toContain('INCOME categories: ["薪水"]');
    });

    it("tells the model there are no categories when the list is empty", async () => {
        const fetchMock = vi.fn().mockResolvedValue(llm(valid));
        vi.stubGlobal("fetch", fetchMock);

        await service.call("AAAA", "image/jpeg", []);

        const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {messages: Array<{content: Array<{text: string}>}>};
        expect(body.messages[0]?.content[0]?.text).toContain("no user-defined categories");
    });

    describe("callInsight", () => {
        const factSheet = "期間：2026年9月\n收入：HK$1,000.00\n支出：HK$400.00\n淨額：HK$600.00";

        it("throws when the api key is missing", async () => {
            vi.stubEnv("DEEPSEEK_API_KEY", "");
            await expect(service.callInsight(factSheet)).rejects.toBeInstanceOf(DeepSeekError);
        });

        it("returns a validated insight", async () => {
            vi.stubGlobal("fetch", vi.fn().mockResolvedValue(llm(JSON.stringify({summary: "9月收入 HK$1,000.00，支出 HK$400.00。", highlights: ["淨額 HK$600.00。"]}))));

            const outcome = await service.callInsight(factSheet);

            expect(outcome.status).toBe(STATUS_SUCCESS);
            expect(outcome.text).toContain("收入");
            expect(outcome.highlights).toHaveLength(1);
            expect(outcome.error_message).toBeNull();
        });

        it("flags an invented number", async () => {
            vi.stubGlobal("fetch", vi.fn().mockResolvedValue(llm(JSON.stringify({summary: "支出 HK$999.00。"}))));

            const outcome = await service.callInsight(factSheet);

            expect(outcome.status).toBe(STATUS_PARTIAL);
            expect(outcome.text).toBeNull();
            expect(outcome.error_message).toContain("999.00");
        });

        it("returns partial when there is no JSON object", async () => {
            vi.stubGlobal("fetch", vi.fn().mockResolvedValue(llm("no json here")));

            const outcome = await service.callInsight(factSheet);
            expect(outcome.status).toBe(STATUS_PARTIAL);
            expect(outcome.text).toBeNull();
        });

        it("sends the fact sheet with a low temperature", async () => {
            const fetchMock = vi.fn().mockResolvedValue(llm(JSON.stringify({summary: "9月支出 HK$400.00。"})));
            vi.stubGlobal("fetch", fetchMock);

            await service.callInsight(factSheet);

            const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {temperature: number; messages: Array<{content: string}>};
            expect(body.temperature).toBe(0.2);
            expect(body.messages[0]?.content).toContain(factSheet);
        });
    });
});
