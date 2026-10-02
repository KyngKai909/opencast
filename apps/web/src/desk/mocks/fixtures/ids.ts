// Stable ids for the mock: valid v4-shaped uuids, readable by their last digits.
export const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Money in micros. */
export const $ = (d: number) => Math.round(d * 1_000_000);
