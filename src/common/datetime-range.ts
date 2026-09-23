import {And, type FindOperator, LessThan, MoreThanOrEqual} from "typeorm";

import {floorToSecond, toDbDatetimeSeconds} from "./time";

/**
 * Predicate for a stored naive-datetime TEXT column covering `[from, to]`.
 *
 * Stored values are compared lexicographically and legacy Rails/loco rows mix
 * precisions: some have no fractional part (`2026-09-01 00:00:00`), some carry
 * microseconds, while rows written by this app always carry milliseconds. A
 * fraction-less value sorts *before* the same instant written as
 * `...00:00:00.000`, so a millisecond-precision lower bound silently drops any
 * row sitting exactly on the start of a period (e.g. a `家用` expense booked on
 * the 1st of the month never appeared in the monthly summary).
 *
 * Bounding at second precision — inclusive start, exclusive end — keeps every
 * stored precision inside the range.
 */
export function datetimeRange(from: Date, to: Date): FindOperator<string> {
    const start = floorToSecond(from);
    const end = new Date(floorToSecond(to).getTime() + 1000);
    return And(MoreThanOrEqual(toDbDatetimeSeconds(start)), LessThan(toDbDatetimeSeconds(end)));
}
