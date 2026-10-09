// Episodes: which one airs next, in a playback order, and what an uploaded file's name says about
// which episode it is.
//
// The walker is one pure function of the episodes, the order, a seed and the position, so the same
// inputs always give the same episode and generating a date twice gives the same log. It keeps no
// counter. The position is what has aired before (episode ids, oldest first), from the as-run log
// and the log already generated; a bare count works too, for a walk nothing has changed under.
//
// A walk goes round in cycles: every episode once, then again. A cycle is worked out from what
// aired: it ends when every episode has aired in it, or when one airs a second time. So:
// - An episode added partway through a cycle airs in that cycle, where its order puts it (In order:
//   when the walk reaches it; Newest first: next; Shuffle: at its place in the cycle's shuffle).
// - An episode that isn't ready is passed over for this airing and stays owed: In order airs it
//   once the walk has come round to the end of the cycle; the others, at its next turn.
// - A multi-part episode (the same `partOf` in one program) is one airing: every part, in part
//   order, or none of them while any part isn't ready.
// Shuffle sorts each cycle by a hash of the seed, the cycle and the episode, so an episode added
// later takes its own place without moving the others.

/** The orders episodes can air in (contracts' `PlaybackOrder` has their words). No plain random that repeats. */
export const PLAYBACK_ORDERS = ["in_order", "newest_first", "shuffle", "shuffle_shows", "marathon"] as const;
export type PlaybackOrder = (typeof PLAYBACK_ORDERS)[number];

/** What the walker needs to know about an episode. Callers pass their own items; it hands them back. */
export interface WalkEpisode {
  id: string;
  programId?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  /** When it was added to the library (the last tie-break in order). */
  createdAt: string | number | Date;
  /** A multi-part episode: what its parts share ("The Long Night"), and this part's number. */
  partOf?: string | null;
  partNumber?: number | null;
  /** It can air now (prepared, rights confirmed). Absent: it can. */
  ready?: boolean;
}

export interface WalkInput<E extends WalkEpisode> {
  /** One program's episodes, or several programs' (a mix). */
  episodes: readonly E[];
  order: PlaybackOrder;
  /** Shuffle's seed: the slot's id, say. The cycle number is added to it. */
  seed: string;
  /**
   * Where the walk is. What aired before, as episode ids, oldest first: ids no longer among the
   * episodes are ignored, and repeats in a row (a program's pieces around breaks, the parts of a
   * multi-part episode) are one airing. Or how many times it has aired: the airings it would have
   * made, with everything ready and nothing added since.
   */
  position: readonly string[] | number;
  /** A mix: the order its programs take turns in. Default: by id. */
  programs?: readonly string[];
}

export interface Airing<E extends WalkEpisode> {
  /** One episode, or every part of a multi-part episode in part order. */
  episodes: E[];
  /** Which time round this is: 0 the first. In Shuffle shows, this program's. */
  cycle: number;
  /** Nothing ready is left in the cycle after it: the next airing starts over. */
  endsCycle: boolean;
}

/** Every airing from the position on, in order. It ends only when nothing is ready. */
export function* walkEpisodes<E extends WalkEpisode>(input: WalkInput<E>): Generator<Airing<E>, void, undefined> {
  const units = unitsOf(input.episodes);
  if (!units.length) return;
  const history = typeof input.position === "number" ? rehearse(input, units) : input.position;
  if (input.order === "shuffle_shows") {
    yield* walkShows(units, history, input);
    return;
  }
  const walk = start(units, history);
  for (;;) {
    const next = pick(walk, input.order, input.seed, input.programs);
    if (!next) return;
    yield take(walk, next.unit, next.cycle);
  }
}

/** The next `count` airings (fewer when nothing is ready). */
export function nextEpisodes<E extends WalkEpisode>(input: WalkInput<E>, count = 1): Array<Airing<E>> {
  const out: Array<Airing<E>> = [];
  if (count <= 0) return out;
  for (const airing of walkEpisodes(input)) {
    out.push(airing);
    if (out.length >= count) break;
  }
  return out;
}

