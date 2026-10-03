// A241 (2026-10-01, the user's decision): two more ways for an external station's "what's on" to
// come in. A webpage's own event data (schema.org JSON-LD, read as text, never run), and a weekly
// schedule entered by hand, checked against the source's published schedule, made into the same
// airings a feed produces for the next 14 days (on save, and hourly). Nothing is made up: an item
// without a title or a start is left out, and a page with no event data says so.
// No network: every fetch here is a fake, and the clock is pinned.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, gte } from "drizzle-orm";
import { schema } from "@opencast/db";
import { manualScheduleProblems, weeklyText } from "@opencast/contracts";
import { checkManual, type Fetch } from "../src/v1/modules/network/external.js";
import { detectScheduleFormat, parseSchedule } from "../src/v1/lib/schedules.js";
import { isoDurationMs, jsonLdDate, parseJsonLdEvents } from "../src/v1/lib/jsonLd.js";
import { manualAirings } from "../src/v1/lib/manualSchedule.js";
import { anon, createHarness, market, type Harness, type User } from "./harness.js";

const LA = "America/Los_Angeles";
const page = (...blocks: string[]) =>
  `<!DOCTYPE html><html><head><title>Schedule</title>${blocks.map((b) => `<script type="application/ld+json">${b}</script>`).join("\n")}</head><body><h1>Schedule</h1></body></html>`;
const titles = (html: string, tz = LA) => parseJsonLdEvents(html, tz).map((e) => [e.summary, e.start.toISOString(), e.end?.toISOString() ?? null]);

describe("a JSON schedule", () => {
  const rows = (text: string) => parseSchedule(text, "json").map((e) => [e.uid, e.summary, e.start.toISOString(), e.end?.toISOString() ?? null]);

  it("reads an array, and the lists sources put under a name", () => {
    const ev = { id: "a", title: "Morning Show", start: "2026-10-04T15:00:00Z", end: "2026-10-04T16:00:00Z" };
    const row = ["a", "Morning Show", "2026-10-04T15:00:00.000Z", "2026-10-04T16:00:00.000Z"];
    expect(rows(JSON.stringify([ev]))).toEqual([row]);
    expect(rows(JSON.stringify({ events: [ev] }))).toEqual([row]);
    expect(rows(JSON.stringify({ items: [ev] }))).toEqual([row]);
    expect(rows(JSON.stringify({ schedule: [ev] }))).toEqual([row]);
    expect(rows(JSON.stringify({ data: { events: [ev] } }))).toEqual([row]);
    expect(rows(JSON.stringify({ something: [ev] }))).toEqual([]);
  });

  it("reads a show-schedule plugin's { now, active, upcoming }: what's on now first, a weekly show's repeats as they're listed, once each", () => {
    const show = (id: string, title: string, start: string, end: string) => ({ id, title, host: "", description: "…", recurrence: "custom", intervalDays: 7, timezone: LA, start, end, sourceId: id });
    const feed = {
      now: "2026-10-03T23:10:00.000Z",
      active: show("show-1", "Evening Hour", "2026-10-03T23:00:00.000Z", "2026-10-04T00:00:00.000Z"),
      upcoming: [
        show("show-1", "Evening Hour", "2026-10-03T23:00:00.000Z", "2026-10-04T00:00:00.000Z"),
        show("show-2", "Late Film", "2026-10-04T00:00:00.000Z", "2026-10-04T02:00:00.000Z"),
        show("show-2", "Late Film", "2026-10-11T00:00:00.000Z", "2026-10-11T02:00:00.000Z")
      ]
    };
    expect(rows(JSON.stringify(feed))).toEqual([
      ["show-1", "Evening Hour", "2026-10-03T23:00:00.000Z", "2026-10-04T00:00:00.000Z"],
      ["show-2", "Late Film", "2026-10-04T00:00:00.000Z", "2026-10-04T02:00:00.000Z"],
      ["show-2", "Late Film", "2026-10-11T00:00:00.000Z", "2026-10-11T02:00:00.000Z"]
    ]);
    // Nothing on now.
    expect(rows(JSON.stringify({ ...feed, active: null }))).toHaveLength(3);
  });
});

