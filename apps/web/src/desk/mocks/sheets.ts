// A248 (2026-10-06): spreadsheets as an external station's schedule, in mock mode. The mock never
// fetches or opens a file: a Google Sheet's link (or a .csv, .tsv, .xlsx or .ods link) answers a
// canned read of a made-up channel's week grid (Attic Channel, a volunteer channel whose sheet says
// "eastern standard time"), except a shared link whose id has "private" in it, which answers as a
// sheet that isn't public. An uploaded file answers a canned weekday sheet (it repeats weekly);
// one named with "empty" has no times in it. The API's rules for size and type apply.

import type { SchedulePreview, SheetKind, SheetRead } from "@opencast/contracts";

export const NY = "America/New_York";

/** The API's words for a sheet that isn't public, and for one without times. */
export const NOT_PUBLIC = "This Google Sheet isn't public. Publish it to the web (File, Share, Publish to web), or share it with anyone with the link, then try again.";
export const NO_SHOWS = "No shows with times were found in it. Each needs a title and a time (“Trigun 6:00 AM”) under a row of days, or columns like Date, Start and Title.";

/** The mock's sheet link for Attic Channel (made up). */
export const ATTIC_SHEET = "https://docs.google.com/spreadsheets/d/e/2PACX-1vMockAtticChannelWeek/pubhtml?gid=7";

/** A Google Sheet's link, or a spreadsheet file's (the API's rule). */
export const isSheetLink = (url: string) => /^https:\/\/docs\.google\.com\/spreadsheets\/(u\/\d+\/)?d\//i.test(url) || /\.(csv|tsv|tab|xlsx|ods)([?#]|$)/i.test(url.split("#")[0]!);

/** A shared Google link the mock treats as not shared with anyone with the link. */
export const notPublicLink = (url: string) => /docs\.google\.com\/spreadsheets\/(u\/\d+\/)?d\/(?!e\/)[^/]*private/i.test(url);

const kindOfLink = (url: string): SheetKind => (/docs\.google\.com/i.test(url) ? "google_sheet" : (/\.(csv|tsv|xlsx|ods)/i.exec(url)?.[1]?.toLowerCase() as SheetKind | undefined) ?? "csv");
export const kindOfFile = (name: string): SheetKind | "xls" | null => {
  const ext = /\.(csv|tsv|tab|xlsx|ods|xls)$/i.exec(name)?.[1]?.toLowerCase();
  return !ext ? null : ext === "tab" ? "tsv" : (ext as SheetKind | "xls");
};

/** Attic Channel's evening and night, the same every day, in Eastern time: [start, minutes, title]. */
const NIGHTS: Array<[string, number, string]> = [
  ["20:00", 40, "Classic Wrestling"],
  ["20:40", 95, "Night at the Drive-In (1987)"],
  ["22:15", 25, "Cartoon Vault"],
  ["22:40", 25, "Office Dogs"],
  ["23:05", 40, "Puppet Kitchen"],
  ["23:45", 25, "Late Laughs"],
  ["24:10", 50, "Static Hour"],
  ["25:00", 270, "Night Owls"],
  ["29:30", 30, "Sign-off"],
  ["30:00", 25, "Space Rangers"],
  ["30:25", 25, "Garage Band Hour"],
  ["30:50", 25, "Cartoon Vault"]
];

/** Midnight of `date` in New York, as an instant (Eastern daylight time through early November). */
const nyMidnight = (date: string) => Date.parse(`${date}T04:00:00Z`);

/** The canned sheet's airings to come after `now`: its nights, from the day before to two days on. */
export function atticAirings(now: Date): SchedulePreview["airings"] {
  const today = new Date(now.getTime() - 4 * 3600_000).toISOString().slice(0, 10);
  const out: SchedulePreview["airings"] = [];
  for (let d = -1; d <= 2; d++) {
    const date = new Date(Date.parse(`${today}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
    for (const [hhmm, mins, title] of NIGHTS) {
      const [h, m] = hhmm.split(":").map(Number);
      const start = nyMidnight(date) + (h! * 60 + m!) * 60_000;
      if (start > now.getTime()) out.push({ title, startsAt: new Date(start).toISOString(), endsAt: new Date(start + mins * 60_000).toISOString() });
    }
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 8);
}

/** What the canned link reads: Attic Channel's week, Monday to Sunday of the mock clock's week. */
export function atticRead(url: string, timeZone: string | null, now: Date): SheetRead {
  const gid = /[?#&]gid=(\d+)/.exec(url)?.[1] ?? null;
  const kind = kindOfLink(url);
  return {
    kind,
    tab: kind === "google_sheet" || kind === "csv" || kind === "tsv" ? null : "Week",
    gid: kind === "google_sheet" ? gid : null,
    tabs: kind === "xlsx" || kind === "ods" ? ["Week", "Last week"] : [],
    layout: "week_grid",
    shows: 152,
    weekly: false,
    firstDay: "Monday 9/21",
    lastDay: "Sunday 9/27",
    firstDate: "2026-09-21",
    lastDate: "2026-09-27",
    timeZone: timeZone ?? NY,
    timeZoneFrom: timeZone ? "listing" : "sheet",
    zonesNamed: [],
    skipped: [{ text: "Super Robot 2:55 PM", where: "Tuesday 9/22, row 52", why: "out_of_order" }],
    skippedCount: 1,
    readAt: now.toISOString()
  };
}

/** What an uploaded file reads: a weekday sheet, Monday to Sunday every week, its zone the market's unless chosen. */
export function weeklyFileRead(kind: SheetKind, timeZone: string | null, market: string, now: Date, tab?: string): SheetRead {
  const book = kind === "xlsx" || kind === "ods";
  return {
    kind,
    tab: book ? (tab || "Sheet1") : null,
    gid: null,
    tabs: book ? ["Sheet1", "Notes"] : [],
    layout: "week_grid",
    shows: 14,
    weekly: true,
    firstDay: "Mon",
    lastDay: "Sun",
    firstDate: null,
    lastDate: null,
    timeZone: timeZone ?? market,
    timeZoneFrom: timeZone ? "listing" : "market",
    zonesNamed: [],
    skipped: [],
    skippedCount: 0,
    readAt: now.toISOString()
  };
}

/** A weekday sheet's first airings after `now` in `tz`: a morning show at 7:00 am and a movie at 8:00 pm, every day. */
export function weeklyAirings(now: Date, tz: string): SchedulePreview["airings"] {
  const offset = (at: Date) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - Math.floor(at.getTime() / 60_000) * 60_000;
  };
  const local = new Date(now.getTime() + offset(now)).toISOString().slice(0, 10);
  const out: SchedulePreview["airings"] = [];
  for (let d = 0; d < 6 && out.length < 8; d++) {
    const date = new Date(Date.parse(`${local}T00:00:00Z`) + d * 86_400_000);
    // The movie has nothing after it within 6 hours: no end, as the API reads it.
    for (const [h, mins, title] of [[7, 780, "Morning Show"], [20, null, "Movie"]] as const) {
      const wall = date.getTime() + h * 3600_000;
      const start = wall - offset(new Date(wall));
      if (start > now.getTime()) out.push({ title, startsAt: new Date(start).toISOString(), endsAt: mins === null ? null : new Date(start + mins * 60_000).toISOString() });
    }
  }
  return out.slice(0, 8);
}
