// External stations on the desk mock (follow-up Phase 6), on the reference's Saturday, 8:42 pm: the
// six rows as drawn, the evidence rules (an embed's terms page, a stream link's permission or public
// basis), the channel rules, recording evidence once, a stream going down and coming back, and IPTV
// lists read into pipeline leads.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpHandler } from "msw";
import { networkApi } from "@opencast/contracts";
import { apiFor } from "../testApi";

const NOW = new Date("2026-09-27T03:42:12Z");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const IE = U(90001);
const RIALTO_LEAD = U(224);
const ICTV_LEAD = U(223);

let handlers: HttpHandler[];
let db: typeof import("../db");
let external: typeof import("../external");
let api: ReturnType<typeof apiFor>;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  db = await import("../db");
  external = await import("../external");
  handlers = (await import("./index")).handlers;
  api = apiFor(handlers);
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  localStorage.clear();
  db.resetDb();
});

const list = async () => networkApi.listListedSources.response.parse((await api("GET", "/admin/listed-sources", { query: { marketId: IE } })).json);
const byName = async (name: string) => (await list()).find((l) => l.name === name)!;
const base = { marketId: IE, band: "tv", name: "City of Rialto" };

describe("the reference's six rows", () => {
  it("says how each plays, where its schedule comes from, and whether it's on the dial", async () => {
    const rows = await list();
    expect(rows.map((r) => [r.station.callSign, r.plays, r.evidence?.basis ?? null, r.schedule?.source, r.onDial, r.waiting, r.health?.state])).toEqual([
      ["COLT", "stream_link", "written_permission", "feed", true, null, "up"],
      ["RDLS", "embed", "embed_terms", "feed", true, null, "up"],
      ["ICTV", "stream_link", null, "none", false, "needs_permission", "unchecked"],
      // A201: a DASH stream link on the dial (DASH stream links are played).
      ["LOMA", "stream_link", "public_source", "manual", true, null, "up"],
      ["NASA", "stream_link", "public_source", "guide_data", true, null, "up"],
      // A229: Riverside County's streams sharing RIVC on 15.
      ["RIVC", "stream_link", "public_source", "feed", true, null, "up"],
      ["RIVC", "stream_link", "public_source", "none", true, null, "up"],
      ["RUSD", "embed", null, "none", false, "terms_unclear", "unchecked"],
      ["SBCO", "embed", "embed_terms", "none", false, "down", "hidden"]
    ]);
    const sbco = rows.find((r) => r.station.callSign === "SBCO")!;
    expect(sbco).toMatchObject({ listingState: "listed", health: { since: "2026-09-27T03:28:00.000Z", detail: "HTTP 503" } });
    expect(sbco.outages).toHaveLength(2);
    expect((await byName("Inland Community TV")).creatorId).toBe(ICTV_LEAD);
    expect((await byName("Riverside Unified School District")).evidence?.note).toBe("Asked Sept 22");
  });

  it("lists an outage history, newest first", async () => {
    const sbco = await byName("San Bernardino County");
    const r = await api("GET", `/admin/listed-sources/${sbco.id}/outages`);
    expect(r.status).toBe(200);
    expect(r.json.map((o: { backAt: string | null }) => o.backAt)).toEqual([null, "2026-09-25T04:02:00.000Z"]);
  });
});

