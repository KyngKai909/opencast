import { describe, expect, it } from "vitest";
import type { OfferX } from "../../api/ext/market";
import { browse, facetCounts, fitRank, readFilters, resultWords, writeFilters } from "./browse";

function offer(title: string, o: Partial<OfferX> & { kind?: "series" | "one_off"; bands?: ("tv" | "radio")[]; live?: boolean; category?: string } = {}): OfferX {
  const { kind = "series", bands = ["tv"], live = false, category = "Music", ...rest } = o;
  return {
    id: title,
    program: { id: title, title, description: null, category, live, episodeCount: 10, rightsNote: null, format: { kind, cadence: null, episodeLengthMs: 3_600_000, bands } },
    maker: { id: "m", kind: "station", callSign: "HALL", handle: "hall", name: "Study Hall", colour: null, band: "radio", channel: "90.7", marketSlug: "inland-empire", homeCity: null },
    makerKind: "station",
    status: "offered",
    carriers: 1,
    fitsYourSchedule: null,
    previews: 0,
    termsOffered: ["barter"],
    cashPriceMicros: null,
    cashPriceUnit: null,
    barterMakerMsPerHour: 120_000,
    airingsPerEpisode: 3,
    windowDays: 7,
    liveOnly: false,
    noticeDays: 7,
    approval: "any_station",
    radioBandAllowed: true,
    ...rest
  };
}

const gap = (exact: boolean) => [{ reason: "dead_air" as const, label: "11:40 pm gap", title: "", startsAt: "2026-09-27T06:40:00Z", endsAt: "2026-09-27T09:00:00Z", exact }];
const repeats = [{ reason: "library_repeats" as const, label: "weeknights 1:00 am", title: "Weeknights after 1:00 am", startsAt: null, endsAt: null, exact: false }];

const MARKET = [
  offer("Newsreel hour", { carriers: 3, termsOffered: ["cash"], offeredAt: "2026-08-27T00:00:00Z" }),
  offer("Nights at the observatory", { carriers: 14, termsOffered: ["free"], makerKind: "catalog", fit: gap(false), offeredAt: "2026-07-28T00:00:00Z" }),
  offer("Slow Hours", { carriers: 5, termsOffered: ["barter", "cash"], fit: gap(true), bands: ["tv", "radio"], offeredAt: "2026-05-29T00:00:00Z" }),
  offer("Crate Diggers Radio Hour", { carriers: 4, makerKind: "studio", fit: repeats, offeredAt: "2026-06-28T00:00:00Z" }),
  offer("Council Watch", { carriers: 6, category: "Public affairs", offeredAt: "2026-03-10T00:00:00Z" }),
  offer("Night Desk", { carriers: 4, bands: ["radio"], termsOffered: ["cash_plus_barter"], category: "Classic" }),
  offer("Double feature", { carriers: 1, kind: "one_off", termsOffered: ["cash"] }),
  offer("The Producers’ Hour", { carriers: 9, live: true, bands: ["radio"] })
];

describe("browsing the market", () => {
  it("reads and writes the facets in the query string, keeping the search and the gap", () => {
    const p = new URLSearchParams("kind=series&band=tv&deal=barter,cash&made=station,studio,catalog&q=slow&gap=x&kind2=no");
    const f = readFilters(p);
    expect(f).toEqual({ kind: ["series"], band: ["tv"], category: [], deal: ["barter", "cash"], made: ["station", "studio", "catalog"], sort: "fits" });
    const next = writeFilters(p, { ...f, band: [], sort: "newest" });
    expect(next.get("band")).toBeNull();
    expect(next.get("sort")).toBe("newest");
    expect(next.get("q")).toBe("slow");
    expect(next.get("gap")).toBe("x");
    expect(readFilters(new URLSearchParams("sort=bogus&kind=nope")).sort).toBe("fits");
  });

  it("puts programs that fit the schedule first: an exact gap, a gap, a repeat slot, then by carriers", () => {
    expect(fitRank(gap(true))).toBe(0);
    expect(fitRank(repeats)).toBe(2);
    const f = readFilters(new URLSearchParams("kind=series&band=tv&deal=barter,cash"));
    expect(browse(MARKET, f).map((o) => o.program.title)).toEqual(["Slow Hours", "Nights at the observatory", "Crate Diggers Radio Hour", "Council Watch", "Newsreel hour"]);
  });

  it("sorts by carriers and by newest when asked", () => {
    const all = readFilters(new URLSearchParams("sort=carried"));
    expect(browse(MARKET, all)[0]!.program.title).toBe("Nights at the observatory");
    const newest = readFilters(new URLSearchParams("sort=newest"));
    expect(browse(MARKET, newest)[0]!.program.title).toBe("Newsreel hour");
  });

  it("never hides a free program behind a deal filter, and counts cash plus barter as both", () => {
    const cash = readFilters(new URLSearchParams("deal=cash"));
    const titles = browse(MARKET, cash).map((o) => o.program.title);
    expect(titles).toContain("Nights at the observatory");
    expect(titles).toContain("Night Desk");
    expect(titles).not.toContain("Crate Diggers Radio Hour");
  });

  it("filters by kind, live and maker kind", () => {
    expect(browse(MARKET, readFilters(new URLSearchParams("kind=one_off"))).map((o) => o.program.title)).toEqual(["Double feature"]);
    expect(browse(MARKET, readFilters(new URLSearchParams("kind=live"))).map((o) => o.program.title)).toEqual(["The Producers’ Hour"]);
    expect(browse(MARKET, readFilters(new URLSearchParams("made=studio,catalog"))).map((o) => o.program.title)).toEqual(["Nights at the observatory", "Crate Diggers Radio Hour"]);
  });

  it("counts facets over the whole market", () => {
    const c = facetCounts(MARKET);
    expect(c.kind).toEqual({ series: 7, one_off: 1, live: 1 });
    expect(c.band).toEqual({ tv: 6, radio: 3 });
    expect(c.deal).toEqual({ barter: 5, cash: 4 });
    expect(c.made).toEqual({ station: 6, studio: 1, catalog: 1 });
    expect(c.category[0]).toEqual(["Music", 6]);
  });

  it("says what the list holds", () => {
    expect(resultWords(42, { kind: ["series"] })).toBe("42 series");
    expect(resultWords(1, { kind: ["one_off"] })).toBe("1 one-off");
    expect(resultWords(12, { kind: [] })).toBe("12 programs");
  });
});
