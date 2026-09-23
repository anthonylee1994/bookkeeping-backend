/**
 * Hong Kong local wall-clock helpers.
 *
 * The whole application stores and computes in Asia/Hong_Kong local time and
 * never converts to/from UTC (HK has no DST, so a fixed +08:00 offset is
 * exact). A "naive" value is represented as a `Date` whose **UTC** fields hold
 * the HK wall-clock components; all helpers below only use `getUTC*` /
 * `Date.UTC`, so the process timezone is irrelevant.
 *
 * On disk:
 *   - date     -> "YYYY-MM-DD"
 *   - datetime -> "YYYY-MM-DD HH:MM:SS.SSS"
 */

export const HK_OFFSET_MS = 8 * 60 * 60 * 1000;

const OFFSET_SUFFIX = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number, length = 2): string {
    return String(value).padStart(length, "0");
}

function naive(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, millisecond = 0): Date {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
}

export function nowLocal(): Date {
    return new Date(Date.now() + HK_OFFSET_MS);
}

/** Today's date (midnight HK local), as a naive `Date`. */
export function today(): Date {
    const now = nowLocal();
    return naive(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
}

export function toDbDate(date: Date): string {
    return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function toDbDatetime(date: Date): string {
    const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
    return `${toDbDate(date)} ${time}.${pad(date.getUTCMilliseconds(), 3)}`;
}

/** `2026-09-14T10:00:00.000+08:00` — matches the Rails/loco serializer. */
export function formatDatetime(date: Date): string {
    const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
    return `${toDbDate(date)}T${time}.${pad(date.getUTCMilliseconds(), 3)}+08:00`;
}

/** `2026-09-14T10:00:00+08:00` (no fractional seconds). */
export function formatDatetimeSeconds(date: Date): string {
    const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
    return `${toDbDate(date)}T${time}+08:00`;
}

export function formatDate(date: Date): string {
    return toDbDate(date);
}

export function formatDatetimeOpt(date: Date | null | undefined): string | null {
    return date ? formatDatetime(date) : null;
}

export function formatDateOpt(date: Date | null | undefined): string | null {
    return date ? formatDate(date) : null;
}

/** Parses a stored `YYYY-MM-DD HH:MM:SS.SSS` (or ISO-ish) value. */
export function fromDbDatetime(value: string): Date {
    const parsed = parseDatetime(value);
    if (parsed) {
        return parsed;
    }
    throw new Error(`invalid stored datetime: ${value}`);
}

export function fromDbDate(value: string): Date {
    const parsed = parseDate(value);
    if (parsed) {
        return parsed;
    }
    throw new Error(`invalid stored date: ${value}`);
}

/**
 * Mirrors `Time.zone.parse`: an explicit offset is converted to HK time, a
 * naive value is treated as HK local.
 */
export function parseDatetime(value: string): Date | null {
    const trimmed = value.trim();
    if (trimmed === "") {
        return null;
    }

    if (OFFSET_SUFFIX.test(trimmed)) {
        const instant = Date.parse(trimmed);
        if (Number.isNaN(instant)) {
            return null;
        }
        return new Date(instant + HK_OFFSET_MS);
    }

    const match = NAIVE_DATETIME.exec(trimmed);
    if (match) {
        const [, y, mo, d, h, mi, s, frac] = match;
        const millis = frac ? Number.parseInt(frac.slice(0, 3).padEnd(3, "0"), 10) : 0;
        return naive(Number(y), Number(mo), Number(d), Number(h), Number(mi), s ? Number(s) : 0, millis);
    }

    const date = parseDate(trimmed);
    return date ? new Date(date.getTime()) : null;
}

export function parseDate(value: string): Date | null {
    const trimmed = value.trim();
    const match = DATE_ONLY.exec(trimmed);
    if (!match) {
        return null;
    }
    const [, y, mo, d] = match;
    return naive(Number(y), Number(mo), Number(d));
}

export function beginningOfDay(date: Date): Date {
    return naive(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function endOfDay(date: Date): Date {
    return naive(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 23, 59, 59, 999);
}

export function beginningOfWeekMonday(date: Date): Date {
    const weekday = date.getUTCDay(); // 0 = Sunday
    const daysFromMonday = (weekday + 6) % 7;
    return addDays(date, -daysFromMonday);
}

export function endOfWeekMonday(date: Date): Date {
    return addDays(beginningOfWeekMonday(date), 6);
}

export function beginningOfMonth(date: Date): Date {
    return naive(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function endOfMonth(date: Date): Date {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    return naive(year, month, daysInMonth(year, month));
}

export function addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 86_400_000);
}

export function addHours(date: Date, hours: number): Date {
    return new Date(date.getTime() + hours * 3_600_000);
}

/**
 * Ruby's `Date#>>`: advancing months clamps the day to the last valid day of
 * the target month (`Jan 31 >> 1 == Feb 28`).
 */
export function addMonthsClamped(date: Date, months: number): Date {
    const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
    const year = Math.floor(total / 12);
    const month = total - year * 12 + 1;
    const day = Math.min(date.getUTCDate(), daysInMonth(year, month));
    return naive(year, month, day);
}

export function compare(a: Date, b: Date): number {
    return a.getTime() - b.getTime();
}

/** Keeps the time-of-day of `date` but replaces the calendar date. */
export function withYmd(date: Date, year: number, month: number, day: number): Date {
    return naive(year, month, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds());
}

/** Whether `a` is strictly before `b`. */
export function before(a: Date, b: Date): boolean {
    return a.getTime() < b.getTime();
}

export function sameDate(a: Date, b: Date): boolean {
    return toDbDate(a) === toDbDate(b);
}