describe("listing a source", () => {
  it("puts a stream link with their written permission on the dial, and records the permission once", async () => {
    const permission = { grantedBy: "Maria Lopez, City Clerk", grantedOn: "2026-09-24", evidence: "Email to network@opencast.tv, Sept 24" };
    const r = await api("POST", "/admin/listed-sources", { body: { ...base, channel: "9.4", callSign: "RIAL", streamUrl: "https://rialto.example.gov/live.m3u8", plays: "stream_link", evidence: { permission } } });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ onDial: true, waiting: null, streamFormat: "hls", evidence: { basis: "written_permission", permission: { ...permission, streamUrl: "https://rialto.example.gov/live.m3u8", recordedBy: "Dee A." } } });
    const again = await api("POST", `/admin/listed-sources/${r.json.id}/evidence`, { body: { permission } });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("permission_recorded");
  });

  it("saves an embed without its terms page, and it waits", async () => {
    const r = await api("POST", "/admin/listed-sources", { body: { ...base, channel: "9.4", callSign: "RIAL", streamUrl: "https://rialto.example.gov/live", embedTerms: "allowed" } });
    expect(r.json).toMatchObject({ onDial: false, waiting: "needs_terms", listingState: "checking" });
    const unclear = await api("POST", "/admin/listed-sources", { body: { ...base, channel: "9.5", callSign: "FONT", streamUrl: "https://fontana.example.gov/live", embedTerms: "unclear" } });
    expect(unclear.json.waiting).toBe("terms_unclear");
    expect((await api("POST", "/admin/listed-sources", { body: { ...base, channel: "9.6", callSign: "UPLD", streamUrl: "https://upland.example.gov/live" } })).json.error.fields).toEqual({ embedTerms: "Required for an embed" });
  });

  it("holds a DASH stream and a source outside the market until Settings allows them", async () => {
    // A201: DASH stream links are played now; set back to not played, a DASH stream waits.
    const dashPlayed = await list();
    expect(dashPlayed.find((l) => l.station.callSign === "LOMA")).toMatchObject({ streamFormat: "dash", onDial: true, waiting: null });
    await api("POST", "/admin/rules/external.dash_stream_links/versions", { body: { value: { played: false }, effectiveFrom: "2026-09-27" } });
    const dash = await api("POST", "/admin/listed-sources", { body: { ...base, channel: "9.4", callSign: "RIAL", streamUrl: "https://rialto.example.gov/live.mpd", plays: "stream_link", evidence: { publicBasis: "Public body" } } });
    expect(dash.json).toMatchObject({ streamFormat: "dash", waiting: "dash_not_played" });
    const outside = await api("POST", "/admin/listed-sources", { body: { ...base, channel: "9.5", callSign: "LACO", streamUrl: "https://laco.example.gov/live.m3u8", plays: "stream_link", outsideMarket: true, evidence: { publicBasis: "County government, public" } } });
    expect(outside.json.waiting).toBe("other_market");
  });

  it("follows the channel and call sign rules, with subchannels only beside external stations", async () => {
    const s = (channel: string, callSign: string) => api("POST", "/admin/listed-sources", { body: { ...base, channel, callSign, streamUrl: "https://x.example.gov/live", embedTerms: "allowed" } });
    expect((await s("9.1", "ABCD")).json.error.code).toBe("channel_taken");
    expect((await s("12.2", "ABCD")).json.error.code).toBe("channel_taken");
    expect((await s("41.1", "ABCD")).json.error.code).toBe("channel_taken"); // the waitlist holds 41
    expect((await s("62.2", "ABCD")).json.error.fields).toEqual({ channel: "Use X.1" });
    expect((await s("61.2", "COLT")).json.error.code).toBe("call_sign_taken");
    expect((await s("61.2", "ABCD")).status).toBe(201);
  });

  it("wants written permission and a public basis on stream links only", async () => {
    const r = await api("POST", "/admin/listed-sources", { body: { ...base, channel: "9.4", callSign: "RIAL", streamUrl: "https://x.example.gov/live", embedTerms: "allowed", evidence: { publicBasis: "Public body" } } });
    expect(r.status).toBe(400);
    const rusd = await byName("Riverside Unified School District");
    expect((await api("POST", `/admin/listed-sources/${rusd.id}/evidence`, { body: { permission: { grantedBy: "The board", grantedOn: "2026-09-25", evidence: "A letter" } } })).status).toBe(400);
  });

  it("turns a lead into an external station, once", async () => {
    const body = { ...base, name: "Rialto Community Access", channel: "9.4", callSign: "RCAX", streamUrl: "https://rialto-access.example.net/hls/live.m3u8", plays: "stream_link", creatorId: RIALTO_LEAD };
    const r = await api("POST", "/admin/listed-sources", { body });
    expect(r.json).toMatchObject({ creatorId: RIALTO_LEAD, waiting: "needs_permission" });
    const lead = networkApi.listCreators.response.parse((await api("GET", "/admin/creators", { query: { marketId: IE } })).json).find((c) => c.id === RIALTO_LEAD)!;
    // Still Found while it waits for their permission; On air once it's recorded.
    expect(lead).toMatchObject({ stage: "found", listedSourceId: r.json.id, station: { callSign: "RCAX" } });
    expect((await api("POST", "/admin/listed-sources", { body: { ...body, channel: "9.5", callSign: "RCAY" } })).json.error.code).toBe("already_external");
    await api("POST", `/admin/listed-sources/${r.json.id}/evidence`, { body: { permission: { grantedBy: "Ana Ruiz, Rialto Community Access", grantedOn: "2026-09-26", evidence: "Email, Sept 26" } } });
    const after = networkApi.listCreators.response.parse((await api("GET", "/admin/creators", { query: { marketId: IE } })).json).find((c) => c.id === RIALTO_LEAD)!;
    expect(after.stage).toBe("on_air");
  });
});

