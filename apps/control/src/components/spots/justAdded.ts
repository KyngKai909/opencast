// "Newly added is amber" (C.3): what the station just changed, as a client diff. When the first
// spot goes into the rotation, the spots already in tonight's breaks are remembered; on Breaks,
// anything placed since is drawn amber, and the toast offers Undo (the rotation as it was). When
// the toast goes, the amber settles. Kept for the visit (sessionStorage), per station.

export interface JustAdded {
  stationId: string;
  /** Spot fills in upcoming breaks before the first add. */
  before: string[];
  /** The main rotation before the first add (Undo puts it back). */
  previousMain: string[];
  /** Spots added since, in order. */
  added: string[];
}

const KEY = "cc-spots-just-added";
const listeners = new Set<() => void>();

function readAll(): Record<string, JustAdded> {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Record<string, JustAdded>;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, JustAdded>) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage off: the amber shows for this page only.
  }
  listeners.forEach((l) => l());
}

export function justAdded(stationId: string): JustAdded | null {
  return readAll()[stationId] ?? null;
}

/** Records an added spot; the first one in a run also records what was there before. */
export function noteAdded(stationId: string, spotId: string, before: () => { fills: string[]; main: string[] }) {
  const all = readAll();
  const cur = all[stationId] ?? { stationId, ...(({ fills, main }) => ({ before: fills, previousMain: main }))(before()), added: [] };
  if (!cur.added.includes(spotId)) cur.added.push(spotId);
  all[stationId] = cur;
  writeAll(all);
}

/** Takes a spot back out of the run (removed again before the toast). */
export function noteRemoved(stationId: string, spotId: string) {
  const all = readAll();
  const cur = all[stationId];
  if (!cur) return;
  cur.added = cur.added.filter((x) => x !== spotId);
  if (cur.added.length) all[stationId] = cur;
  else delete all[stationId];
  writeAll(all);
}

/** The amber settles (the toast went, or Undo). */
export function settle(stationId: string) {
  const all = readAll();
  delete all[stationId];
  writeAll(all);
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
