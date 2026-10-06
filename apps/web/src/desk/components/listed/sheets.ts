// A248 (2026-10-06): an external station's schedule from a spreadsheet, in the desk's words. What
// was read ("Read 152 shows from a week grid, Monday 10/05 to Sunday 10/11, times in Eastern"),
// which tab, where its time zone came from, the cells it skipped and why, and a dated sheet whose
// days have passed. Pure, so it's tested alone.

import type { SheetKind, SheetLayout, SheetRead } from "@opencast/contracts";

export const LAYOUT_WORDS: Record<SheetLayout, string> = { week_grid: "a week grid", time_grid: "a grid with a column of times", list: "a list" };

export const KIND_WORDS: Record<SheetKind, string> = { google_sheet: "Google Sheet", csv: "CSV file", tsv: "TSV file", xlsx: "Excel workbook", ods: "OpenDocument spreadsheet" };

/** The files the upload takes, for the file picker. */
export const SHEET_ACCEPT = ".xlsx,.ods,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet,text/csv,text/tab-separated-values";

/** Whether a link is a spreadsheet's: a Google Sheet, or a .csv, .tsv, .xlsx or .ods file (the API's rule). */
export function isSheetLink(url: string): boolean {
  const u = url.trim();
  if (/^https:\/\/docs\.google\.com\/spreadsheets\/(u\/\d+\/)?d\//i.test(u)) return true;
  return /^https?:\/\/[^?#]+\.(csv|tsv|tab|xlsx|ods)([?#]|$)/i.test(u);
}

/** A Google Sheet's link (shared, not published) whose own words say it's for editing: it must be shared with anyone with the link. */
export const isSharedGoogleLink = (url: string) => /^https:\/\/docs\.google\.com\/spreadsheets\/(u\/\d+\/)?d\/(?!e\/)/i.test(url.trim());

/** "Eastern", "Pacific", "UTC": a zone's short name, for "times in Eastern". */
export function zoneShort(timeZone: string): string {
  if (timeZone === "UTC" || timeZone === "Etc/UTC") return "UTC";
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longGeneric" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName");
    return part?.value.replace(/ Time$/, "") ?? timeZone;
  } catch {
    return timeZone;
  }
}

/** Where its time zone came from. */
export const ZONE_FROM_WORDS: Record<SheetRead["timeZoneFrom"], string> = { listing: "this listing's setting", sheet: "the sheet says so", market: "the market's, as the sheet doesn't say" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Read 152 shows from a week grid, Monday 10/05 to Sunday 10/11, times in Eastern". */
export function sheetSummary(sheet: SheetRead): string {
  const days =
    sheet.firstDay && sheet.lastDay ? (sheet.firstDay === sheet.lastDay ? sheet.firstDay : `${sheet.firstDay} to ${sheet.lastDay}`) + (sheet.weekly ? ", every week" : "") : null;
  return [`Read ${plural(sheet.shows, "show")}${sheet.layout ? ` from ${LAYOUT_WORDS[sheet.layout]}` : ""}`, days, `times in ${zoneShort(sheet.timeZone)}`].filter(Boolean).join(", ");
}

/** Which tab was read: "Grid", "The tab in the link (gid 536981055)", "The first tab". Null for a CSV file. */
export function tabWords(sheet: SheetRead): string | null {
  if (sheet.tab) return sheet.tabs.length > 1 ? `“${sheet.tab}”, of ${plural(sheet.tabs.length, "tab")}` : `“${sheet.tab}”`;
  if (sheet.kind !== "google_sheet") return null;
  return sheet.gid ? `The tab in the link (gid ${sheet.gid})` : "The first tab";
}

const WHY: Record<SheetRead["skipped"][number]["why"], string> = {
  no_time: "no time it can read",
  no_title: "a time but no title",
  out_of_order: "out of order in its day (a typo?)",
  no_am_pm: "no am or pm",
  no_day: "no day or date"
};

/** "2 cells skipped" and each one: "“Test Card 2:55 PM”, Friday 10/09, row 10: out of order in its day (a typo?)". */
export function skippedWords(sheet: SheetRead): { title: string; lines: string[] } | null {
  if (!sheet.skippedCount) return null;
  const lines = sheet.skipped.map((s) => `“${s.text}”, ${s.where}: ${WHY[s.why]}`);
  const more = sheet.skippedCount - sheet.skipped.length;
  return { title: `${plural(sheet.skippedCount, sheet.layout === "list" ? "row" : "cell")} skipped`, lines: more > 0 ? [...lines, `And ${more} more`] : lines };
}

/** A dated sheet whose last day is before `today` (YYYY-MM-DD, the market's): it lists nothing to come. */
export function datesPassed(sheet: SheetRead, today: string, upload: boolean): string | null {
  if (sheet.weekly || !sheet.lastDate || sheet.lastDate >= today) return null;
  return `Its days have passed: the last is ${sheet.lastDay ?? sheet.lastDate}. ${upload ? "Upload the new week." : "It's read again every hour, so the new week shows once they add it."}`;
}

/** Several zones named, so none is used: "It names Eastern and Pacific, so the market's is used." */
export function zonesNamedWords(sheet: SheetRead): string | null {
  if (sheet.zonesNamed.length < 2) return null;
  const names = sheet.zonesNamed.map(zoneShort);
  return `It names ${names.slice(0, -1).join(", ")} and ${names.at(-1)}, so ${sheet.timeZoneFrom === "listing" ? "this listing's setting is" : "the market's is"} used.`;
}

/** The time zones the desk offers (the listing's own setting), with the market's and the current one. */
export function zoneOptions(market: string, current: string): Array<{ value: string; label: string }> {
  const zones = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "UTC"];
  const all = [...new Set([...zones, market, ...(current ? [current] : [])])];
  return all.map((z) => ({ value: z, label: z === "UTC" ? "UTC" : `${zoneShort(z)} (${z})` }));
}

/** An uploaded file, for the details: "attic-week.xlsx, Excel workbook, 18 KB, uploaded Oct 6 by Dee A.". */
export function fileWords(file: { name: string; kind: SheetKind; bytes: number; uploadedBy: string | null }, uploadedOn: string): string {
  const size = file.bytes < 1024 ? `${file.bytes} bytes` : file.bytes < 1024 * 1024 ? `${Math.round(file.bytes / 1024)} KB` : `${(file.bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${file.name}, ${KIND_WORDS[file.kind]}, ${size}, uploaded ${uploadedOn}${file.uploadedBy ? ` by ${file.uploadedBy}` : ""}`;
}

/** A Google Sheet that isn't public: how to fix it. */
export const NOT_PUBLIC_HELP = "Publish it to the web (in Google Sheets: File, Share, Publish to web), or share it with anyone with the link (Share, General access), then check it again.";
