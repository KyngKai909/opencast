import { bigint, timestamp, uuid } from "drizzle-orm/pg-core";

export const id = () => uuid("id").primaryKey().defaultRandom();

export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const at = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Money is stored in micro-dollars (1 USDC base unit = $0.000001), so per-thousand
 * pricing keeps its sub-cent working (262 × $8.00 ÷ 1,000 = $2.096) and rounding
 * happens once, where a rule says so. Numbers stay well inside 2^53.
 */
export const micros = (name: string) => bigint(name, { mode: "number" });

/** Durations are stored in milliseconds: `:30` is 30_000, `28:30` is 1_710_000. */
export const millis = (name: string) => bigint(name, { mode: "number" });
