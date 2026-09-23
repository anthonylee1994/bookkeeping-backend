import {describe, expect, it, vi} from "vitest";
import type {DataSource, Repository} from "typeorm";

import * as time from "../src/common/time";
import type {RecurringOccurrence} from "../src/database/entities/recurring-occurrence.entity";
import type {RecurringRule} from "../src/database/entities/recurring-rule.entity";
import type {Transaction} from "../src/database/entities/transaction.entity";
import {FREQ_DAILY, FREQ_MONTHLY, FREQ_WEEKLY, FREQ_YEARLY, nextOccurrence, RecurringService, STATUS_ACTIVE} from "../src/recurring/recurring.service";

function rule(frequency: number, interval: number, dayOfWeek: number | null, dayOfMonth: number | null, monthOfYear: number | null): RecurringRule {
    const start = time.parseDate("2026-01-01")!;
    return {
        id: "rule",
        user_id: "user",
        account_id: "account",
        category_id: null,
        merchant_id: null,
        kind: 1,
        amount_cents: 1000,
        currency: "HKD",
        frequency,
        interval,
        day_of_week: dayOfWeek,
        day_of_month: dayOfMonth,
        month_of_year: monthOfYear,
        start_on: time.toDbDate(start),
        end_on: null,
        next_run_at: time.toDbDatetime(time.beginningOfDay(start)),
        last_run_at: null,
        status: STATUS_ACTIVE,
        note: null,
        created_at: time.toDbDatetime(time.beginningOfDay(start)),
        updated_at: time.toDbDatetime(time.beginningOfDay(start)),
    };
}

function at(year: number, month: number, day: number, hour: number): Date {
    return time.parseDatetime(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00`)!;
}

describe("nextOccurrence", () => {
    it("clamps monthly day 31 to the last day of February", () => {
        const next = nextOccurrence(at(2026, 1, 31, 9), rule(FREQ_MONTHLY, 1, null, 31, null));
        expect(time.toDbDate(next)).toBe("2026-02-28");
    });

    it("respects the daily interval", () => {
        const next = nextOccurrence(at(2026, 1, 1, 0), rule(FREQ_DAILY, 2, null, null, null));
        expect(time.toDbDate(next)).toBe("2026-01-03");
    });

    it("clamps yearly day 29 in a non-leap year", () => {
        const next = nextOccurrence(at(2026, 2, 28, 0), rule(FREQ_YEARLY, 1, null, 29, 2));
        expect(time.toDbDate(next)).toBe("2027-02-28");
    });

    it("keeps the configured weekday for weekly rules", () => {
        // 2026-09-14 is a Monday; the next weekly occurrence is the next Monday.
        const next = nextOccurrence(at(2026, 9, 14, 10), rule(FREQ_WEEKLY, 1, 1, null, null));
        expect(time.toDbDate(next)).toBe("2026-09-21");
    });

    it("defaults monthly to the current day of month", () => {
        const next = nextOccurrence(at(2026, 1, 15, 8), rule(FREQ_MONTHLY, 1, null, null, null));
        expect(time.toDbDate(next)).toBe("2026-02-15");
    });
});

describe("RecurringService.catchUp", () => {
    it("rescues a concurrent occurrence unique collision instead of aborting", async () => {
        const due = rule(FREQ_DAILY, 1, null, null, null);
        due.next_run_at = time.toDbDatetime(time.nowLocal());

        const occurrencesInsert = vi.fn().mockRejectedValue({code: "SQLITE_CONSTRAINT_UNIQUE"});
        const occurrencesFindOne = vi.fn().mockResolvedValue(null);
        const transactionsSave = vi.fn();
        const rulesUpdate = vi.fn().mockResolvedValue({affected: 1});
        const rulesFind = vi.fn().mockResolvedValue([due]);
        const service = new RecurringService(
            {find: rulesFind, update: rulesUpdate} as unknown as Repository<RecurringRule>,
            {
                findOne: occurrencesFindOne,
                insert: occurrencesInsert,
            } as unknown as Repository<RecurringOccurrence>,
            {save: transactionsSave} as unknown as Repository<Transaction>,
            {} as unknown as DataSource
        );

        await expect(service.catchUp("user")).resolves.toBeUndefined();

        expect(occurrencesInsert).toHaveBeenCalledTimes(1);
        // The losing request must not materialize a duplicate transaction.
        expect(transactionsSave).not.toHaveBeenCalled();
        // The rule still advances so it is not retried on every request.
        expect(rulesUpdate).toHaveBeenCalledTimes(1);
    });
});