/** The next airing, or null for an empty program or one with nothing ready. */
export function nextEpisode<E extends WalkEpisode>(input: WalkInput<E>): Airing<E> | null {
  return nextEpisodes(input, 1)[0] ?? null;
}

// ---- Units: an episode, or a multi-part episode's parts ----

interface Unit<E extends WalkEpisode> {
  key: string;
  program: string;
  parts: E[];
  ready: boolean;
}

const added = (e: WalkEpisode) => (e.createdAt instanceof Date ? e.createdAt.getTime() : typeof e.createdAt === "number" ? e.createdAt : Date.parse(e.createdAt));
const nullsLast = (a: number | null | undefined, b: number | null | undefined) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : a - b);
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** In order: season, then episode, then date added (nulls last, as the library lists them). */
function inOrder(a: WalkEpisode, b: WalkEpisode): number {
  return nullsLast(a.seasonNumber, b.seasonNumber) || nullsLast(a.episodeNumber, b.episodeNumber) || added(a) - added(b) || byId(a.id, b.id);
}

/** "The Long Night" and "the long night " are one multi-part episode. */
const groupName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

function unitsOf<E extends WalkEpisode>(episodes: readonly E[]): Array<Unit<E>> {
  const units = new Map<string, Unit<E>>();
  for (const e of episodes) {
    const program = e.programId ?? "";
    const key = e.partOf?.trim() ? `${program}\u0000${groupName(e.partOf)}` : `#${e.id}`;
    const u = units.get(key) ?? { key, program, parts: [], ready: true };
    u.parts.push(e);
    u.ready &&= e.ready !== false;
    units.set(key, u);
  }
  for (const u of units.values()) u.parts.sort((a, b) => nullsLast(a.partNumber, b.partNumber) || inOrder(a, b));
  return [...units.values()];
}

// ---- Where the walk is ----

interface Walk<E extends WalkEpisode> {
  units: Array<Unit<E>>;
  cycle: number;
  /** Units aired in this cycle. */
  aired: Set<string>;
  last: Unit<E> | null;
}

function start<E extends WalkEpisode>(units: Array<Unit<E>>, history: readonly string[]): Walk<E> {
  const walk: Walk<E> = { units, cycle: 0, aired: new Set(), last: null };
  const unitOf = new Map<string, Unit<E>>();
  for (const u of units) for (const p of u.parts) unitOf.set(p.id, u);
  let previous: string | null = null;
  for (const id of history) {
    const u = unitOf.get(id);
    if (!u || u.key === previous) continue;
    previous = u.key;
    advance(walk, u);
  }
  return walk;
}

/** One airing of `u`: a unit already aired in this cycle starts the next; every unit aired ends it. */
function advance<E extends WalkEpisode>(walk: Walk<E>, u: Unit<E>): boolean {
  if (walk.aired.has(u.key)) {
    walk.cycle++;
    walk.aired = new Set();
  }
  walk.aired.add(u.key);
  walk.last = u;
  if (walk.units.every((x) => walk.aired.has(x.key))) {
    walk.cycle++;
    walk.aired = new Set();
    return true;
  }
  return false;
}

function take<E extends WalkEpisode>(walk: Walk<E>, u: Unit<E>, cycle: number): Airing<E> {
  // Nothing ready was left in the old cycle: this airing starts the new one.
  if (cycle > walk.cycle) {
    walk.cycle = cycle;
    walk.aired = new Set();
  }
  const ended = advance(walk, u);
  return { episodes: [...u.parts], cycle, endsCycle: ended || !walk.units.some((x) => x.ready && !walk.aired.has(x.key)) };
}

/** The airings a count stands for: the walk from the start, everything ready. */
function rehearse<E extends WalkEpisode>(input: WalkInput<E>, units: Array<Unit<E>>): string[] {
  const all = units.map((u) => ({ ...u, ready: true }));
  const out: string[] = [];
  const count = Math.max(0, Math.floor(input.position as number));
  if (input.order === "shuffle_shows") {
    let n = 0;
    for (const a of walkShows(all, [], input)) {
      if (n++ >= count) break;
      out.push(...a.episodes.map((e) => e.id));
    }
    return out;
  }
  const walk = start(all, []);
  for (let n = 0; n < count; n++) {
    const next = pick(walk, input.order, input.seed, input.programs);
    if (!next) break;
    out.push(...take(walk, next.unit, next.cycle).episodes.map((e) => e.id));
  }
  return out;
}

