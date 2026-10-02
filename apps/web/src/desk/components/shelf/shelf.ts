// The catalog's words (desk-catalog 01 to 03): how the shelf, a series and an item's rights check
// read. Pure functions, so the pages and their tests agree.

import type { ChecklistLine, EpisodeView, RebuildView, Shelf, ShelfItem, ShelfItemRow, ShelfSeries, ShelfSeriesRow } from "@opencast/contracts";
import { duration, type TagVariant } from "@opencast/ui";

/** "2 hr episodes", "30 min episodes": an episode length as the shelf says it. */
export function lengthWords(ms: number | null): string | null {
  if (!ms) return null;
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} hr` : `${minutes} min`;
}

/** "486 hr": hours prepared, whole. */
export function hoursWords(ms: number): string {
  return `${Math.round(ms / 3_600_000)} hr`;
}

/** The shelf's four numbers (01, .cov). */
export function shelfStats(s: Shelf): Array<{ value: string; caption: string }> {
  const st = s.stats;
  return [
    { value: String(st.itemsPassed), caption: "Items with a confirmed rights record" },
    { value: hoursWords(st.readyMs), caption: "Prepared and ready to air" },
    { value: String(st.carrierStations), caption: `${st.carrierStations === 1 ? "Station" : "Stations"} carrying catalog series, in ${st.carrierMarkets} ${st.carrierMarkets === 1 ? "market" : "markets"}` },
    { value: String(st.awaitingSecondCheck), caption: st.awaitingSecondCheck === 1 ? "Item waiting for a second check" : "Items waiting for a second check" }
  ];
}

/** The Episodes column: "12", or "44 of 60" while some aren't ready. */
export function episodesCell(r: ShelfSeriesRow): { value: string; of: string | null } {
  return r.episodesReady === r.episodesTotal ? { value: String(r.episodesTotal), of: null } : { value: String(r.episodesReady), of: ` of ${r.episodesTotal}` };
}

/** The State column's tag: Offered, "7 in review" (standby), Coming, or Not offered yet. */
export function stateTag(r: Pick<ShelfSeriesRow, "state" | "inReview">): { text: string; variant: TagVariant } {
  switch (r.state) {
    case "offered":
      return { text: "Offered", variant: "plain" };
    case "in_review":
      return { text: `${r.inReview} in review`, variant: "standby" };
    case "coming":
      return { text: "Coming", variant: "off" };
    default:
      return { text: "Not offered yet", variant: "off" };
  }
}

/** A series' second line on the shelf: "2 hr episodes. NASA footage", or its description as written. */
export function seriesLine(r: ShelfSeriesRow): string {
  return r.description ?? (lengthWords(r.episodeLengthMs) ? `${lengthWords(r.episodeLengthMs)} episodes` : "");
}

/** The series page's line: "40 episodes of 30 minutes, 138 shorts. Built from …". */
export function seriesDescription(s: ShelfSeries): string {
  const minutes = s.episodeLengthMs ? Math.round(s.episodeLengthMs / 60_000) : null;
  const eps = `${s.episodesTotal} ${s.episodesTotal === 1 ? "episode" : "episodes"}${minutes ? ` of ${minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}` : `${minutes} minutes`}` : ""}`;
  const passed = s.items.filter((i) => i.state === "passed").length;
  const noun = s.mediaKind === "audio" ? (passed === 1 ? "recording" : "recordings") : passed === 1 ? "item" : "items";
  return [`${eps}, ${passed} ${noun} checked.`, s.notes].filter(Boolean).join(" ");
}

/** "Episode 14" section's quiet words: "River boats and paddle wheels. 4 shorts, 29:10". */
export function episodeSub(e: EpisodeView): string {
  const n = e.items.filter((i) => i.position !== null).length;
  return [e.title, `${n} ${n === 1 ? "item" : "items"}, ${duration(e.lengthMs)}`].filter(Boolean).join(". ");
}

/** The note under an episode when something came out of it (desk-catalog 02's .m-note). */
export function removalNote(e: EpisodeView, dateWords: (iso: string) => string): string | null {
  const out = e.items.filter((i) => i.removedAt);
  if (!out.length) return null;
  const names = out.map((i) => `"${i.title}"`).join(" and ");
  const when = dateWords(out[out.length - 1]!.removedAt!);
  return `${names} came out when ${out.length === 1 ? "its" : "their"} check failed (${out.map((i) => i.removedReason?.toLowerCase()).filter(Boolean).join("; ")}). Episode ${e.number} was rebuilt: stations carrying it air the new version from their next airing, and nothing aired with ${out.length === 1 ? "it" : "them"} after ${when}.`;
}

/** An item's check state as a tag. */
export function itemTag(i: Pick<ShelfItemRow, "state">): { text: string; variant: TagVariant } {
  switch (i.state) {
    case "passed":
      return { text: "Checked twice", variant: "solid" };
    case "second_check":
      return { text: "Second check", variant: "standby" };
    case "failed":
      return { text: "Failed", variant: "live" };
    default:
      return { text: "Checking", variant: "plain" };
  }
}

/** "Dee A., Kai M." */
export function checkedBy(i: Pick<ShelfItemRow, "firstCheck" | "secondCheck">): string {
  return [i.firstCheck?.by.name, i.secondCheck?.by.name].filter(Boolean).join(", ");
}

/** The evidence column: the files' names, the written record's first words, "noted", or nothing. */
export function evidenceWords(l: ChecklistLine): string {
  if (l.evidence.length) return l.evidence.map((e) => e.fileName).join(", ");
  if (l.state === "not_needed") return "not needed";
  if (l.record?.trim()) return l.record.trim().length > 22 ? "record kept" : l.record.trim();
  return "";
}

/** What the mark in front of a line says to a screen reader. */
export const LINE_WORDS: Record<ChecklistLine["state"], string> = { ok: "Yes", warn: "Yes, with a caution", todo: "Not answered", fail: "Not free to air", not_needed: "Not needed" };

/** The pane's kv (03): first check, second check, then. */
export function checkRows(i: ShelfItem, dateWords: (iso: string) => string): Array<{ label: string; value: string }> {
  const first = i.firstCheck ? `${i.firstCheck.by.name}, ${dateWords(i.firstCheck.at)}` : "Not yet";
  const second = i.secondCheck ? `${i.secondCheck.by.name}, ${dateWords(i.secondCheck.at)}` : i.state === "second_check" ? "Waiting" : "After the first";
  const then =
    i.state === "failed" ? `Out of the catalog: ${i.failed?.reason ?? ""}` : i.state === "passed" ? (i.episodes.length ? `In ${i.episodes.filter((e) => !e.removed).map((e) => `episode ${e.number}`).join(", ") || "no episode yet"}` : "Ready for an episode") : "Prepared and added to episodes";
  return [
    { label: "First check", value: first },
    { label: "Second check", value: second },
    { label: "Then", value: then }
  ];
}

/** "Sept 21: episode 14 rebuilt after "Down the River" failed. 38 unchanged." */
export function rebuildWords(r: RebuildView, dateWords: (iso: string) => string): string {
  const eps = r.episodes.map((e) => e.number);
  const which = eps.length ? `${eps.length === 1 ? "Episode" : "Episodes"} ${eps.length === 1 ? eps[0] : `${eps.slice(0, -1).join(", ")} and ${eps.at(-1)}`} rebuilt` : "Nothing needed rebuilding";
  const why = r.item ? ` after "${r.item.title}" failed (${r.reason.toLowerCase()})` : "";
  return `${dateWords(r.at)}: ${which}${why}. ${r.unchanged} unchanged.`;
}
