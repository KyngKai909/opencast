// A215 on the desk mock (follow-up Phase 6), on the reference's Saturday, 8:42 pm: changing a
// listing never puts it on the dial without evidence that covers what now plays (the API's rules),
// every change is kept, and a listing taken off the dial for good is archived, reaches the viewer's
// mock dial, and can be put back.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpHandler } from "msw";
import { networkApi, stationsApi } from "@opencast/contracts";
import { apiFor } from "../testApi";

const NOW = new Date("2026-09-27T03:42:12Z");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const IE = U(90001);
const COLT_URL = "https://colton.example.gov/live/council.m3u8";
const COLT_NEW = "https://stream.colton.example.gov/council/index.m3u8";

let handlers: HttpHandler[];
let db: typeof import("../db");
let api: ReturnType<typeof apiFor>;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  db = await import("../db");
  // The whole app's mocks: the desk's and the viewer's, as `npm run dev:mock` has them.
  handlers = (await import("../../../mocks/handlers")).handlers;
  api = apiFor(handlers);
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  localStorage.clear();
  db.resetDb();
});

const list = async (show?: "removed") => networkApi.listListedSources.response.parse((await api("GET", "/admin/listed-sources", { query: { marketId: IE, ...(show ? { show } : {}) } })).json);
const byCall = async (cs: string, show?: "removed") => (await list(show)).find((l) => l.station.callSign === cs)!;
const patch = (id: string, body: object, as?: string) => api("PATCH", `/admin/listed-sources/${id}`, { body, as });
const viewerDial = async () => stationsApi.getDial.response.parse((await api("GET", "/markets/inland-empire/dial", { as: null })).json).rows.map((r) => r.station.callSign);

describe("changing a listing", () => {
  it("makes COLT wait for new evidence when its address changes, keeps the old permission, and puts it back once it's recorded", async () => {
    const colt = await byCall("COLT");
    const r = await patch(colt.id, { streamUrl: COLT_NEW });
    expect(r.status).toBe(200);
    expect(networkApi.updateListedSource.response.parse(r.json)).toMatchObject({ streamUrl: COLT_NEW, onDial: false, waiting: "needs_permission", evidence: { basis: null, permission: null }, health: { state: "unchecked" } });
    expect(r.json.earlierPermissions).toEqual([expect.objectContaining({ grantedBy: "Maria Lopez, City Clerk, City of Colton", streamUrl: COLT_URL })]);
    // The viewer's mock dial follows.
    expect(await viewerDial()).not.toContain("COLT");

    const yes = await api("POST", `/admin/listed-sources/${colt.id}/evidence`, { body: { permission: { grantedBy: "Maria Lopez, City Clerk, City of Colton", grantedOn: "2026-09-26", evidence: "Email to network@opencast.tv, Sept 26" } } });
    expect(yes.json).toMatchObject({ onDial: true, evidence: { basis: "written_permission", permission: { streamUrl: COLT_NEW } } });
    expect(await viewerDial()).toContain("COLT");
    const changes = networkApi.listListedChanges.response.parse((await api("GET", `/admin/listed-sources/${colt.id}/changes`)).json);
    expect(changes).toEqual([expect.objectContaining({ by: "Dee A.", action: "changed", fields: [{ field: "streamUrl", from: COLT_URL, to: COLT_NEW }], effects: ["waits_for_evidence", "checks_restart"] })]);
    // Someone on the desk who isn't an admin sees each address as its host.
    const lee = (await api("GET", `/admin/listed-sources/${colt.id}/changes`, { as: "lee@opencast.example" })).json;
    expect(lee[0].fields).toEqual([{ field: "streamUrl", from: "https://colton.example.gov/…", to: "https://stream.colton.example.gov/…" }]);
    expect((await patch(colt.id, { name: "Nope" }, "lee@opencast.example")).status).toBe(403);
  });

  it("keeps embed terms on the same host, waits on another, keeps a public basis, and needs the new kind's evidence", async () => {
    const rdls = await byCall("RDLS");
    expect((await patch(rdls.id, { streamUrl: "https://redlands.example.gov/meetings/live?v=2" })).json).toMatchObject({ onDial: true, evidence: { termsCheckedOn: "2026-09-21" } });
    expect((await patch(rdls.id, { streamUrl: "https://video.example-host.com/redlands" })).json).toMatchObject({ onDial: false, waiting: "needs_terms", evidence: { termsCheckedOn: null } });
    const nasa = await byCall("NASA");
    expect((await patch(nasa.id, { streamUrl: "https://nasa.example.gov/live/v2.m3u8" })).json).toMatchObject({ onDial: true, evidence: { basis: "public_source" } });
    expect((await patch(nasa.id, { plays: "embed" })).status).toBe(400);
    expect((await patch(nasa.id, { plays: "embed", embedTerms: "allowed" })).json).toMatchObject({ onDial: false, waiting: "needs_terms", evidence: { publicBasis: null } });
  });

  it("starts health afresh on a new address, ending the old one's outage", async () => {
    const sbco = await byCall("SBCO");
    expect(sbco).toMatchObject({ waiting: "down", health: { state: "hidden" } });
    const r = await patch(sbco.id, { streamUrl: "https://sanbernardino.example.gov/live2" });
    expect(r.json).toMatchObject({ onDial: true, waiting: null, health: { state: "unchecked" } });
    expect(r.json.outages[0]).toMatchObject({ downSince: "2026-09-27T03:28:00.000Z", backAt: NOW.toISOString(), ended: "address_changed" });
  });

  it("changes the channel and call sign by the listing rules, and holds the old call sign", async () => {
    const colt = await byCall("COLT");
    expect((await patch(colt.id, { channel: "12.2" })).json.error.code).toBe("channel_taken");
    const r = await patch(colt.id, { channel: "9.5", callSign: "CLTN" });
    expect(r.json.station).toMatchObject({ channel: "9.5", callSign: "CLTN" });
    const other = await api("POST", "/admin/listed-sources", { body: { marketId: IE, band: "tv", channel: "9.6", callSign: "COLT", name: "Someone", streamUrl: "https://x.example.gov/a.m3u8", plays: "stream_link" } });
    expect(other.json.error.code).toBe("call_sign_taken");
    expect((await patch(colt.id, { channel: "9.2", callSign: "COLT" })).json.station).toMatchObject({ channel: "9.2", callSign: "COLT" });
  });
});