describe("a webpage's event data (JSON-LD)", () => {
  it("is recognised by its type or how it starts, and never mistaken for a feed", () => {
    expect(detectScheduleFormat("https://city.example.gov/meetings", "text/html; charset=utf-8", "<html><head></head></html>")).toBe("webpage");
    expect(detectScheduleFormat("https://city.example.gov/meetings", null, "  <!DOCTYPE html>\n<html>")).toBe("webpage");
    expect(detectScheduleFormat("https://city.example.gov/meetings", null, "<html lang=en>")).toBe("webpage");
    // A server that labels everything text/html still has its feeds read as feeds.
    expect(detectScheduleFormat("https://city.example.gov/feed", "text/html", '<?xml version="1.0"?><rss><channel></channel></rss>')).toBe("rss");
    expect(detectScheduleFormat("https://city.example.gov/feed", "text/html", '{"events":[]}')).toBe("json");
    expect(detectScheduleFormat("https://epg.example.org/guide", "text/html", '<!DOCTYPE tv SYSTEM "xmltv.dtd"><tv></tv>')).toBe("xmltv");
  });

  it("reads a single Event", () => {
    const html = page(JSON.stringify({ "@context": "https://schema.org", "@type": "Event", name: "City Council, regular meeting", startDate: "2026-10-06T18:00:00-07:00", endDate: "2026-10-06T21:00:00-07:00", url: "https://city.example.gov/meetings/1006" }));
    expect(parseJsonLdEvents(html, LA)).toEqual([{ uid: "https://city.example.gov/meetings/1006", summary: "City Council, regular meeting", start: new Date("2026-10-07T01:00:00Z"), end: new Date("2026-10-07T04:00:00Z") }]);
    expect(parseSchedule(html, "webpage", "https://city.example.gov/meetings", LA)).toHaveLength(1);
  });

  it("reads an array, @graph, and an ItemList (items and { item })", () => {
    const array = page(JSON.stringify([
      { "@type": "Event", name: "Planning Commission", startDate: "2026-10-07T18:00:00-07:00" },
      { "@type": "WebSite", name: "City of Somewhere" },
      { "@type": ["Event", "Thing"], name: "Parks &amp; Recreation Commission", startDate: "2026-10-08T01:30:00Z" }
    ]));
    expect(titles(array)).toEqual([
      ["Planning Commission", "2026-10-08T01:00:00.000Z", null],
      ["Parks & Recreation Commission", "2026-10-08T01:30:00.000Z", null]
    ]);
    const graph = page(JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage", name: "Meetings" }, { "@type": "schema:Event", name: "Library Board", startDate: "2026-10-09T17:00:00-07:00" }] }));
    expect(titles(graph)).toEqual([["Library Board", "2026-10-10T00:00:00.000Z", null]]);
    const list = page(JSON.stringify({
      "@type": "ItemList",
      itemListElement: [
        { "@type": "ListItem", position: 1, item: { "@type": "Event", name: "Story time", startDate: "2026-10-10T10:00:00-07:00", endDate: "2026-10-10T10:45:00-07:00" } },
        { "@type": "Event", name: "Author talk", startDate: "2026-10-10T14:00:00-07:00" }
      ]
    }));
    expect(titles(list)).toEqual([
      ["Story time", "2026-10-10T17:00:00.000Z", "2026-10-10T17:45:00.000Z"],
      ["Author talk", "2026-10-10T21:00:00.000Z", null]
    ]);
  });

  it("reads a BroadcastService's subEvents, and an event whose sub-events are listed gives way to them", () => {
    const html = page(JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BroadcastService",
      name: "Somewhere Public Access",
      subEvent: [
        { "@type": "BroadcastEvent", name: "Morning Report", startDate: "2026-10-12T07:00:00-07:00", endDate: "2026-10-12T08:00:00-07:00" },
        { "@type": "BroadcastEvent", name: "School Board", startDate: "2026-10-12T18:00:00-07:00", endDate: "2026-10-12T20:00:00-07:00" }
      ]
    }), JSON.stringify({
      "@type": "Organization",
      name: "City of Somewhere",
      event: { "@type": "Festival", name: "Fall Fest", startDate: "2026-10-17T10:00:00-07:00", endDate: "2026-10-17T22:00:00-07:00", subEvent: [{ "@type": "MusicEvent", name: "Fall Fest: the main stage", startDate: "2026-10-17T19:00:00-07:00" }] }
    }));
    expect(titles(html).map(([t]) => t)).toEqual(["Morning Report", "School Board", "Fall Fest: the main stage"]);
  });

  it("titles a TVEpisode or BroadcastEvent from workPerformed, about or broadcastOfEvent, and a publication from its work", () => {
    const html = page(JSON.stringify([
      { "@type": "TVEpisode", workPerformed: { "@type": "CreativeWork", name: "Inside City Hall, episode 12" }, startDate: "2026-10-13T19:00:00-07:00", duration: "PT30M" },
      { "@type": "BroadcastEvent", workPerformed: [{ "@type": "TVEpisode", name: "Council Recap" }], startDate: "2026-10-13T19:30:00-07:00" },
      { "@type": "BroadcastEvent", broadcastOfEvent: { "@type": "SportsEvent", name: "Varsity football: Redlands at Colton" }, startDate: "2026-10-16T19:00:00-07:00" },
      { "@type": "ScreeningEvent", about: { name: "Classic film night" }, startDate: "2026-10-14T20:00:00-07:00" },
      { "@type": "TVSeries", name: "Meet the Mayor", publication: { "@type": "PublicationEvent", startDate: "2026-10-15T12:00:00-07:00", duration: "PT1H" } }
    ]));
    expect(titles(html)).toEqual([
      ["Inside City Hall, episode 12", "2026-10-14T02:00:00.000Z", "2026-10-14T02:30:00.000Z"],
      ["Council Recap", "2026-10-14T02:30:00.000Z", null],
      ["Varsity football: Redlands at Colton", "2026-10-17T02:00:00.000Z", null],
      ["Classic film night", "2026-10-15T03:00:00.000Z", null],
      ["Meet the Mayor", "2026-10-15T19:00:00.000Z", "2026-10-15T20:00:00.000Z"]
    ]);
  });

  it("ends an event at its start plus its ISO 8601 duration, when it has no endDate", () => {
    expect(isoDurationMs("PT1H30M")).toBe(90 * 60_000);
    expect(isoDurationMs("PT90M")).toBe(90 * 60_000);
    expect(isoDurationMs("P1DT2H")).toBe(26 * 3_600_000);
    expect(isoDurationMs("PT0.5H")).toBe(30 * 60_000);
    // No fixed length, nothing, or not a duration: not read.
    for (const v of ["P1M", "P1Y", "PT", "PT0S", "90 minutes", null]) expect(isoDurationMs(v)).toBeNull();
    const html = page(JSON.stringify({ "@type": "Event", name: "Town hall", startDate: "2026-10-20T18:00:00-07:00", duration: "PT1H30M" }));
    expect(titles(html)).toEqual([["Town hall", "2026-10-21T01:00:00.000Z", "2026-10-21T02:30:00.000Z"]]);
    // An endDate wins over a duration.
    const both = page(JSON.stringify({ "@type": "Event", name: "Town hall", startDate: "2026-10-20T18:00:00-07:00", endDate: "2026-10-20T19:00:00-07:00", duration: "PT3H" }));
    expect(titles(both)[0]![2]).toBe("2026-10-21T02:00:00.000Z");
  });

  it("reads a start without an offset in the market's time zone, summer or winter", () => {
    const html = page(JSON.stringify([
      { "@type": "Event", name: "Before the clocks change", startDate: "2026-10-31T18:00", endDate: "2026-10-31T20:00:00" },
      { "@type": "Event", name: "After the clocks change", startDate: "2026-11-02 18:00:00" }
    ]));
    expect(titles(html)).toEqual([
      ["Before the clocks change", "2026-11-01T01:00:00.000Z", "2026-11-01T03:00:00.000Z"],
      ["After the clocks change", "2026-11-03T02:00:00.000Z", null]
    ]);
    expect(titles(html, "America/New_York")[0]![1]).toBe("2026-10-31T22:00:00.000Z");
    expect(jsonLdDate("2026-10-31T18:00:00+0000", LA)?.toISOString()).toBe("2026-10-31T18:00:00.000Z");
    // A day with no time isn't a time on the dial.
    expect(jsonLdDate("2026-10-31", LA)).toBeNull();
  });

  it("leaves out items without a title or a start, cancelled ones and repeats, and makes nothing up", () => {
    const html = page(JSON.stringify([
      { "@type": "Event", startDate: "2026-10-21T18:00:00-07:00" },
      { "@type": "Event", name: "No start" },
      { "@type": "Event", name: "A date, no time", startDate: "2026-10-22" },
      { "@type": "Event", name: "   ", startDate: "2026-10-22T18:00:00-07:00" },
      { "@type": "Event", name: "Called off", startDate: "2026-10-23T18:00:00-07:00", eventStatus: "https://schema.org/EventCancelled" },
      { "@type": "Place", name: "City Hall", startDate: "2026-10-23T18:00:00-07:00" },
      { "@type": "Event", name: "Budget hearing", startDate: "2026-10-24T18:00:00-07:00" },
      { "@type": "Event", name: "Budget hearing", startDate: "2026-10-24T18:00:00-07:00" }
    ]));
    expect(titles(html)).toEqual([["Budget hearing", "2026-10-25T01:00:00.000Z", null]]);
  });

  it("ignores malformed JSON blocks and reads the rest (comments, CDATA and stray newlines too)", () => {
    const html = page(
      "{ this isn't json",
      `<!-- ${JSON.stringify({ "@type": "Event", name: "In a comment", startDate: "2026-10-26T18:00:00-07:00" })} -->`,
      `/*<![CDATA[*/${JSON.stringify({ "@type": "Event", name: "In CDATA", startDate: "2026-10-27T18:00:00-07:00" })}/*]]>*/`,
      '{"@type":"Event","name":"A line\nbreak","startDate":"2026-10-28T18:00:00-07:00"}'
    ) + `<script type="text/javascript">var x = {"@type":"Event","name":"Not JSON-LD","startDate":"2026-10-29T18:00:00-07:00"};</script>`;
    expect(titles(html).map(([t]) => t)).toEqual(["In a comment", "In CDATA", "A line break"]);
  });

  it("finds nothing on a page with no event data", () => {
    expect(parseJsonLdEvents(page(JSON.stringify({ "@type": "Organization", name: "City of Somewhere" })), LA)).toEqual([]);
    expect(parseJsonLdEvents("<html><body><p>Meetings are the first Tuesday of the month.</p></body></html>", LA)).toEqual([]);
  });
});

