// @vitest-environment node
// Live and programming on the mocks: live sources and their keys, hosts, speakers, the lower
// third, ending early, listings, and the library's rights, uploads and guarded deletes.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { getDb, resetDb } from "../db";
import { MOCK_TOKEN_PREFIX } from "../../auth/mockToken";
import { LIVE_SOURCE_IDS } from "../fixtures/evening";
import { PROGRAM_IDS } from "../fixtures/library";
import { LIVE_ENTRY_IDS, listingStatus, resetLive } from "../fixtures/live";
import { BEAT } from "../fixtures/stations";
import { handlers } from "./index";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  resetLive();
});

async function api(path: string, init: { method?: string; body?: unknown; as?: string; form?: FormData } = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${MOCK_TOKEN_PREFIX}${init.as ?? "kai"}@example.com` };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`http://localhost/v1${path}`, { method: init.method ?? "GET", headers, body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)) });
  return { status: res.status, body: await res.json() };
}

const S = `/stations/${BEAT.id}`;

describe("live sources", () => {
  it("lists Studio A and the browser as 01.1 draws them", async () => {
    const r = await api(`${S}/live-sources`);
    expect(r.status).toBe(200);
    expect(r.body.map((x: { name: string }) => x.name)).toEqual(["Studio A", "Browser"]);
    expect(r.body[0]).toMatchObject({ server: "rtmps://ingest.useopencast.org/live", streamKeyPreview: "beat-studio-a-········", signal: "receiving", quality: "1080p" });
  });

  it("shows a new encoder's key once, masks it after, and resets it", async () => {
    const made = await api(`${S}/live-sources`, { method: "POST", body: { kind: "encoder", name: "Studio B" } });
    expect(made.status).toBe(201);
    expect(made.body.streamKey).toMatch(/^beat-studio-b-[a-z0-9]{12}$/);
    const listed = (await api(`${S}/live-sources`)).body.find((x: { id: string }) => x.id === made.body.source.id);
    expect(listed.streamKeyPreview).toBe("beat-studio-b-········");
    expect(JSON.stringify(listed)).not.toContain(made.body.streamKey);
    const reset = await api(`${S}/live-sources/${made.body.source.id}/reset-key`, { method: "POST" });
    expect(reset.body.streamKey).not.toBe(made.body.streamKey);
  });

  it("has one browser source, and won't remove a source a block still uses", async () => {
    expect((await api(`${S}/live-sources`, { method: "POST", body: { kind: "browser", name: "Another" } })).status).toBe(409);
    const refused = await api(`${S}/live-sources/${LIVE_SOURCE_IDS.studioA}`, { method: "DELETE" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/^It feeds \d live blocks?\./);
    const made = await api(`${S}/live-sources`, { method: "POST", body: { kind: "encoder", name: "Van" } });
    expect((await api(`${S}/live-sources/${made.body.source.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("hides the server and key from a host, and keeps hosts out of setup", async () => {
    const r = await api(`${S}/live-sources`, { as: "jen" });
    expect(r.body[0]).toMatchObject({ server: null, streamKeyPreview: null });
    expect((await api(`${S}/live-sources`, { method: "POST", as: "jen", body: { kind: "encoder", name: "Mine" } })).status).toBe(403);
  });
});

describe("hosts", () => {
  it("reads back who hosts each live program, and a host sees only their own", async () => {
    const all = await api(`${S}/hosts`);
    const byTitle = Object.fromEntries(all.body.programs.map((p: { title: string; hosts: { displayName: string }[] }) => [p.title, p.hosts.map((h) => h.displayName)]));
    expect(byTitle).toEqual({ "Crate Talk": ["Marcus Reyes"], "Beat Tape Live": ["Jen Park"] });
    expect((await api(`${S}/hosts`, { as: "jen" })).body.programs.map((p: { title: string }) => p.title)).toEqual(["Beat Tape Live"]);
  });

  it("sets the hosts of a live program from the team", async () => {
    const jen = getDb().members.find((m) => m.hosts === "Beat Tape Live")!.personId;
    expect((await api(`${S}/programs/${PROGRAM_IDS.crateTalk}/hosts`, { method: "PUT", body: { userIds: [jen] } })).status).toBe(200);
    const after = await api(`${S}/hosts`, { as: "jen" });
    expect(after.body.programs.map((p: { title: string }) => p.title).sort()).toEqual(["Beat Tape Live", "Crate Talk"]);
    expect((await api(`${S}/programs/${PROGRAM_IDS.lateCrate}/hosts`, { method: "PUT", body: { userIds: [] } })).status).toBe(409);
    expect((await api(`${S}/programs/${PROGRAM_IDS.crateTalk}/hosts`, { method: "PUT", body: { userIds: [crypto.randomUUID()] } })).status).toBe(400);
  });
});

describe("going live", () => {
  const block = `${S}/log/${LIVE_ENTRY_IDS.crateTalkSunday}`;

  it("puts Crate Talk on BEAT's log tomorrow, 7:00 to 8:00 pm, from the browser source", async () => {
    await api(`${S}/live-sources`);
    const e = getDb().log.find((x) => x.id === LIVE_ENTRY_IDS.crateTalkSunday)!;
    expect(e).toMatchObject({ kind: "live", title: "Crate Talk", liveSourceId: LIVE_SOURCE_IDS.browser, programId: PROGRAM_IDS.crateTalk });
    expect(Date.parse(e.endsAt) - Date.parse(e.startsAt)).toBe(3600e3);
    // Nothing else on BEAT's log overlaps it.
    const others = getDb().log.filter((x) => x.stationId === BEAT.id && x.id !== e.id && x.startsAt < e.endsAt && x.endsAt > e.startsAt);
    expect(others).toEqual([]);
  });

  it("keeps the speaker list, and lets only the block's host or the station change it", async () => {
    const list = await api(`/programs/${PROGRAM_IDS.crateTalk}/speakers`, { as: "marcus" });
    expect(list.body.map((x: { name: string }) => x.name)).toEqual(["Marcus Reyes", "Rosa Vega"]);
    const next = await api(`/programs/${PROGRAM_IDS.crateTalk}/speakers`, { method: "PUT", as: "marcus", body: [...list.body.map((x: { name: string; title: string | null }) => ({ name: x.name, title: x.title })), { name: "Luis Ortega", title: "Resident, Ward 2" }] });
    expect(next.body).toHaveLength(3);
    expect(next.body[0].id).toBe(list.body[0].id);
    expect((await api(`/programs/${PROGRAM_IDS.crateTalk}/speakers`, { as: "jen" })).status).toBe(403);
  });

  it("starts the lower third on the first speaker, and keeps what's shown", async () => {
    await api(`${S}/live-sources`);
    const first = await api(`${block}/lower-third`, { as: "marcus" });
    expect(first.body).toMatchObject({ hidden: false, name: "Marcus Reyes", title: "Host, Crate Talk" });
    const hidden = await api(`${block}/lower-third`, { method: "PUT", as: "marcus", body: { hidden: true, speakerId: null, name: "Rosa Vega", title: null } });
    expect(hidden.body.hidden).toBe(true);
    expect((await api(`${block}/lower-third`)).body.name).toBe("Rosa Vega");
    expect((await api(`${block}/lower-third`, { as: "jen" })).status).toBe(403);
  });

  it("ends early only while on air", async () => {
    await api(`${S}/live-sources`);
    const r = await api(`${block}/end-early`, { method: "POST", as: "marcus" });
    expect(r.status).toBe(409);
    expect((await api(`${block}/live`, { as: "marcus" })).body.endedEarlyAt).toBeNull();
  });
});

describe("listings", () => {
  it("flags the two airings the frame flags this week", async () => {
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 7 * 86400e3).toISOString();
    const r = await api(`${S}/listings?from=${from}&to=${to}`);
    expect(r.status).toBe(200);
    const need = r.body.listings.filter((l: { status: string }) => l.status === "needs_description").map((l: { title: string }) => l.title);
    expect(need).toEqual(expect.arrayContaining(["Crate Session 03", "Late Crate, ep. 16"]));
    expect(r.body.listings.find((l: { title: string }) => l.title === "Slow Hours")?.status).toBe("from_the_maker");
  });

  it("gives an airing its own description, and keeps the maker's words for carried programs", async () => {
    await api(`${S}/live-sources`);
    const e16 = await api(`${S}/listings/${LIVE_ENTRY_IDS.lateCrate16}`, { method: "PATCH", body: { episodeDescription: "A crate of Riverside funk." } });
    expect(e16.body.status).toBe("complete");
    const reel = getDb().log.find((x) => x.carriedFrom)!;
    expect((await api(`${S}/listings/${reel.id}`, { method: "PATCH", body: { episodeDescription: "Mine now" } })).status).toBe(409);
    expect((await api(`${S}/listings/${reel.id}`, { method: "PATCH", body: { localNote: "Our favourite" } })).body.localNote).toBe("Our favourite");
    expect((await api(`${S}/listings/${LIVE_ENTRY_IDS.lateCrate16}`, { method: "PATCH", body: { episodeDescription: "x".repeat(161) } })).status).toBe(400);
  });

  it("reads a listing's status by the frame's rules", () => {
    const base = { carried: false, ownDescription: null, live: false, episode: false, imported: false, programDescription: "A series." };
    expect(listingStatus({ ...base, carried: true })).toBe("from_the_maker");
    expect(listingStatus({ ...base, ownDescription: "Its own." })).toBe("complete");
    expect(listingStatus({ ...base, episode: true })).toBe("needs_description");
    expect(listingStatus({ ...base, imported: true })).toBe("needs_description");
    expect(listingStatus({ ...base, live: true, episode: false })).toBe("complete");
    expect(listingStatus({ ...base, programDescription: null })).toBe("needs_description");
  });
});

describe("the library", () => {
  it("counts what needs attention and marks the programs whose listings need a description", async () => {
    const r = await api(`${S}/library`);
    expect(r.body.items).toHaveLength(31);
    expect(r.body.needsAttention).toEqual({ rightsToConfirm: 1, preparing: 0 });
    expect(r.body.importedFromLinks).toBe(1);
    const needs = r.body.programs.filter((p: { listingStatus: string }) => p.listingStatus === "needs_description").map((p: { title: string }) => p.title).sort();
    expect(needs).toEqual(["Crate Session", "Late Crate"]);
    expect((await api(`${S}/library`, { as: "jen" })).status).toBe(403);
  });

  it("confirms rights with one of three answers", async () => {
    const cs3 = getDb().library.items.find((i) => i.title === "Crate Session 03")!;
    expect((await api(`/library/${cs3.id}/rights`, { method: "POST", body: { basis: "agreed" } })).status).toBe(400);
    const r = await api(`/library/${cs3.id}/rights`, { method: "POST", body: { basis: "public_domain" } });
    expect(r.body.rights).toMatchObject({ basis: "public_domain", confirmedBy: "Kai M." });
    expect(r.body.offerable).toBe(false);
  });

  it("won't delete an item that's in use, and says what uses it", async () => {
    const ep15 = getDb().library.items.find((i) => i.title === "Late Crate, ep. 15")!;
    const r = await api(`/library/${ep15.id}`, { method: "DELETE" });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe("It's in 2 log entries and carried by 2 stations. Take it out of those first.");
    const unused = getDb().library.items.find((i) => i.title === "Redlands Hardware, underwriting")!;
    expect((await api(`/library/${unused.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("exports to IPFS for owners only", async () => {
    const ep15 = getDb().library.items.find((i) => i.title === "Late Crate, ep. 15")!;
    expect((await api(`/library/${ep15.id}/export-ipfs`, { method: "POST", as: "marcus", body: { understandPublicAndPermanent: true } })).status).toBe(403);
    const r = await api(`/library/${ep15.id}/export-ipfs`, { method: "POST", body: { understandPublicAndPermanent: true } });
    expect(r.status).toBe(200);
    expect(r.body.url).toMatch(/^https:\/\/ipfs\.io\/ipfs\//);
  });

  it("takes an upload and prepares it for air, rights to confirm", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(1024)], "beat-tape-live-sting.mp4", { type: "video/mp4" }));
    const r = await api(`${S}/library/uploads`, { method: "POST", form });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ title: "Beat tape live sting", code: "BMP", status: "preparing", rights: null });
    const bad = new FormData();
    bad.set("file", new File(["x"], "notes.txt", { type: "text/plain" }));
    expect((await api(`${S}/library/uploads`, { method: "POST", form: bad })).status).toBe(415);
  });

  it("imports from a link: local only, never offerable", async () => {
    const r = await api(`${S}/library/imports`, { method: "POST", body: { urls: ["https://archive.org/details/crate-session-04"] } });
    expect(r.status).toBe(202);
    const job = await api(`${S}/library/imports/${r.body.id}`);
    expect(job.body.items[0].assetId).toBeTruthy();
    const item = getDb().library.items.find((i) => i.id === job.body.items[0].assetId)!;
    expect(item).toMatchObject({ source: "link", offerable: false, rights: null });
  });

  it("knows an item's history: scheduled, aired on carriers too, and what uses it", async () => {
    const ep15 = getDb().library.items.find((i) => i.title === "Late Crate, ep. 15")!;
    const r = await api(`/library/${ep15.id}/history`);
    expect(r.body.aired.some((a: { station: { callSign: string }; carried: boolean; audioOnly: boolean }) => a.station.callSign === "HALL" && a.carried && a.audioOnly)).toBe(true);
    expect(r.body.carriage).toMatchObject({ offered: true, program: "Late Crate", terms: "barter" });
    expect(r.body.carriers).toBe(2);
  });
});
