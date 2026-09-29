// Master control's requests (added 2026-09-29): the switcher's status (A5), hosts readable and
// named on invites (A4), listings per airing (G5), ending a live block early (G3), the lower third
// (S15), the Monitor's extras (G2), sign-on checks' watch link (G6), repeats (G7), break rows (G1),
// an item's history (L5), replacing its file (L6) and captions (L7).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { anon, createHarness, itemFixture, market, stationFixture, testClip, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User; // BEAT's owner
let hana: User; // a host
let stationId: string;
let liveProgramId: string;
let showProgramId: string;
let sourceId: string;
let liveEntryId: string;
let p1: { id: string; itemId: string };
let p2: { id: string };

const NOW = "2026-10-01T19:00:00.000Z"; // Noon in Los Angeles.
const at = (iso: string) => new Date(iso);

beforeAll(async () => {
  h = await createHarness();
  h.clock.set(NOW);
  const m = await market(h);
  kai = await h.signIn("Kai");
  hana = await h.signIn("Hana");
  const station = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true, colour: "#8C3B7A" });
  stationId = station.id;

  liveProgramId = (await kai.post(`/v1/stations/${stationId}/programs`, { title: "Council Watch", live: true, description: "Live from Redlands City Hall" }).expect(201)).body.id;
  showProgramId = (await kai.post(`/v1/stations/${stationId}/programs`, { title: "Late Crate" }).expect(201)).body.id;
  sourceId = (await kai.post(`/v1/stations/${stationId}/live-sources`, { kind: "encoder", name: "Studio A" }).expect(201)).body.source.id;

  // The log: a live block now, then two episodes back to back, then nothing.
  const live = await kai
    .post(`/v1/stations/${stationId}/log`, { kind: "live", startsAt: "2026-10-01T18:50:00.000Z", endsAt: "2026-10-01T19:50:00.000Z", liveSourceId: sourceId, programId: liveProgramId })
    .expect(201);
  liveEntryId = live.body.id;
  const ep14 = await itemFixture(h, stationId, { title: "Late Crate, ep. 14", programId: showProgramId, episodeNumber: 14 });
  const ep15 = await itemFixture(h, stationId, { title: "Late Crate, ep. 15", programId: showProgramId, episodeNumber: 15 });
  await h.db.update(schema.assets).set({ episodeDescription: "Northern soul from the Inland Empire" }).where(eq(schema.assets.id, ep15.id));
  p1 = { id: (await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-01T19:50:00.000Z", itemId: ep14.id }).expect(201)).body.id, itemId: ep14.id };
  p2 = { id: (await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-01T20:19:00.000Z", itemId: ep15.id }).expect(201)).body.id };

  // On air since 11:00 am.
  await h.db.insert(schema.playoutState).values({ stationId, onAir: true });
  await h.db.insert(schema.commands).values({ stationId, action: "sign_on", createdAt: at("2026-10-01T18:00:00.000Z"), consumedAt: at("2026-10-01T18:00:01.000Z") });
}, 60_000);
afterAll(() => h.close());

describe("hosts (A4)", () => {
  it("a host invite names live programs; accepting it makes them the host", async () => {
    const notLive = await kai.post(`/v1/stations/${stationId}/team/invites`, { email: "hana@example.com", role: "host", programIds: [showProgramId] }).expect(400);
    expect(notLive.body.error.fields).toEqual({ programIds: "Not a live program here" });
    await kai.post(`/v1/stations/${stationId}/team/invites`, { email: "op@example.com", role: "operator", programIds: [liveProgramId] }).expect(400);

    const invite = await kai.post(`/v1/stations/${stationId}/team/invites`, { email: "hana@example.com", role: "host", programIds: [liveProgramId] }).expect(200);
    expect(invite.body).toMatchObject({ role: "host", programIds: [liveProgramId] });
    await hana.post(`/v1/invites/${invite.body.id}/accept`).expect(200);

    const hosts = await kai.get(`/v1/stations/${stationId}/hosts`).expect(200);
    expect(hosts.body).toEqual({ programs: [{ programId: liveProgramId, title: "Council Watch", hosts: [{ userId: hana.id, displayName: "Hana" }] }] });
    const team = await kai.get(`/v1/stations/${stationId}/team`).expect(200);
    expect(team.body.members.find((m: { userId: string }) => m.userId === hana.id)).toMatchObject({ role: "host", programIds: [liveProgramId] });
    expect(team.body.members.find((m: { userId: string }) => m.userId === kai.id).programIds).toBeUndefined();
    // A host sees their own programs.
    expect((await hana.get(`/v1/stations/${stationId}/hosts`).expect(200)).body.programs).toHaveLength(1);
  });
});

describe("the station switcher (A5)", () => {
  it("says on air and when dead air starts", async () => {
    const res = await kai.get("/v1/me/stations/status").expect(200);
    expect(res.body).toEqual([{ stationId, onAir: true, deadAirAt: "2026-10-01T20:48:00.000Z", deadAirEndsAt: "2026-10-02T01:00:00.000Z" }]);
    await anon(h).get("/v1/me/stations/status").expect(401);
  });
});

describe("the Monitor and sign-on checks (G2, G6)", () => {
  it("says since when, and what's next", async () => {
    const res = await kai.get(`/v1/stations/${stationId}/playout`).expect(200);
    expect(res.body).toMatchObject({
      onAir: true,
      onAirSince: "2026-10-01T18:00:00.000Z",
      next: { title: "Late Crate", detail: "Late Crate, ep. 14", code: "PGM", startsAt: "2026-10-01T19:50:00.000Z", producer: null, colour: "#8C3B7A", pictureUrl: null },
      output: { bitrateKbps: null }
    });
  });

  it("the output check carries its watch link (null before there's an output)", async () => {
    const res = await kai.get(`/v1/stations/${stationId}/sign-on/checks`).expect(200);
    expect(res.body.checks.find((c: { key: string }) => c.key === "output")).toMatchObject({ watchUrl: null });
  });
});

describe("listings (G5)", () => {
  it("lists each airing with its status", async () => {
    const res = await kai.get(`/v1/stations/${stationId}/listings?from=2026-10-01T18:00:00.000Z&to=2026-10-02T06:00:00.000Z`).expect(200);
    expect(res.body.listings.map((l: { entryId: string; status: string; episodeDescription: string | null }) => [l.entryId, l.status, l.episodeDescription])).toEqual([
      [liveEntryId, "complete", null],
      [p1.id, "needs_description", null],
      [p2.id, "complete", "Northern soul from the Inland Empire"]
    ]);
    expect(res.body.needDescription).toBe(1);
    expect(res.body.listings[1]).toMatchObject({ title: "Late Crate", episodeTitle: "Late Crate, ep. 14", imported: false, carriedFrom: null, program: { id: showProgramId, title: "Late Crate" } });
    await hana.get(`/v1/stations/${stationId}/listings?from=2026-10-01T18:00:00.000Z&to=2026-10-02T06:00:00.000Z`).expect(403);
  });

  it("edits an airing's description; the dial and guide read it", async () => {
    const res = await kai.patch(`/v1/stations/${stationId}/listings/${p1.id}`, { episodeDescription: "Tonight: a steamboat, a haunted barn" }).expect(200);
    expect(res.body).toMatchObject({ status: "complete", episodeDescription: "Tonight: a steamboat, a haunted barn" });
    const long = await kai.patch(`/v1/stations/${stationId}/listings/${p1.id}`, { episodeDescription: "x".repeat(161) }).expect(400);
    expect(long.body.error.code).toBe("bad_request");
    const guide = await anon(h).get("/v1/markets/inland-empire/guide?from=2026-10-01T19:00:00.000Z&to=2026-10-02T03:00:00.000Z").expect(200);
    const airings = guide.body.rows[0].airings;
    expect(airings.find((a: { logEntryId: string }) => a.logEntryId === p1.id).episodeDescription).toBe("Tonight: a steamboat, a haunted barn");
    expect(airings.find((a: { logEntryId: string }) => a.logEntryId === p2.id).episodeDescription).toBe("Northern soul from the Inland Empire");
    const log = await kai.get(`/v1/stations/${stationId}/log?from=2026-10-01T19:00:00.000Z&to=2026-10-02T03:00:00.000Z`).expect(200);
    expect(log.body.entries.find((e: { id: string }) => e.id === p1.id)).toMatchObject({ episodeDescription: "Tonight: a steamboat, a haunted barn", endedEarlyAt: null });
  });
});

describe("breaks and repeats on the log (G1, G7)", () => {
  it("each break's rows, the station ID last", async () => {
    const log = await kai.get(`/v1/stations/${stationId}/log?from=2026-10-01T19:00:00.000Z&to=2026-10-02T03:00:00.000Z`).expect(200);
    // A 28:30 episode in a 29-minute slot leaves :30 after it.
    const after = log.body.breaks.find((b: { startsAt: string }) => b.startsAt === "2026-10-01T20:18:30.000Z");
    expect(after.rows).toEqual([
      { code: "OPEN", title: "Open", lengthMs: 25_000, whose: "station", note: "Filled from the rotation about 20 minutes before" },
      { code: "SID", title: "Station ID", lengthMs: 5_000, whose: "station", note: null }
    ]);
  });

  it("reads back what Repeat this day set up, and undoes it", async () => {
    const ep = await itemFixture(h, stationId, { title: "Overnight", programId: showProgramId });
    await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-06T03:00:00.000Z", itemId: ep.id }).expect(201);
    const repeated = await kai.post(`/v1/stations/${stationId}/log/repeat`, { day: "2026-10-05", pattern: "daily", until: "2026-10-08" }).expect(200);
    // Since 2026-09-29 it makes a day template (`templateId`, and `template` on the repeat).
    expect(repeated.body).toEqual({ created: 3, skippedForConflicts: 0, templateId: expect.any(String) });
    const log = await kai.get(`/v1/stations/${stationId}/log?from=2026-10-05T07:00:00.000Z&to=2026-10-09T07:00:00.000Z`).expect(200);
    expect(log.body.repeats).toEqual([
      { id: repeated.body.templateId, day: "2026-10-05", pattern: "daily", until: "2026-10-08", entries: 3, template: true, weekday: null, label: "Every day" }
    ]);
    const removed = await kai.delete(`/v1/stations/${stationId}/log/repeats/${log.body.repeats[0].id}`).expect(200);
    expect(removed.body).toEqual({ removed: 3 });
    const after = await kai.get(`/v1/stations/${stationId}/log?from=2026-10-05T07:00:00.000Z&to=2026-10-09T07:00:00.000Z`).expect(200);
    expect(after.body.repeats).toEqual([]);
    expect(after.body.entries).toHaveLength(1);
  });
});

describe("the lower third (S15)", () => {
  let speakers: Array<{ id: string; name: string }>;

  it("starts on the first speaker; a speaker, free text or hidden; a second device reads it", async () => {
    speakers = (await kai.put(`/v1/programs/${liveProgramId}/speakers`, [{ name: "Mayor Ruiz", title: "Mayor" }, { name: "Ana Cho", title: null }]).expect(200)).body;
    const first = await hana.get(`/v1/stations/${stationId}/log/${liveEntryId}/lower-third`).expect(200);
    expect(first.body).toEqual({ entryId: liveEntryId, hidden: false, speakerId: speakers[0].id, name: "Mayor Ruiz", title: "Mayor", updatedAt: null });

    // The speaker's own name and title, whatever was sent.
    const second = await hana.put(`/v1/stations/${stationId}/log/${liveEntryId}/lower-third`, { hidden: false, speakerId: speakers[1].id, name: "x", title: "y" }).expect(200);
    expect(second.body).toMatchObject({ speakerId: speakers[1].id, name: "Ana Cho", title: null, updatedAt: NOW });
    await hana.put(`/v1/stations/${stationId}/log/${liveEntryId}/lower-third`, { hidden: false, speakerId: null, name: "Public comment", title: "Item 4" }).expect(200);
    const read = await kai.get(`/v1/stations/${stationId}/log/${liveEntryId}/lower-third`).expect(200);
    expect(read.body).toMatchObject({ hidden: false, speakerId: null, name: "Public comment", title: "Item 4" });
    const hidden = await kai.put(`/v1/stations/${stationId}/log/${liveEntryId}/lower-third`, { hidden: true, speakerId: null, name: "Public comment", title: "Item 4" }).expect(200);
    expect(hidden.body.hidden).toBe(true);

    const bad = await kai.put(`/v1/stations/${stationId}/log/${liveEntryId}/lower-third`, { hidden: false, speakerId: p1.id, name: "", title: null }).expect(400);
    expect(bad.body.error.fields).toEqual({ speakerId: "Not on the list" });
    const notLive = await kai.get(`/v1/stations/${stationId}/log/${p1.id}/lower-third`).expect(409);
    expect(notLive.body.error.code).toBe("not_live");
  });

  it("hosts only on their own blocks", async () => {
    const other = await kai.post(`/v1/stations/${stationId}/programs`, { title: "Open Mic", live: true }).expect(201);
    const block = await kai
      .post(`/v1/stations/${stationId}/log`, { kind: "live", startsAt: "2026-10-02T03:00:00.000Z", endsAt: "2026-10-02T04:00:00.000Z", liveSourceId: sourceId, programId: other.body.id })
      .expect(201);
    const res = await hana.get(`/v1/stations/${stationId}/log/${block.body.id}/lower-third`).expect(403);
    expect(res.body.error.code).toBe("not_your_block");
    await hana.post(`/v1/stations/${stationId}/log/${block.body.id}/end-early`).expect(403);
  });
});

describe("ending a live block early (G3)", () => {
  it("only while it's on air", async () => {
    const res = await kai.post(`/v1/stations/${stationId}/log/${p1.id}/end-early`).expect(409);
    expect(res.body.error.code).toBe("not_live");
  });

  it("ends it now, moves the log up, and tells playout", async () => {
    h.clock.set("2026-10-01T19:00:00.400Z");
    const state = await hana.get(`/v1/stations/${stationId}/log/${liveEntryId}/live`).expect(200);
    expect(state.body).toEqual({ entryId: liveEntryId, endedEarlyAt: null, startsAt: "2026-10-01T18:50:00.000Z", endsAt: "2026-10-01T19:50:00.000Z", signal: "receiving" });

    const res = await hana.post(`/v1/stations/${stationId}/log/${liveEntryId}/end-early`).expect(200);
    expect(res.body).toEqual({ entryId: liveEntryId, endedAt: "2026-10-01T19:00:00.000Z", movedUp: 2 });
    const log = await kai.get(`/v1/stations/${stationId}/log?from=2026-10-01T18:00:00.000Z&to=2026-10-01T21:00:00.000Z`).expect(200);
    expect(log.body.entries.map((e: { id: string; startsAt: string; endsAt: string }) => [e.id, e.startsAt, e.endsAt])).toEqual([
      [liveEntryId, "2026-10-01T18:50:00.000Z", "2026-10-01T19:00:00.000Z"],
      [p1.id, "2026-10-01T19:00:00.000Z", "2026-10-01T19:29:00.000Z"],
      [p2.id, "2026-10-01T19:29:00.000Z", "2026-10-01T19:58:00.000Z"]
    ]);
    expect(log.body.entries[0].endedEarlyAt).toBe("2026-10-01T19:00:00.000Z");
    const [command] = await h.db.select().from(schema.commands).where(and(eq(schema.commands.stationId, stationId), eq(schema.commands.action, "end_live")));
    expect(command).toMatchObject({ issuedBy: hana.id, consumedAt: null });

    const after = await kai.get(`/v1/stations/${stationId}/log/${liveEntryId}/live`).expect(200);
    expect(after.body).toMatchObject({ endedEarlyAt: "2026-10-01T19:00:00.000Z", signal: null });
    const twice = await kai.post(`/v1/stations/${stationId}/log/${liveEntryId}/end-early`).expect(409);
    expect(twice.body.error.code).toBe("ended");
    // The switcher follows the log.
    expect((await kai.get("/v1/me/stations/status").expect(200)).body[0].deadAirAt).toBe("2026-10-01T19:58:00.000Z");
  });
});

describe("an item's history (L5) and captions (L7)", () => {
  it("scheduled here and aired, with usage and readiness", async () => {
    await h.db.insert(schema.asRun).values({ stationId, code: "PGM", startedAt: at("2026-09-28T03:00:00.000Z"), endedAt: at("2026-09-28T03:28:30.000Z"), assetId: p1.itemId, programId: showProgramId, reason: "planned" });
    const res = await kai.get(`/v1/library/${p1.itemId}/history`).expect(200);
    expect(res.body).toMatchObject({
      itemId: p1.itemId,
      scheduled: [{ entryId: p1.id, startsAt: "2026-10-01T19:00:00.000Z", station: { callSign: "BEAT" }, note: null }],
      aired: [{ startedAt: "2026-09-28T03:00:00.000Z", station: { callSign: "BEAT" }, carried: false, audioOnly: false, note: null }],
      logEntries: 1,
      carriers: 0,
      // Not prepared for air (nothing has asked the worker to prepare it here).
      cachedForAir: false,
      preparation: { status: "not_asked", renditions: [], preparedAt: null },
      audioLayout: null,
      captionLanguage: null,
      carriage: { offered: false, program: "Late Crate", terms: null }
    });
    await hana.get(`/v1/library/${p1.itemId}/history`).expect(403);
  });

  it("a program's captions mode and language", async () => {
    const res = await kai.patch(`/v1/programs/${liveProgramId}/captions`, { mode: "generated_live", language: "en" }).expect(200);
    expect(res.body).toEqual({ mode: "generated_live", language: "en" });
    const listings = await kai.get(`/v1/stations/${stationId}/listings?from=2026-10-01T18:00:00.000Z&to=2026-10-01T21:00:00.000Z`).expect(200);
    expect(listings.body.listings[0].program.captions).toEqual({ mode: "generated_live", language: "en" });
  });

  it("an item's caption track: SRT becomes WebVTT; edit and remove it", async () => {
    await kai.get(`/v1/library/${p1.itemId}/captions`).expect(404);
    const refused = await kai.put(`/v1/library/${p1.itemId}/captions`, { language: "en", text: "just words" }).expect(422);
    expect(refused.body.error.code).toBe("not_captions");
    const srt = "1\r\n00:00:01,000 --> 00:00:03,500\r\nGood evening.\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nThis is Late Crate.\r\n";
    const put = await kai.put(`/v1/library/${p1.itemId}/captions`, { language: "en", text: srt }).expect(200);
    expect(put.body).toEqual({
      itemId: p1.itemId,
      language: "en",
      source: "uploaded",
      vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nGood evening.\n\n00:00:04.000 --> 00:00:06.000\nThis is Late Crate.\n",
      updatedAt: "2026-10-01T19:00:00.400Z"
    });
    const item = await kai.get(`/v1/library/${p1.itemId}`).expect(200);
    expect(item.body).toMatchObject({ captions: "uploaded", captionLanguage: "en" });
    const edited = await kai.put(`/v1/library/${p1.itemId}/captions`, { language: "es", text: "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nBuenas noches.", source: "edited" }).expect(200);
    expect(edited.body).toMatchObject({ language: "es", source: "edited" });
    expect((await kai.get(`/v1/library/${p1.itemId}/history`).expect(200)).body.captionLanguage).toBe("es");
    await kai.delete(`/v1/library/${p1.itemId}/captions`).expect(200);
    expect((await kai.get(`/v1/library/${p1.itemId}`).expect(200)).body).toMatchObject({ captions: "none", captionLanguage: null });
  });
});

describe("replacing an item's file (L6)", () => {
  let itemId: string;

  it("keeps the item and its schedule; the new file airs once it's prepared", async () => {
    const uploaded = await kai.post(`/v1/stations/${stationId}/library/uploads`).attach("file", await testClip(20)).field("title", "BEAT ident").expect(201);
    itemId = uploaded.body.id;
    await h.services.library.settle();
    const ready = await kai.get(`/v1/library/${itemId}`).expect(200);
    expect(ready.body).toMatchObject({ status: "ready", audioLayout: "mono" });
    const oldContent = ready.body.storage.contentId;
    await kai.post(`/v1/library/${itemId}/rights`, { basis: "made_it" }).expect(200);
    const entry = await kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-03T03:00:00.000Z", itemId }).expect(201);

    // Longer than the slot it's in (a minute).
    const tooLong = await kai.post(`/v1/library/${itemId}/file`).attach("file", await testClip(70)).expect(422);
    expect(tooLong.body.error.code).toBe("too_long_for_log");
    const audio = await kai.post(`/v1/library/${itemId}/file`).attach("file", await testClip(10, "audio")).expect(422);
    expect(audio.body.error.code).toBe("wrong_kind");

    const replaced = await kai.post(`/v1/library/${itemId}/file`).attach("file", await testClip(12)).expect(200);
    expect(replaced.body).toMatchObject({ id: itemId, status: "preparing", title: "BEAT ident" });
    // The old file stays until the new one is ready.
    expect(replaced.body.durationMs).toBeGreaterThan(19_000);
    await h.services.library.settle();
    const after = await kai.get(`/v1/library/${itemId}`).expect(200);
    expect(after.body).toMatchObject({ status: "ready", rights: { basis: "made_it" } });
    expect(after.body.durationMs).toBeLessThan(13_000);
    expect(after.body.storage.contentId).not.toBe(oldContent);
    const files = await h.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.assetId, itemId));
    expect(files.map((f) => f.version).sort()).toEqual([1, 2]);
    const log = await kai.get(`/v1/stations/${stationId}/log?from=2026-10-03T02:00:00.000Z&to=2026-10-03T04:00:00.000Z`).expect(200);
    expect(log.body.entries.map((e: { id: string }) => e.id)).toContain(entry.body.id);
  }, 120_000);

  it("only uploads, and not while a claim is open", async () => {
    const link = await itemFixture(h, stationId, { source: "link" });
    const res = await kai.post(`/v1/library/${link.id}/file`).attach("file", await testClip(12)).expect(409);
    expect(res.body.error.code).toBe("not_an_upload");
  }, 60_000);
});