describe("a schedule entered by hand: the rules", () => {
  const slot = (o: object) => ({ days: ["mon"], start: "18:00", end: "21:00", title: "City Council", ...o }) as never;

  it("needs a day, 5-minute times that differ, a title of 120 characters at most, and a season that ends after it starts", () => {
    expect(manualScheduleProblems([slot({ days: [] })])).toEqual([{ slot: 0, field: "days", message: "Pick at least one day." }]);
    expect(manualScheduleProblems([slot({ start: "18:03" })])[0]).toMatchObject({ field: "start", message: expect.stringContaining("5-minute steps") });
    expect(manualScheduleProblems([slot({ end: "18:00" })])[0]).toMatchObject({ field: "end" });
    expect(manualScheduleProblems([slot({ title: " " })])[0]).toMatchObject({ field: "title", message: "Give it the title they publish." });
    expect(manualScheduleProblems([slot({ title: "x".repeat(121) })])[0]).toMatchObject({ field: "title" });
    expect(manualScheduleProblems([slot({ from: "2026-12-01", until: "2026-11-01" })])[0]).toMatchObject({ field: "until" });
    expect(manualScheduleProblems([slot({})])).toEqual([]);
  });

  it("refuses two slots on at once, past midnight and across the week's end too, but not in different seasons", () => {
    expect(manualScheduleProblems([slot({ days: ["mon", "tue", "wed"] }), slot({ days: ["wed"], start: "20:00", end: "22:00", title: "Planning Commission" })])).toEqual([
      { slot: 1, field: "start", message: "“Planning Commission” overlaps “City Council” on Wednesdays at 8:00 pm. Two slots can't be on at once." }
    ]);
    // Saturday 11 pm to 1 am runs into Sunday's 12:30 am.
    expect(manualScheduleProblems([slot({ days: ["sat"], start: "23:00", end: "01:00" }), slot({ days: ["sun"], start: "00:30", end: "02:00", title: "Night owls" })])[0]?.message).toContain("on Sundays at 12:30 am");
    // Sunday 11 pm to 1 am runs into Monday.
    expect(manualScheduleProblems([slot({ days: ["sun"], start: "23:00", end: "01:00" }), slot({ days: ["mon"], start: "00:00", end: "00:30", title: "Night owls" })])).toHaveLength(1);
    // Back to back is fine.
    expect(manualScheduleProblems([slot({}), slot({ start: "21:00", end: "22:00", title: "After the meeting" })])).toEqual([]);
    expect(manualScheduleProblems([slot({ until: "2026-12-31" }), slot({ from: "2027-01-01", title: "Winter schedule" })])).toEqual([]);
  });

  it("needs where it was checked and when", () => {
    const base = { source: "manual" as const, slots: [slot({})], checkedAgainst: "https://city.example.gov/schedule", checkedOn: "2026-10-01" };
    expect(() => checkManual({ ...base, checkedAgainst: "" })).toThrow("Say where you checked it");
    expect(() => checkManual({ ...base, checkedOn: "" })).toThrow("Say when you checked it");
    expect(() => checkManual(base)).not.toThrow();
  });

  it("says the week compactly", () => {
    expect(weeklyText([slot({ days: ["fri", "mon", "tue", "wed", "thu"] }), slot({ days: ["sat", "sun"], start: "10:00", end: "11:30", title: "Weekend notices" }), slot({ days: ["sat"], start: "23:00", end: "01:00", title: "Night owls" })])).toBe(
      "Mon–Fri 6:00–9:00 pm: City Council; Sat, Sun 10:00–11:30 am: Weekend notices; Sat 11:00 pm–1:00 am: Night owls"
    );
  });
});

