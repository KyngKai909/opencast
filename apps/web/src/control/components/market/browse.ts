// The Browse tab's facets and sort (market 01.1), kept in the query string: `?kind=series&band=tv
// &deal=barter,cash&made=station,studio,catalog&sort=fits`. The contract's browse can't filter by
// kind or maker, sort, or count facets (contract request C2), so the page asks for the whole market
// once and filters, counts and sorts here. A group with nothing ticked doesn't filter.

import type { Band, FitSlot, Offer } from "@opencast/contracts";

export type KindFacet = "series" | "one_off" | "live";
export type DealFacet = "barter" | "cash";
export type MadeFacet = Offer["makerKind"];
export type BrowseSort = "fits" | "carried" | "newest";

export interface BrowseFilters {
  kind: KindFacet[];
  band: Band[];
  category: string[];
  deal: DealFacet[];
  made: MadeFacet[];
  sort: BrowseSort;
}

const KINDS: KindFacet[] = ["series", "one_off", "live"];
const BANDS: Band[] = ["tv", "radio"];
const DEALS: DealFacet[] = ["barter", "cash"];
const MADE: MadeFacet[] = ["station", "studio", "catalog"];

function list<T extends string>(p: URLSearchParams, key: string, allowed?: readonly T[]): T[] {
  const raw = (p.get(key) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return (allowed ? raw.filter((r) => (allowed as readonly string[]).includes(r)) : raw) as T[];
}

export function readFilters(p: URLSearchParams): BrowseFilters {
  const sort = p.get("sort");
  return {
    kind: list(p, "kind", KINDS),
    band: list(p, "band", BANDS),
    category: list(p, "category"),
    deal: list(p, "deal", DEALS),
    made: list(p, "made", MADE),
    sort: sort === "carried" || sort === "newest" ? sort : "fits"
  };
}

/** Writes the filters back into the query string, keeping anything else there (q, gap). */
export function writeFilters(p: URLSearchParams, f: BrowseFilters): URLSearchParams {
  const next = new URLSearchParams(p);
  for (const key of ["kind", "band", "category", "deal", "made"] as const) {
    if (f[key].length) next.set(key, f[key].join(","));
    else next.delete(key);
  }
  if (f.sort === "fits") next.delete("sort");
  else next.set("sort", f.sort);
  return next;
}

export function isSeries(o: Offer): boolean {
  return (o.program.format?.kind ?? (o.program.episodeCount > 1 ? "series" : "one_off")) === "series";
}

/** The bands a program suits. Without the L1 format, the maker's band. */
export function bandsOf(o: Offer): Band[] {
  return o.program.format?.bands ?? (o.maker.band ? [o.maker.band] : BANDS);
}

function kindMatch(o: Offer, kinds: KindFacet[]): boolean {
  if (!kinds.length) return true;
  return kinds.some((k) => (k === "live" ? o.program.live : k === "series" ? isSeries(o) : !isSeries(o)));
}

/** Free programs cost nothing under any deal, so a deal filter never hides them. Cash plus barter counts as both. */
function dealMatch(o: Offer, deals: DealFacet[]): boolean {
  if (!deals.length) return true;
  const t = o.termsOffered;
  if (t.includes("free")) return true;
  return deals.some((d) => t.includes(d) || t.includes("cash_plus_barter"));
}

export function matches(o: Offer, f: BrowseFilters): boolean {
  return (
    kindMatch(o, f.kind) &&
    (!f.band.length || bandsOf(o).some((b) => f.band.includes(b))) &&
    (!f.category.length || (o.program.category != null && f.category.includes(o.program.category))) &&
    dealMatch(o, f.deal) &&
    (!f.made.length || f.made.includes(o.makerKind))
  );
}

export interface FacetCounts {
  kind: Record<KindFacet, number>;
  band: Record<Band, number>;
  category: [string, number][];
  deal: Record<DealFacet, number>;
  made: Record<MadeFacet, number>;
}

/** Counts over the whole market (not the filtered list), so a count never changes as you tick. */
export function facetCounts(offers: readonly Offer[]): FacetCounts {
  const one = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, 0]));
  const c = { kind: one(KINDS), band: one(BANDS), deal: one(DEALS), made: one(MADE) } as unknown as Omit<FacetCounts, "category">;
  const cats = new Map<string, number>();
  for (const o of offers) {
    for (const k of KINDS) if (kindMatch(o, [k])) c.kind[k]++;
    for (const b of bandsOf(o)) c.band[b]++;
    for (const d of DEALS) if (o.termsOffered.includes(d) || o.termsOffered.includes("cash_plus_barter")) c.deal[d]++;
    c.made[o.makerKind]++;
    if (o.program.category) cats.set(o.program.category, (cats.get(o.program.category) ?? 0) + 1);
  }
  return { ...c, category: [...cats.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) };
}

/** Best fit first: an exact fit for a gap, then a gap, then a repeat or weak slot, then no fit. */
export function fitRank(fit: readonly FitSlot[] | undefined): number {
  if (!fit?.length) return 3;
  if (fit.some((s) => s.reason === "dead_air" && s.exact)) return 0;
  if (fit.some((s) => s.reason === "dead_air")) return 1;
  return 2;
}

export function sortOffers(offers: readonly Offer[], sort: BrowseSort): Offer[] {
  const byCarriers = (a: Offer, b: Offer) => b.carriers - a.carriers || a.program.title.localeCompare(b.program.title);
  const newest = (a: Offer, b: Offer) => (b.offeredAt ?? "").localeCompare(a.offeredAt ?? "") || byCarriers(a, b);
  const copy = [...offers];
  if (sort === "carried") return copy.sort(byCarriers);
  if (sort === "newest") return copy.sort(newest);
  return copy.sort((a, b) => fitRank(a.fit) - fitRank(b.fit) || byCarriers(a, b));
}

/** The line above the list: "42 series", "18 one-offs", "12 programs". */
export function resultWords(n: number, f: Pick<BrowseFilters, "kind">): string {
  if (f.kind.length === 1 && f.kind[0] === "series") return `${n} series`;
  if (f.kind.length === 1 && f.kind[0] === "one_off") return `${n} ${n === 1 ? "one-off" : "one-offs"}`;
  return `${n} ${n === 1 ? "program" : "programs"}`;
}

export function browse(offers: readonly Offer[], f: BrowseFilters): Offer[] {
  return sortOffers(
    offers.filter((o) => matches(o, f)),
    f.sort
  );
}