describe("recording evidence", () => {
  it("puts a waiting embed on the dial once its terms allow embedding and the page is recorded", async () => {
    const rusd = await byName("Riverside Unified School District");
    const r = await api("POST", `/admin/listed-sources/${rusd.id}/evidence`, { body: { embedTerms: "allowed", termsUrl: "https://rusd.example.org/terms", termsCheckedOn: "2026-09-26", note: "" } });
    expect(r.json).toMatchObject({ onDial: true, waiting: null, evidence: { basis: "embed_terms", note: null } });
  });
});

describe("health", () => {
  it("hides a stream down 5 minutes and brings it back when it's up", async () => {
    external.deskExternalDown("COLT", 2);
    expect(await byName("City of Colton")).toMatchObject({ onDial: true, health: { state: "down" } });
    vi.setSystemTime(new Date(NOW.getTime() + 3 * 60_000));
    const hidden = await byName("City of Colton");
    expect(hidden).toMatchObject({ onDial: false, waiting: "down", health: { state: "hidden" } });
    expect(hidden.outages?.[0]).toMatchObject({ downSince: "2026-09-27T03:40:12.000Z", hiddenAt: "2026-09-27T03:45:12.000Z", backAt: null });
    expect(external.deskExternalUp("COLT")).toBe(true);
    expect(await byName("City of Colton")).toMatchObject({ onDial: true, health: { state: "up" } });
    expect(external.deskExternalDown("NOPE")).toBe(false);
  });

  it("checks a new listing a minute after it's added", async () => {
    const r = await api("POST", "/admin/listed-sources", { body: { ...base, channel: "9.4", callSign: "RIAL", streamUrl: "https://rialto.example.gov/live.m3u8", plays: "stream_link", evidence: { publicBasis: "Public body" } } });
    expect(r.json.health.state).toBe("unchecked");
    vi.setSystemTime(new Date(NOW.getTime() + 61_000));
    expect((await byName("City of Rialto")).health?.state).toBe("up");
  });
});

describe("IPTV lists", () => {
  const M3U = `#EXTM3U
#EXTINF:-1 tvg-id="Fontana.us" tvg-country="US" group-title="Public",Fontana Public Access
https://fontana-access.example.net/live/playlist.m3u8
#EXTINF:-1 group-title="General",Inland Community TV
https://ictv.example.net/live/index.m3u8
#EXTINF:-1,No address
`;

  it("reads a pasted list, and says which channels are already on the desk", async () => {
    const r = await api("POST", "/admin/creators/iptv/preview", { body: { m3u: M3U } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ listUrl: null, skipped: 1 });
    expect(r.json.channels.map((c: { name: string; already: string | null; group: string | null }) => [c.name, c.group, c.already])).toEqual([
      ["Fontana Public Access", "Public", null],
      ["Inland Community TV", "General", "external"]
    ]);
  });

  it("reads iptv-org addresses only, and never fetches on the mocks", async () => {
    expect((await api("POST", "/admin/creators/iptv/preview", { body: { url: "https://lists.example.com/us.m3u" } })).json.error.fields).toEqual({ url: "iptv-org lists only" });
    const r = await api("POST", "/admin/creators/iptv/preview", { body: { url: "https://iptv-org.github.io/iptv/countries/us.m3u" } });
    expect(r.json.channels.find((c: { name: string }) => c.name === "Rialto Community Access").already).toBe("lead");
    expect((await api("POST", "/admin/creators/iptv/preview", { body: { m3u: "#EXTM3U\n" } })).json.error.code).toBe("no_channels");
  });

  it("imports channels as leads, skipping the ones already on the desk", async () => {
    const preview = (await api("POST", "/admin/creators/iptv/preview", { body: { m3u: M3U } })).json;
    const channels = preview.channels.map(({ already: _a, ...c }: { already: unknown }) => c);
    const r = await api("POST", "/admin/creators/iptv/import", { body: { marketId: IE, channels } });
    expect(r.status).toBe(201);
    expect(r.json.skipped).toBe(1);
    expect(r.json.imported).toHaveLength(1);
    expect(r.json.imported[0]).toMatchObject({ displayName: "Fontana Public Access", stage: "found", sourcePlatform: "other", nextAction: "Ask for permission, or confirm it's public", lead: { from: "iptv_list", streamUrl: "https://fontana-access.example.net/live/playlist.m3u8", group: "Public" } });
    expect((await api("POST", "/admin/creators/iptv/preview", { body: { m3u: M3U } })).json.channels[0].already).toBe("lead");
  });
});

