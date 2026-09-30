// A229 to A231 on the desk mock: one brand's streams sharing a call sign on one channel's
// subchannels (15.1 RIVC, 15.2 RIVC, 15.3 RIVC), as the API has it. "Same brand as 15.1" only on
// X.n beside an external X.1; a family's call sign changes on X.1 for all of them; taking X.1 off
// the dial takes its family, only when the desk says so, and "Put back" brings them back together.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpHandler } from "msw";
import { networkApi, stationsApi } from "@opencast/contracts";
import { apiFor } from "../testApi";

const NOW = new Date("2026-09-27T03:42:12Z");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const IE = U(90001);
const PUBLIC = { publicBasis: "County government, stream published for the public" };

let handlers: HttpHandler[];
let db: typeof import("../db");
let api: ReturnType<typeof apiFor>;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  db = await import("../db");
  handlers = (await import("../../../mocks/handlers")).handlers;
  api = apiFor(handlers);
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  localStorage.clear();
  db.resetDb();
});

const list = async (show?: "removed") => networkApi.listListedSources.response.parse((await api("GET", "/admin/listed-sources", { query: { marketId: IE, ...(show ? { show } : {}) } })).json);
const byName = async (name: string, show?: "removed") => (await list(show)).find((l) => l.name === name)!;
const add = (body: object) => api("POST", "/admin/listed-sources", { body: { marketId: IE, band: "tv", plays: "stream_link", evidence: PUBLIC, ...body } });
const addWorks = () => add({ channel: "15.2", shareCallSign: true, name: "Riverside County, Public Works", streamUrl: "https://riverside.example.gov/live/works/index.m3u8" });

describe("listing the same brand", () => {
  it("shares 15.1 RIVC's call sign on 15.2, with its own address", async () => {
    const r = await addWorks();
    expect(r.status).toBe(201);
    const works = networkApi.addListedSource.response.parse(r.json);
    expect(works.station).toMatchObject({ callSign: "RIVC", channel: "15.2", slug: "rivc-15-2", sharesCallSign: true });
    expect(works.family).toMatchObject({ role: "member", head: { channel: "15.1", slug: "rivc" } });
    const head = await byName("Riverside County, Board of Supervisors");
    expect(head.station).toMatchObject({ slug: "rivc", sharesCallSign: true });
    expect(head.family?.members.map((m) => m.channel)).toEqual(["15.2", "15.3"]);
  });

  it("is refused on X.1, beside a full station, and a shared call sign is taken for anyone else", async () => {
    expect((await add({ channel: "16.1", shareCallSign: true, name: "X", streamUrl: "https://x.example.gov/a.m3u8" })).status).toBe(422);
    expect((await add({ channel: "12.2", shareCallSign: true, name: "X", streamUrl: "https://x.example.gov/b.m3u8" })).status).toBe(409);
    const own = await add({ channel: "15.4", callSign: "RIVC", name: "X", streamUrl: "https://x.example.gov/c.m3u8" });
    expect(own.status).toBe(409);
  });
});

describe("the family's call sign", () => {
  it("changes on X.1 for all of them, each history saying so", async () => {
    await addWorks();
    const head = await byName("Riverside County, Board of Supervisors");
    const r = await api("PATCH", `/admin/listed-sources/${head.id}`, { body: { callSign: "RVCO" } });
    expect(r.status).toBe(200);
    const rows = (await list()).filter((l) => l.station.callSign === "RVCO").map((l) => l.station.slug);
    expect(rows.sort()).toEqual(["rvco", "rvco-15-2", "rvco-15-3"]);
    const lib = await byName("Riverside County Library Live");
    const history = (await api("GET", `/admin/listed-sources/${lib.id}/changes`)).json;
    expect(history[0]).toMatchObject({ action: "changed", fields: [{ field: "callSign", from: "RIVC", to: "RVCO" }] });
  });

  it("keeps X.1 put, and lets a member leave with a call sign of its own", async () => {
    const head = await byName("Riverside County, Board of Supervisors");
    expect((await api("PATCH", `/admin/listed-sources/${head.id}`, { body: { channel: "16.1" } })).status).toBe(409);
    const lib = await byName("Riverside County Library Live");
    expect((await api("PATCH", `/admin/listed-sources/${lib.id}`, { body: { shareCallSign: false } })).status).toBe(400);
    const left = networkApi.updateListedSource.response.parse((await api("PATCH", `/admin/listed-sources/${lib.id}`, { body: { callSign: "RVLB", shareCallSign: false } })).json);
    expect(left.station).toMatchObject({ callSign: "RVLB", slug: "rvlb" });
    expect(left.family).toBeNull();
  });
});

describe("taking the family off the dial", () => {
  it("names them first, takes them together, and puts them back together", async () => {
    await addWorks();
    const head = await byName("Riverside County, Board of Supervisors");
    const slugs = async () => stationsApi.getDial.response.parse((await api("GET", "/markets/inland-empire/dial", { as: null })).json).rows.map((r) => r.station.slug);
    expect(await slugs()).toEqual(expect.arrayContaining(["rivc", "rivc-15-2", "rivc-15-3"]));
    const refused = await api("POST", `/admin/listed-sources/${head.id}/remove`);
    expect(refused.status).toBe(409);
    expect(refused.json.error.message).toContain("15.2 RIVC, 15.3 RIVC");
    expect((await api("POST", `/admin/listed-sources/${head.id}/remove`, { body: { withFamily: true } })).status).toBe(200);
    const gone = await list("removed");
    expect(gone.filter((l) => l.station.callSign === "RIVC").map((l) => [l.removed?.channel, l.removed?.withListing ?? null])).toEqual(
      expect.arrayContaining([["15.1", null], ["15.2", head.id], ["15.3", head.id]])
    );
    // The viewer's mock dial follows (by address).
    const dial = await slugs();
    expect(dial).not.toContain("rivc-15-2");
    expect(dial).not.toContain("rivc");
    const works = gone.find((l) => l.name === "Riverside County, Public Works")!;
    expect((await api("POST", `/admin/listed-sources/${works.id}/restore`, { body: {} })).status).toBe(409);
    expect((await api("POST", `/admin/listed-sources/${head.id}/restore`, { body: {} })).status).toBe(200);
    expect((await list()).filter((l) => l.station.callSign === "RIVC").map((l) => l.station.channel).sort()).toEqual(["15.1", "15.2", "15.3"]);
  });
});