// ---- The orders ----

/** A cycle's running order. */
function sequence<E extends WalkEpisode>(units: Array<Unit<E>>, order: PlaybackOrder, seed: string, cycle: number, programs?: readonly string[]): Array<Unit<E>> {
  if (order === "shuffle") {
    const rank = new Map(units.map((u) => [u.key, hash(`${seed}\u0000${cycle}\u0000${u.key}`)]));
    return [...units].sort((a, b) => rank.get(a.key)! - rank.get(b.key)! || byId(a.key, b.key));
  }
  const lists = programOrder(units, programs).map((p) => units.filter((u) => u.program === p).sort((a, b) => inOrder(a.parts[0], b.parts[0])));
  if (order === "newest_first") return takeTurns(lists.map((l) => l.reverse()));
  if (order === "marathon") {
    // A whole season in a row; with several programs, they take turns a season at a time.
    const seasons = lists.map((l) => {
      const runs: Array<Array<Unit<E>>> = [];
      for (const u of l) {
        const run = runs[runs.length - 1];
        if (run && run[0].parts[0].seasonNumber === u.parts[0].seasonNumber) run.push(u);
        else runs.push([u]);
      }
      return runs;
    });
    return takeTurns(seasons).flat();
  }
  return takeTurns(lists);
}

/** First of each, then second of each, and so on. */
function takeTurns<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

function programOrder(units: Array<Unit<WalkEpisode>>, programs?: readonly string[]): string[] {
  const present = [...new Set(units.map((u) => u.program))].sort(byId);
  const named = (programs ?? []).filter((p) => present.includes(p));
  return [...named, ...present.filter((p) => !named.includes(p))];
}

function pick<E extends WalkEpisode>(walk: Walk<E>, order: PlaybackOrder, seed: string, programs?: readonly string[]): { unit: Unit<E>; cycle: number } | null {
  if (!walk.units.some((u) => u.ready)) return null;
  let left = sequence(walk.units, order, seed, walk.cycle, programs).filter((u) => !walk.aired.has(u.key));
  // In order and Marathon go on from the last airing, and come back round for what they passed over.
  if ((order === "in_order" || order === "marathon") && walk.aired.size && walk.last) {
    const seq = sequence(walk.units, order, seed, walk.cycle, programs);
    const at = seq.findIndex((u) => u.key === walk.last!.key);
    const after = new Set(seq.slice(at + 1).map((u) => u.key));
    left = [...left.filter((u) => after.has(u.key)), ...left.filter((u) => !after.has(u.key))];
  }
  // A fresh cycle doesn't open with what just aired.
  const fresh = (list: Array<Unit<E>>) => list.find((u) => u.ready && u !== walk.last) ?? list.find((u) => u.ready);
  const now = walk.aired.size ? left.find((u) => u.ready) : fresh(left);
  if (now) return { unit: now, cycle: walk.cycle };
  // Everything left in this cycle isn't ready: start the next.
  const unit = fresh(sequence(walk.units, order, seed, walk.cycle + 1, programs));
  return unit ? { unit, cycle: walk.cycle + 1 } : null;
}