// ---- A241 (2026-10-01): a webpage's event data, and a schedule entered by hand ----
describe("what's on: a webpage, or by hand", () => {
  const listing = { ...base, channel: "9.4", callSign: "RIAL", streamUrl: "https://rialto.example.gov/live.m3u8", plays: "stream_link", evidence: { publicBasis: "Public body" } };
  const manual = {
    source: "manual",
    slots: [
      { days: ["mon", "tue", "wed", "thu", "fri"], start: "18:00", end: "21:00", title: "City Council" },
      { days: ["sat"], start: "23:00", end: "01:00", title: "After hours" }
    ],
    checkedAgainst: "https://rialto.example.gov/schedule",
    checkedOn: "2026-09-25",
    skipDates: ["2026-10-05"]
  };

  it("lists a schedule entered by hand, counted for the next 14 days, and refuses two slots on at once", async () => {
    const overlap = await api("POST", "/admin/listed-sources", { body: { ...listing, schedule: { ...manual, slots: [...manual.slots, { days: ["wed"], start: "20:00", end: "22:00", title: "Planning" }] } } });
    expect(overlap.status).toBe(400);
    expect(overlap.json.error).toMatchObject({ message: "“Planning” overlaps “City Council” on Wednesdays at 8:00 pm. Two slots can't be on at once.", fields: { "slots.2.start": expect.any(String) } });
    const unchecked = await api("POST", "/admin/listed-sources", { body: { ...listing, schedule: { ...manual, checkedAgainst: undefined } } });
    expect(unchecked.status).toBe(400);
    const ok = await api("POST", "/admin/listed-sources", { body: { ...listing, schedule: manual } });
    expect(ok.status).toBe(201);
    // Weekdays Sept 28 to Oct 9 less Oct 5 (9), and Saturday nights Sept 26 and Oct 3 (2).
    expect(ok.json).toMatchObject({ calendarSync: "synced", upcoming: 11, schedule: { source: "manual", checkedAgainst: "https://rialto.example.gov/schedule", skipDates: ["2026-10-05"] } });
    expect(ok.json.schedule.slots[1]).toEqual({ days: ["sat"], start: "23:00", end: "01:00", title: "After hours", description: null, from: null, until: null });
  });

  it("reads a webpage's event data, and says when a page has none", async () => {
    const events = await api("POST", "/admin/listed-sources", { body: { ...listing, schedule: { source: "feed", calendarUrl: "https://rialto.example.gov/events" } } });
    expect(events.json).toMatchObject({ calendarSync: "synced", schedule: { source: "feed", format: "webpage" } });
    const page = await api("PATCH", `/admin/listed-sources/${events.json.id}`, { body: { schedule: { source: "feed", calendarUrl: "https://rialto.example.gov/council.html" } } });
    expect(page.json).toMatchObject({ calendarSync: "no_event_data", schedule: { format: "webpage" }, onDial: true });
  });
});
