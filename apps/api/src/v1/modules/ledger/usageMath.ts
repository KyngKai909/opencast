// Pay-as-you-go arithmetic (added 2026-09-29, follow-up Phase 2), kept pure so it can be checked
// on its own. Months and days are UTC.
//
// A usage type is measured once a day: storage in GB (what's kept that day), everything else in
// hours. The month's quantity is in the type's unit: for storage each day adds its GB ÷ the days
// in the month (so the month is the daily average, in GB-months), for hours each day adds its
// hours. The free allowance is used up first, from the 1st; each day's billable part is charged
// at that day's price (prices have effective dates), and the month never costs more than the
// station's cap for the type.

export const DAY_MS = 86_400_000;

export type Unit = "gb_month" | "hour";

/** `2026-10-03`. */
export const dayOf = (at: Date) => at.toISOString().slice(0, 10);
/** The month's first day, midnight UTC. */
export const monthStartOf = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
export const nextMonthStart = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
export const daysInMonth = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
/** `2026-10`. */
export const monthKey = (at: Date) => at.toISOString().slice(0, 7);
export const startOfDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

export interface DayRow {
  /** GB for storage, hours otherwise. */
  quantity: number;
  /** The price per unit that day (per GB-month, per hour); null: not set, nothing charged. */
  priceMicros: number | null;
}

export interface MonthCharge {
  /** In the type's unit: GB-months or hours. */
  quantity: number;
  freeQuantity: number;
  billableQuantity: number;
  /** Before the cap, not rounded. */
  rawMicros: number;
  /** After the cap, to the micro. */
  cappedMicros: number;
  capReached: boolean;
  /** Per day, in order: its units, how many of them were billable, and their raw charge. */
  days: Array<{ units: number; billable: number; rawMicros: number }>;
}

/** Hours between two times. */
export const hoursBetween = (from: Date, to: Date) => Math.max(0, to.getTime() - from.getTime()) / 3_600_000;

/** A day's units: storage's GB is a share of the month (GB ÷ days in the month); hours are hours. */
export function unitsOf(unit: Unit, quantity: number, monthDays: number): number {
  return unit === "gb_month" ? quantity / monthDays : quantity;
}

/**
 * The month so far for one usage type: `rows` are days 1… in order (a day with nothing is a row
 * with quantity 0, or left out at the end), `allowance` is in the type's unit (GB for storage, the
 * monthly average; hours otherwise), `capMicros` null for no cap.
 */
export function monthCharge(input: { unit: Unit; monthDays: number; allowance: number; rows: DayRow[]; capMicros: number | null }): MonthCharge {
  let cumulative = 0;
  let raw = 0;
  const days: MonthCharge["days"] = [];
  for (const row of input.rows) {
    const units = unitsOf(input.unit, Math.max(0, row.quantity), input.monthDays);
    const before = Math.max(0, cumulative - input.allowance);
    cumulative += units;
    const billable = Math.max(0, cumulative - input.allowance) - before;
    const micros = row.priceMicros ? billable * row.priceMicros : 0;
    raw += micros;
    days.push({ units, billable, rawMicros: micros });
  }
  const cap = input.capMicros;
  const capped = cap === null ? raw : Math.min(raw, cap);
  return {
    quantity: cumulative,
    freeQuantity: Math.min(cumulative, input.allowance),
    billableQuantity: Math.max(0, cumulative - input.allowance),
    rawMicros: raw,
    cappedMicros: Math.round(capped),
    // A $0 cap is reached by anything billable; the free allowance costs nothing.
    capReached: cap !== null && raw >= cap && (cap > 0 || raw > 0),
    days
  };
}

/**
 * What closing a day adds: the month's charge through that day (capped, rounded) less what the
 * days before it already added. Never negative: a cap lowered below what's been charged refunds nothing.
 */
export function dayCharge(throughDay: MonthCharge, chargedBefore: number): number {
  return Math.max(0, throughDay.cappedMicros - chargedBefore);
}

/**
 * The month at its pace so far. Storage: today's GB kept for the rest of the month. Hours: the
 * pace per day so far (`elapsedDays`, fractional) for the whole month. Priced at today's price,
 * never past the cap.
 */
export function monthEstimate(input: {
  unit: Unit;
  monthDays: number;
  allowance: number;
  soFar: MonthCharge;
  /** Days of the month with a measurement, today included (storage). */
  daysMeasured: number;
  /** Storage: GB kept today. */
  currentGb: number;
  /** Hours: how far into the month now is, in days. */
  elapsedDays: number;
  priceMicros: number | null;
  capMicros: number | null;
}): { quantity: number; micros: number } {
  const soFarUnits = input.soFar.quantity;
  const more =
    input.unit === "gb_month"
      ? (input.currentGb * Math.max(0, input.monthDays - input.daysMeasured)) / input.monthDays
      : input.elapsedDays > 0
        ? (soFarUnits / input.elapsedDays) * Math.max(0, input.monthDays - input.elapsedDays)
        : 0;
  const quantity = soFarUnits + more;
  const moreBillable = Math.max(0, quantity - input.allowance) - Math.max(0, soFarUnits - input.allowance);
  const raw = input.soFar.rawMicros + (input.priceMicros ? moreBillable * input.priceMicros : 0);
  const micros = Math.round(input.capMicros === null ? raw : Math.min(raw, input.capMicros));
  return { quantity, micros };
}

/** Hours covered by a set of intervals, overlaps counted once (relays: per station, however many platforms). */
export function unionHours(intervals: Array<{ startedAt: Date; endedAt: Date }>): number {
  const sorted = intervals.filter((i) => i.endedAt > i.startedAt).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  let total = 0;
  let start = -1;
  let end = -1;
  for (const i of sorted) {
    const s = i.startedAt.getTime();
    const e = i.endedAt.getTime();
    if (s > end) {
      if (end > start) total += end - start;
      start = s;
      end = e;
    } else if (e > end) end = e;
  }
  if (end > start) total += end - start;
  return total / 3_600_000;
}

/** Whole cents, rounded half up (bills are closed to the cent). */
export const toCent = (micros: number) => Math.round(micros / 10_000) * 10_000;
/** Whole cents, rounded down (what earnings pay mid-month). */
export const floorCent = (micros: number) => Math.floor(micros / 10_000) * 10_000;
