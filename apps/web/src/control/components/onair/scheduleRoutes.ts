// A246: the Schedule workspace's tabs, and where each page it replaced lands. The tabs are routes
// under the station: `/schedule` (the Log, Day and Week), `/schedule/templates` (and one template),
// `/schedule/blocks` (`/new`, one block) and `/schedule/rules`; a carried program is placed at
// `/schedule/place/:offerId`. The old pages (`/log`, `/log/place/:offerId`, `/breaks`, `/blocks`)
// stay as redirects for good: emails, notifications and bookmarks carry them. Every redirect keeps
// the query (`day`, `view`, `edit`, `fill`, `entry`, `block`, `switch`, `modal`, …): the Log tab
// reads Evening as Day (Evening went), and the library's `place=<itemId>` as edit mode with that
// item to add (`edit=1&add=<itemId>`).

export type ScheduleTab = "log" | "templates" | "blocks" | "rules";

export const SCHEDULE_TABS: ReadonlyArray<{ value: ScheduleTab; label: string; path: string }> = [
  { value: "log", label: "Log", path: "schedule" },
  { value: "templates", label: "Templates", path: "schedule/templates" },
  { value: "blocks", label: "Blocks", path: "schedule/blocks" },
  { value: "rules", label: "Break rules", path: "schedule/rules" }
];

/** "/control/beat/schedule/rules". */
export function scheduleHref(base: string, tab: ScheduleTab = "log"): string {
  return `${base}/${SCHEDULE_TABS.find((t) => t.value === tab)!.path}`;
}

/** The old log's query, as the Log tab reads it. */
export function logQuery(search: string): URLSearchParams {
  const p = new URLSearchParams(search);
  if (p.get("view") === "evening") p.set("view", "day");
  const place = p.get("place");
  if (place !== null) {
    p.delete("place");
    p.set("edit", "1");
    p.set("add", place);
  }
  return p;
}

function withQuery(path: string, p: URLSearchParams): string {
  const q = p.toString();
  return q ? `${path}?${q}` : path;
}

/**
 * Where an old page lands: `rest` is its path after the station's base ("log", "blocks/new",
 * "log/place/o1"), `search` its query. The answer is relative to the base, with its query.
 * Null when `rest` isn't one of the old pages.
 */
export function oldRouteTarget(rest: string, search: string, opts: { studio?: boolean } = {}): string | null {
  const parts = rest.split("/").filter(Boolean);
  const p = new URLSearchParams(search);
  switch (parts[0]) {
    case "log":
      if (parts.length === 1) return withQuery("schedule", logQuery(search));
      // The market's B.3, "Place it in the log".
      if (parts[1] === "place" && parts[2] && parts.length === 3) return withQuery(`schedule/place/${parts[2]}`, p);
      return null;
    case "breaks": {
      if (parts.length !== 1) return null;
      // A studio has no breaks of its own: its spots are in its Spot rotation.
      if (opts.studio) return withQuery("spot-rotation", p);
      // Settings' "Edit" on a rotation opened its editor through Breaks.
      const rotation = p.get("rotation");
      if (rotation === "backup" || rotation === "main") return `spot-market/rotation?show=${rotation}`;
      p.delete("rotation");
      return withQuery("schedule", p);
    }
    case "blocks":
      if (parts.length === 1) return withQuery("schedule/blocks", p);
      if (parts.length === 2) return withQuery(`schedule/blocks/${parts[1]}`, p);
      return null;
    default:
      return null;
  }
}
