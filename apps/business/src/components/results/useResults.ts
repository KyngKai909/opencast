// The period a Results page is showing, from its address (?period=week|month|all, &month=, &week=),
// and the results for it (spots.getResults, with P14's periods).

import { spotsApi } from "@opencast/contracts";
import { useApi } from "../../api/hooks";
import { monthOf, type Period } from "./format";

export interface Selection {
  period: Period;
  /** "2026-09": the month shown, or this month. */
  month: string;
  /** The Sunday of the week shown, or null for this week. */
  week: string | null;
}

export function selectionFrom(params: URLSearchParams, now: Date): Selection {
  const p = params.get("period");
  const period: Period = p === "week" || p === "all" ? p : "month";
  const month = /^\d{4}-\d{2}$/.test(params.get("month") ?? "") ? params.get("month")! : monthOf(now);
  const week = /^\d{4}-\d{2}-\d{2}$/.test(params.get("week") ?? "") ? params.get("week")! : null;
  return { period, month, week };
}

/** The query for getResults: the month, and P14's period and week. */
export function queryFor(sel: Selection): Record<string, string> {
  const q: Record<string, string> = { month: sel.month };
  if (sel.period !== "month") q.period = sel.period;
  if (sel.period === "week" && sel.week) q.week = sel.week;
  return q;
}

export function useResults(businessId: string, sel: Selection, enabled = true) {
  return useApi(spotsApi.getResults, { params: { businessId }, query: queryFor(sel) }, { enabled, staleTime: 15_000 });
}
