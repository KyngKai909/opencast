// Spot money rules. The database enforces the same rule on listing
// (spots.one_day_of_budget in packages/db).

export interface SpotBudget {
  totalBudgetMicros: number;
  dailyCapMicros?: number | null;
  /** ISO dates, inclusive. */
  startsOn?: string | null;
  endsOn?: string | null;
}

/**
 * "A day of its budget": the daily cap if there is one; otherwise the total
 * spread over the spot's dates; otherwise the whole total, since with neither
 * it could all be spent in a day. A spot can't be listed until the advertiser's
 * available balance covers this.
 */
export function oneDayOfBudgetMicros(spot: SpotBudget): number {
  if (spot.dailyCapMicros != null) {
    return spot.dailyCapMicros;
  }
  if (spot.startsOn && spot.endsOn) {
    const days = Math.round((Date.parse(spot.endsOn) - Date.parse(spot.startsOn)) / 86_400_000) + 1;
    return Math.ceil(spot.totalBudgetMicros / Math.max(days, 1));
  }
  return spot.totalBudgetMicros;
}