describe("taking a listing off for good", () => {
  it("takes RDLS off the dial (the viewer's too), keeps everything, lists it under removed, and puts it back", async () => {
    const rdls = await byCall("RDLS");
    const before = db.getDb().listed.find((l) => l.id === rdls.id)!;
    const outages = before.outages.length;
    const r = await api("POST", `/admin/listed-sources/${rdls.id}/remove`);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ listingState: "not_listed", onDial: false, removed: { by: "Dee A.", channel: "9.1", channelHeldUntil: "2026-12-26T03:42:12.000Z" } });
    expect((await list()).map((l) => l.station.callSign)).not.toContain("RDLS");
    expect((await list("removed")).map((l) => l.station.callSign)).toEqual(["RDLS"]);
    expect(db.getDb().listed.find((l) => l.id === rdls.id)!.outages).toHaveLength(outages);
    // The viewer: off the dial, and its page says it's gone.
    expect(await viewerDial()).not.toContain("RDLS");
    const page = await api("GET", "/stations/rdls", { as: null });
    expect(page.status).toBe(404);
    expect(page.json.error.message).toMatch(/is no longer on the dial\.$/);
    // Its number is held, and nothing more can change it until it's back.
    expect((await api("POST", "/admin/listed-sources", { body: { marketId: IE, band: "tv", channel: "9.1", callSign: "SOME", name: "Someone", streamUrl: "https://x.example.gov/a.m3u8", plays: "stream_link" } })).json.error.code).toBe("channel_taken");
    expect((await patch(rdls.id, { name: "Nope" })).json.error.code).toBe("removed");
    expect((await api("POST", `/admin/listed-sources/${rdls.id}/remove`)).json.error.code).toBe("removed");

    const back = await api("POST", `/admin/listed-sources/${rdls.id}/restore`, { body: {} });
    expect(back.json).toMatchObject({ removed: null, listingState: "listed", onDial: true, station: { channel: "9.1" }, health: { state: "unchecked" } });
    expect(await viewerDial()).toContain("RDLS");
    const changes = (await api("GET", `/admin/listed-sources/${rdls.id}/changes`)).json;
    expect(changes.map((c: { action: string }) => c.action)).toEqual(["restored", "removed"]);
  });

  it("sends a lead back to Found, a lead again", async () => {
    const ictv = await byCall("ICTV");
    // Public, so it's on the dial and its lead is On air.
    await api("POST", `/admin/listed-sources/${ictv.id}/evidence`, { body: { publicBasis: "Public access channel" } });
    const lead = () => db.getDb().creators.find((c) => c.id === ictv.creatorId)!;
    expect(lead().stage).toBe("on_air");
    await api("POST", `/admin/listed-sources/${ictv.id}/remove`);
    expect(lead()).toMatchObject({ stage: "found", stationId: null, listedSourceId: null, nextAction: "Was external station ICTV. Taken off the dial" });
  });
});