describe("a schedule entered by hand: its airings", () => {
  const council = { days: ["mon", "tue", "wed", "thu", "fri"] as const, start: "18:00", end: "21:00", title: "Planning Commission" };
  const overnight = { days: ["sat"] as const, start: "23:00", end: "03:00", title: "Overnight notices" };

  it("keeps 6:00 pm at 6:00 pm across the clocks going back in Los Angeles, and runs past midnight through the change", () => {
    const airings = manualAirings({ slots: [{ ...council, days: [...council.days] }, { ...overnight, days: [...overnight.days] }], skipDates: [] }, LA, new Date("2026-10-30T19:00:00Z"), new Date("2026-11-03T08:00:00Z"));
    expect(airings.map((a) => [a.summary, a.start.toISOString(), a.end!.toISOString()])).toEqual([
      ["Planning Commission", "2026-10-31T01:00:00.000Z", "2026-10-31T04:00:00.000Z"], // Fri Oct 30, PDT
      // Sat 11:00 pm PDT to Sun 3:00 am PST: five hours on the clock's night.
      ["Overnight notices", "2026-11-01T06:00:00.000Z", "2026-11-01T11:00:00.000Z"],
      ["Planning Commission", "2026-11-03T02:00:00.000Z", "2026-11-03T05:00:00.000Z"] // Mon Nov 2, PST
    ]);
  });

  it("goes forward in spring too, and moves a time the clocks skip on by the gap", () => {
    const airings = manualAirings({ slots: [{ ...overnight, days: ["sat"] }, { days: ["sun"], start: "03:30", end: "04:00", title: "Early" }], skipDates: [] }, LA, new Date("2026-03-07T20:00:00Z"), new Date("2026-03-09T00:00:00Z"));
    expect(airings.map((a) => [a.summary, a.start.toISOString(), a.end!.toISOString()])).toEqual([
      // Sat 11:00 pm PST to Sun 3:00 am PDT: three hours.
      ["Overnight notices", "2026-03-08T07:00:00.000Z", "2026-03-08T10:00:00.000Z"],
      ["Early", "2026-03-08T10:30:00.000Z", "2026-03-08T11:00:00.000Z"]
    ]);
    const gap = manualAirings({ slots: [{ days: ["sun"], start: "02:30", end: "04:00", title: "In the gap" }], skipDates: [] }, LA, new Date("2026-03-07T20:00:00Z"), new Date("2026-03-09T00:00:00Z"));
    expect(gap.map((a) => [a.start.toISOString(), a.end!.toISOString()])).toEqual([["2026-03-08T10:30:00.000Z", "2026-03-08T11:00:00.000Z"]]);
  });

  it("skips the dates it doesn't air and keeps to a slot's season", () => {
    const airings = manualAirings(
      { slots: [{ ...council, days: [...council.days] }, { days: ["sat"], start: "10:00", end: "11:00", title: "Story time", until: "2026-11-07" }], skipDates: ["2026-11-02"] },
      LA,
      new Date("2026-10-31T07:00:00Z"),
      new Date("2026-11-15T08:00:00Z")
    );
    const days = (title: string) => airings.filter((a) => a.summary === title).map((a) => a.uid);
    expect(days("Planning Commission")).toEqual(["manual:2026-11-03@18:00", "manual:2026-11-04@18:00", "manual:2026-11-05@18:00", "manual:2026-11-06@18:00", "manual:2026-11-09@18:00", "manual:2026-11-10@18:00", "manual:2026-11-11@18:00", "manual:2026-11-12@18:00", "manual:2026-11-13@18:00"]);
    expect(days("Story time")).toEqual(["manual:2026-10-31@10:00", "manual:2026-11-07@10:00"]);
  });
});