/** Shuffle shows, keep each in order: which program airs is shuffled a round at a time; each program walks in order. */
function* walkShows<E extends WalkEpisode>(units: Array<Unit<E>>, history: readonly string[], input: WalkInput<E>): Generator<Airing<E>, void, undefined> {
  const programs = programOrder(units, input.programs);
  const walks = new Map(programs.map((p) => [p, start(units.filter((u) => u.program === p), history)]));
  // Airings so far, all programs: what aired, less repeats in a row.
  let count = 0;
  let previous: string | null = null;
  const unitOf = new Map<string, Unit<E>>();
  for (const u of units) for (const p of u.parts) unitOf.set(p.id, u);
  for (const id of history) {
    const u = unitOf.get(id);
    if (!u || u.key === previous) continue;
    previous = u.key;
    count++;
  }
  for (;;) {
    const round = Math.floor(count / programs.length);
    const turn = [...programs].sort((a, b) => hash(`${input.seed}\u0000round ${round}\u0000${a}`) - hash(`${input.seed}\u0000round ${round}\u0000${b}`) || byId(a, b));
    const first = count % programs.length;
    let made: Airing<E> | null = null;
    for (let i = 0; i < turn.length && !made; i++) {
      const walk = walks.get(turn[(first + i) % turn.length])!;
      const next = pick(walk, "in_order", input.seed, undefined);
      if (next) made = take(walk, next.unit, next.cycle);
    }
    if (!made) return;
    count++;
    yield made;
  }
}

/** A string's 32-bit hash (FNV-1a, then mixed), for seeded shuffles. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// ---- Guessing from a file's name ----

/** What a file's name (and the item's title) says about which episode it is. Nulls where it says nothing. */
export interface EpisodeGuess {
  seasonNumber: number | null;
  episodeNumber: number | null;
  /** A multi-part episode: what its parts share, and this part's number. */
  partOf: string | null;
  partNumber: number | null;
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
const positive = (n: number) => (Number.isInteger(n) && n > 0 ? n : null);

/**
 * Season and episode from a file's name: "S02E05", "s2.e5", "2x05", "Season 2 Episode 5", or an
 * episode alone ("Episode 5", "Ep. 5", "E05"). A part from the title (else the file's name):
 * "Part 1", "Pt. 2", "Part Two", "Part II", or "(1)" at the end; what comes before it is what the
 * parts share. Season and episode 0 (specials) aren't guessed.
 */
export function guessEpisode(filename: string, title?: string | null): EpisodeGuess {
  const name = clean(filename.replace(/\.[a-z0-9]{2,4}$/i, ""));
  let season: number | null = null;
  let episode: number | null = null;
  const se =
    /(?<![a-z0-9])s(\d{1,2})\s?[-.]?\s?e(\d{1,3})(?!\d)/i.exec(name) ??
    /(?<![a-z0-9])(\d{1,2})x(\d{2,3})(?![0-9])/i.exec(name) ??
    /\bseason\s*(\d{1,2})\b[\s,:\-–—]*\b(?:episode|ep\.?)\s*#?(\d{1,3})\b/i.exec(name);
  if (se) {
    season = positive(Number(se[1]));
    episode = positive(Number(se[2]));
  } else {
    const s = /\bseason\s*(\d{1,2})\b/i.exec(name);
    const e = /\b(?:episode|ep\.?)\s*#?(\d{1,3})\b/i.exec(name) ?? /(?<![a-z0-9])e(\d{2,3})(?![0-9])/i.exec(name);
    season = s ? positive(Number(s[1])) : null;
    episode = e ? positive(Number(e[1])) : null;
  }
  return { seasonNumber: season, episodeNumber: episode, ...guessPart(clean(title?.trim() || name)) };
}

function guessPart(text: string): Pick<EpisodeGuess, "partOf" | "partNumber"> {
  const none = { partOf: null, partNumber: null };
  const part = /^(.*?)[\s,:;\-–—(]*\b(?:part|pt\.?)\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|i{1,3}|iv|vi{0,3}|ix|x)\b/i.exec(text);
  const numbered = /^(.*\S)\s*\((\d{1,2})\)$/.exec(text);
  const found = part ?? numbered;
  if (!found) return none;
  const word = found[2].toLowerCase();
  const n = positive(/^\d+$/.test(word) ? Number(word) : (NUMBER_WORDS[word] ?? ROMAN[word] ?? 0));
  const of = found[1].replace(/[\s,:;\-–—(]+$/, "").trim();
  return n && of ? { partOf: of, partNumber: n } : none;
}

/** Dots and underscores between words read as spaces ("Late.Crate_S02E05"). */
const clean = (s: string) => s.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