describe("on the desk, the dial and the guide", () => {
  let h: Harness;
  let dee: User;
  let marketId: string;
  const ids: Record<string, string> = {};
  const SCHEDULE_PAGE = "https://lomalinda.example.gov/community-access/schedule";
  const manual = {
    source: "manual",
    slots: [
      { days: ["mon", "tue", "wed", "thu", "fri"], start: "18:00", end: "21:00", title: "Planning Commission", description: "Live from City Hall" },
      { days: ["sat"], start: "23:00", end: "03:00", title: "Overnight notices" },
      { days: ["sat"], start: "10:00", end: "11:00", title: "Story time", until: "2026-11-07" }
    ],
    checkedAgainst: SCHEDULE_PAGE,
    checkedOn: "2026-10-28",
    skipDates: ["2026-11-02"]
  };
  const airings = async (id: string) =>
    h.db.select().from(schema.listedAirings).where(eq(schema.listedAirings.listedSourceId, id)).orderBy(asc(schema.listedAirings.startsAt));
  const listing = async (id: string) => (await dee.get(`/v1/admin/listed-sources?marketId=${marketId}`).expect(200)).body.find((s: { id: string }) => s.id === id);
  const dialRow = async (callSign: string) => (await anon(h).get("/v1/markets/inland-empire/dial").expect(200)).body.rows.find((r: { station: { callSign: string } }) => r.station.callSign === callSign);
  const fakeFetch = (routes: Record<string, () => Response>) => (async (input: RequestInfo | URL) => {
    const route = routes[String(input)];
    if (!route) throw new TypeError("fetch failed");
    return route();
  }) as Fetch;

  beforeAll(async () => {
    h = await createHarness();
    // Thursday, October 29, noon in the Inland Empire: two weeks ahead crosses the clocks going back.
    h.clock.set("2026-10-29T19:00:00.000Z");
    dee = await h.signIn("Dee A.", { admin: true });
    marketId = (await market(h)).id;
  }, 60_000);
  afterAll(() => h.close());

  it("refuses a schedule without where it was checked, with times off the grid, or with two slots on at once", async () => {
    const base = { marketId, band: "tv", channel: "22.1", callSign: "LOMA", name: "Loma Linda Community Access", streamUrl: "https://lomalinda.example.gov/live/index.m3u8", plays: "stream_link", evidence: { publicBasis: "Public access channel" } };
    const { checkedAgainst: _, ...unchecked } = manual;
    await dee.post("/v1/admin/listed-sources", { ...base, schedule: unchecked }).expect(400);
    await dee.post("/v1/admin/listed-sources", { ...base, schedule: { ...manual, checkedOn: undefined } }).expect(400);
    const grid = await dee.post("/v1/admin/listed-sources", { ...base, schedule: { ...manual, slots: [{ ...manual.slots[0], start: "18:03" }] } }).expect(400);
    expect(grid.body.error.message).toContain("5-minute steps");
    const overlap = await dee.post("/v1/admin/listed-sources", { ...base, schedule: { ...manual, slots: [...manual.slots, { days: ["wed"], start: "20:00", end: "22:00", title: "School Board" }] } }).expect(400);
    expect(overlap.body.error).toMatchObject({ message: "“School Board” overlaps “Planning Commission” on Wednesdays at 8:00 pm. Two slots can't be on at once.", fields: { "slots.3.start": expect.any(String) } });
    // Not both ways at once.
    await dee.post("/v1/admin/listed-sources", { ...base, calendarUrl: SCHEDULE_PAGE, schedule: manual }).expect(400);
    expect(await h.db.select().from(schema.listedSources)).toEqual([]);
  });

  it("makes airings for the next 14 days at once, past midnight and across the clocks going back, skipping the dates it doesn't air", async () => {
    const res = await dee
      .post("/v1/admin/listed-sources", { marketId, band: "tv", channel: "22.1", callSign: "LOMA", name: "Loma Linda Community Access", streamUrl: "https://lomalinda.example.gov/live/index.m3u8", plays: "stream_link", evidence: { publicBasis: "Public access channel" }, schedule: manual })
      .expect(201);
    ids.LOMA = res.body.id;
    expect(res.body).toMatchObject({
      onDial: true,
      calendarSync: "synced",
      schedule: { source: "manual", format: null, url: null, checkedAgainst: SCHEDULE_PAGE, checkedOn: "2026-10-28", skipDates: ["2026-11-02"] },
      // Weekdays from Thursday Oct 29 to Wednesday Nov 11 less Monday Nov 2 (9), two Saturday nights and two story times.
      upcoming: 13
    });
    expect(res.body.schedule.slots[0]).toEqual({ days: ["mon", "tue", "wed", "thu", "fri"], start: "18:00", end: "21:00", title: "Planning Commission", description: "Live from City Hall", from: null, until: null });
    const rows = await airings(ids.LOMA);
    expect(rows.map((a) => a.startsAt.toISOString())).not.toContain("2026-11-03T02:00:00.000Z");
    expect(rows.find((a) => a.title === "Overnight notices" && a.startsAt.toISOString() === "2026-11-01T06:00:00.000Z")?.endsAt?.toISOString()).toBe("2026-11-01T11:00:00.000Z");
    expect(rows.find((a) => a.startsAt.toISOString() === "2026-11-04T02:00:00.000Z")?.title).toBe("Planning Commission");
    expect(rows.at(-1)!.startsAt.getTime()).toBeLessThan(Date.parse("2026-11-12T19:00:00Z"));
  });

  it("shows the titles and their times on the dial and in the guide, as a feed's are (guide data, to apps)", async () => {
    h.clock.set("2026-10-30T02:30:00.000Z"); // Thursday 7:30 pm
    const loma = await dialRow("LOMA");
    expect(loma).toMatchObject({
      onAir: true,
      now: { title: "Planning Commission", kind: "listed", startsAt: "2026-10-30T01:00:00.000Z", endsAt: "2026-10-30T04:00:00.000Z" },
      next: { title: "Planning Commission", startsAt: "2026-10-31T01:00:00.000Z" },
      external: { source: "Loma Linda Community Access", plays: "stream_link", schedule: "guide_data" }
    });
    const guide = await anon(h).get("/v1/markets/inland-empire/guide?from=2026-10-31T16:00:00.000Z&to=2026-11-01T12:00:00.000Z").expect(200);
    const row = guide.body.rows.find((r: { station: { callSign: string } }) => r.station.callSign === "LOMA");
    expect(row.airings.map((a: { title: string; startsAt: string }) => [a.title, a.startsAt])).toEqual([
      ["Story time", "2026-10-31T17:00:00.000Z"],
      ["Overnight notices", "2026-11-01T06:00:00.000Z"]
    ]);
  });

  it("records a change in the listing's history, who and when, from → to, and makes the airings again at once", async () => {
    // Saved while the commission is on: it keeps its title until it ends.
    const slots = [{ ...manual.slots[0], end: "20:30", title: "Planning Commission (live)" }, manual.slots[1]];
    const res = await dee.patch(`/v1/admin/listed-sources/${ids.LOMA}`, { schedule: { ...manual, slots, skipDates: ["2026-11-02", "2026-11-11"] } }).expect(200);
    expect(res.body.schedule.slots).toHaveLength(2);
    const [change] = (await dee.get(`/v1/admin/listed-sources/${ids.LOMA}/changes`).expect(200)).body;
    expect(change).toMatchObject({ by: "Dee A.", action: "changed", at: "2026-10-30T02:30:00.000Z", effects: ["schedule_reread"] });
    expect(change.fields).toEqual([
      {
        field: "manualSchedule",
        from: "Mon–Fri 6:00–9:00 pm: Planning Commission, “Live from City Hall”; Sat 10:00–11:00 am: Story time (until 2026-11-07); Sat 11:00 pm–3:00 am: Overnight notices",
        to: "Mon–Fri 6:00–8:30 pm: Planning Commission (live), “Live from City Hall”; Sat 11:00 pm–3:00 am: Overnight notices"
      },
      { field: "skipDates", from: "2026-11-02", to: "2026-11-02, 2026-11-11" }
    ]);
    expect((await dialRow("LOMA")).now).toMatchObject({ title: "Planning Commission", endsAt: "2026-10-30T04:00:00.000Z" });
    const rows = await airings(ids.LOMA);
    expect(rows.filter((a) => a.startsAt >= h.clock.now()).map((a) => a.title)).not.toContain("Story time");
    expect(rows.find((a) => a.startsAt.toISOString() === "2026-10-31T01:00:00.000Z")).toMatchObject({ title: "Planning Commission (live)", endsAt: new Date("2026-10-31T03:30:00Z") });
    expect(rows.map((a) => a.startsAt.toISOString())).not.toContain("2026-11-12T02:00:00.000Z");
    // Saving the same again changes nothing, and records nothing.
    await dee.patch(`/v1/admin/listed-sources/${ids.LOMA}`, { schedule: { ...manual, slots, skipDates: ["2026-11-11", "2026-11-02"] } }).expect(200);
    expect((await dee.get(`/v1/admin/listed-sources/${ids.LOMA}/changes`).expect(200)).body).toHaveLength(1);
  });

  it("adds the slot on now when nothing is, so the banner has it at once", async () => {
    // Saturday 11:30 pm: the overnight slot is on.
    h.clock.set("2026-11-01T06:30:00.000Z");
    await h.db.delete(schema.listedAirings).where(eq(schema.listedAirings.listedSourceId, ids.LOMA));
    await h.services.network.syncListedSource(ids.LOMA);
    expect((await dialRow("LOMA")).now).toMatchObject({ title: "Overnight notices", startsAt: "2026-11-01T06:00:00.000Z", endsAt: "2026-11-01T11:00:00.000Z" });
  });

  it("rolls the two weeks forward hourly", async () => {
    const before = (await airings(ids.LOMA)).at(-1)!.startsAt;
    h.clock.set("2026-11-03T19:00:00.000Z");
    const pass = await h.services.network.syncExternalSchedules({ fetch: fakeFetch({}) });
    expect(pass.synced).toBeGreaterThanOrEqual(1);
    const after = await airings(ids.LOMA);
    expect(after.at(-1)!.startsAt.getTime()).toBeGreaterThan(before.getTime());
    expect(after.at(-1)!.startsAt.getTime()).toBeLessThan(Date.parse("2026-11-17T20:00:00Z"));
    // Nothing doubled: one airing per start.
    const starts = after.map((a) => a.startsAt.toISOString());
    expect(new Set(starts).size).toBe(starts.length);
    expect((await listing(ids.LOMA)).lastSyncedAt).toBe("2026-11-03T19:00:00.000Z");
  });

  it("reads a webpage's event data on save and hourly; a page without any says so, isn't an error, and keeps what was listed", async () => {
    h.clock.set("2026-10-29T19:00:00.000Z");
    const EVENTS = "https://riverside.example.gov/library/events";
    const PLAIN = "https://riverside.example.gov/library/about";
    let html = page(JSON.stringify({
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: [
        { "@type": "ListItem", item: { "@type": "Event", name: "Author talk: Inland Empire stories", startDate: "2026-10-31T14:00:00", endDate: "2026-10-31T15:00:00" } },
        { "@type": "ListItem", item: { "@type": "Event", name: "Already over", startDate: "2026-10-01T14:00:00" } }
      ]
    }));
    const fn = fakeFetch({ [EVENTS]: () => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }), [PLAIN]: () => new Response("<!doctype html><html><body>Hours and directions</body></html>") });
    const res = await dee
      .post("/v1/admin/listed-sources", { marketId, band: "tv", channel: "24.1", callSign: "RVLB", name: "Riverside County Library Live", streamUrl: "https://riverside.example.gov/live/library/index.m3u8", plays: "stream_link", evidence: { publicBasis: "County library" } })
      .expect(201);
    ids.RVLB = res.body.id;
    const changed = await h.services.network.updateListedSource(null, ids.RVLB, { schedule: { source: "feed", calendarUrl: EVENTS, calendarFormat: "webpage" } }, fn);
    expect(changed).toMatchObject({ calendarSync: "synced", schedule: { source: "feed", format: "webpage", url: EVENTS }, upcoming: 1 });
    expect((await airings(ids.RVLB)).map((a) => [a.title, a.startsAt.toISOString(), a.endsAt?.toISOString()])).toEqual([["Author talk: Inland Empire stories", "2026-10-31T21:00:00.000Z", "2026-10-31T22:00:00.000Z"]]);

    // The page drops its event data: it says so, and what was listed stays.
    html = page(JSON.stringify({ "@type": "Library", name: "Riverside County Library" }));
    await h.services.network.syncExternalSchedules({ fetch: fn });
    const none = await listing(ids.RVLB);
    expect(none).toMatchObject({ calendarSync: "no_event_data", upcoming: 1, onDial: true, health: { state: "unchecked" } });

    // Worked out from the answer: a page with nothing on it.
    const plain = await h.services.network.updateListedSource(null, ids.RVLB, { schedule: { source: "feed", calendarUrl: PLAIN } }, fn);
    expect(plain).toMatchObject({ calendarSync: "no_event_data", schedule: { format: "webpage" } });
    expect(await h.db.select().from(schema.listedAirings).where(and(eq(schema.listedAirings.listedSourceId, ids.RVLB), gte(schema.listedAirings.startsAt, h.clock.now())))).toEqual([]);
  });
});
