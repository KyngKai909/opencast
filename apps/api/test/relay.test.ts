// Relays (follow-up Phase 3), without FFmpeg: the relay runner against a local fake of Livepeer's
// API (no stream is created, nothing is pushed anywhere) and a stub of the platforms seam, with
// the sender and its output stubbed. What the sender itself sends is checked for real, in real
// time, in playout-relay.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { RelayView, type PlatformsSeam, type RelayDestination } from "@opencast/contracts";
import { senderPicture, StationSender, type SenderSettings } from "../src/v1/modules/playout/engine/sender.js";
import { isPaidPromotion, relayPicture } from "../src/v1/modules/playout/engine/relayBreaks.js";
import { planRestart, restartNeed, limitsFrom, type BreakMoment } from "../src/v1/modules/relays/limits.js";
import { createRelayRunner, type OutputLike, type RelayRunner, type SenderInput, type SenderLike } from "../src/v1/modules/relays/runner.js";
import { createEngine } from "../src/v1/modules/playout/engine/index.js";
import { RULES } from "@opencast/contracts";
import { fakeLivepeerApi, type FakeLivepeer } from "./fake-livepeer-api.js";
import { createHarness, dummyFile, fakeTranscoder, itemFixture, market, prepareQueued, radioTenths, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let lp: FakeLivepeer;
let kai: User;
let desk: User;
let marketId: string;
let major = 20;

const H = 3_600_000;
const at = (iso: string) => new Date(iso);

/** The platforms seam as the platforms module will provide it, with what the relay asked of it. */
function fakePlatforms() {
  const dests = new Map<string, RelayDestination[]>();
  const calls: string[] = [];
  let n = 0;
  const seam: PlatformsSeam = {
    async destinationsFor(stationId) {
      return dests.get(stationId) ?? [];
    },
    async prepareNextBroadcast(platformId) {
      calls.push(`prepare:${platformId}`);
      n++;
      return { rtmpUrl: "rtmp://a.rtmp.youtube.com/live2", streamKey: `yt-next-${n}`, broadcastId: `bc-${n}` };
    },
    async endBroadcast(platformId, broadcastId) {
      calls.push(`end:${platformId}:${broadcastId ?? "current"}`);
    },
    async setPaidPromotion(platformId, on) {
      calls.push(`paid:${platformId}:${on}`);
      return { applied: true };
    }
  };
  return { seam, dests, calls };
}

/** A sender that sends nothing (what it was asked to do is kept). */
class StubSender implements SenderLike {
  running = true;
  errors = 0;
  lastError: string | null = null;
  started = 0;
  constructor(readonly input: SenderInput) {}
  get mode() {
    return senderPicture(this.input.settings, this.input.look);
  }
  start() {
    this.started++;
  }
  async stop() {
    this.running = false;
  }
  update(settings: SenderSettings) {
    this.input.settings = settings;
  }
}

function stubOutput(dests: Array<{ id: string; url: string }>) {
  const o = {
    dests,
    sent: 0,
    restarts: [] as string[],
    get destinations() {
      return o.dests.length;
    },
    write() {},
    bytes: () => o.sent,
    set(d: Array<{ id: string; url: string }>) {
      o.dests = d;
    },
    async restart(id: string) {
      o.restarts.push(id);
      return true;
    },
    async close() {}
  };
  return o;
}
type StubOutput = ReturnType<typeof stubOutput>;

function runnerFor(platforms: PlatformsSeam, extra: { fanOut?: "livepeer" | "direct"; alertAfterMs?: number } = {}) {
  const senders = new Map<string, StubSender>();
  const outputs = new Map<string, StubOutput>();
  const runner = createRelayRunner(
    { deps: h.deps, services: h.services },
    {
      log: () => undefined,
      platforms,
      livepeer: lp.api,
      fanOut: extra.fanOut ?? "livepeer",
      restartGapMs: 0,
      restartCheckMs: 60_000,
      alertAfterMs: extra.alertAfterMs ?? 60_000,
      makeSender: (input) => {
        const s = new StubSender(input);
        senders.set(input.stationId, s);
        outputs.set(input.stationId, input.output as unknown as StubOutput);
        return s;
      },
      makeOutput: (d) => stubOutput(d) as unknown as OutputLike
    }
  );
  return { runner, senders, outputs };
}

async function station(callSign: string, band: "tv" | "radio" = "tv") {
  const s = await stationFixture(h, { callSign, name: callSign, ownerId: kai.id, marketId, tenths: band === "radio" ? await radioTenths(h, major++ % 50) : major++ * 10 + 1, band, signedOn: true });
  await h.db.insert(schema.playoutState).values({ stationId: s.id, onAir: true });
  return s.id;
}

const yt = (id: string, connected = true): RelayDestination => ({ platformId: `${id}-yt`, kind: "youtube", name: "Inland Beat channel", rtmpUrl: "rtmp://a.rtmp.youtube.com/live2", streamKey: `yt-key-${id}`, connected });
const tw = (id: string): RelayDestination => ({ platformId: `${id}-tw`, kind: "twitch", rtmpUrl: "rtmp://live.twitch.tv/app", streamKey: `tw-key-${id}`, connected: false });
const fb = (id: string): RelayDestination => ({ platformId: `${id}-fb`, kind: "facebook", rtmpUrl: "rtmps://live-api-s.facebook.com:443/rtmp", streamKey: `fb-key-${id}`, connected: false });

beforeAll(async () => {
  h = await createHarness();
  lp = await fakeLivepeerApi("rtmp://ingest.livepeer.test/live");
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
  desk = await h.signIn("Desk", { admin: true });
});

afterAll(async () => {
  await lp.close();
  await h.close();
});

beforeEach(() => {
  h.clock.set("2026-10-01T19:00:00.000Z");
  lp.calls.length = 0;
});

describe("what a relay shows in breaks", () => {
  const program = { inBreak: false, code: "PGM" };
  const spot = { inBreak: true, code: "SPT" };
  const credit = { inBreak: true, code: "UND" };
  const hold = { inBreak: true, code: "OPEN" };
  const ident = { inBreak: true, code: "SID" };

  it("your spots, or the station ID slate, for every relay at once", () => {
    const spots = { breakHandling: "air_spots" as const, partnerAds: false };
    const slate = { breakHandling: "station_id_slate" as const, partnerAds: false };
    expect(relayPicture(program, slate)).toEqual({ show: "as_aired", why: "program" });
    expect(relayPicture(spot, spots)).toEqual({ show: "as_aired", why: "spots" });
    expect(relayPicture(spot, slate)).toEqual({ show: "station_id_slate", why: "station_chose_slate" });
    expect(relayPicture(ident, slate).show).toBe("station_id_slate");
  });

  it("time ads from partners would fill shows the station ID slate", () => {
    const partners = { breakHandling: "air_spots" as const, partnerAds: true };
    expect(relayPicture(hold, partners)).toEqual({ show: "station_id_slate", why: "partner_time" });
    // The station's own spots, credits, bumpers and station ID still air.
    expect(relayPicture(spot, partners).show).toBe("as_aired");
    expect(relayPicture(ident, partners).show).toBe("as_aired");
  });

  it("spots and credits aired on a relay are paid promotion; the slate isn't", () => {
    const spots = { breakHandling: "air_spots" as const, partnerAds: false };
    expect(isPaidPromotion(spot, spots)).toBe(true);
    expect(isPaidPromotion(credit, spots)).toBe(true);
    expect(isPaidPromotion(ident, spots)).toBe(false);
    expect(isPaidPromotion(program, spots)).toBe(false);
    expect(isPaidPromotion(spot, { breakHandling: "station_id_slate", partnerAds: false })).toBe(false);
  });
});

describe("the picture", () => {
  const tv = { band: "tv" as const, bug: { mode: "call_sign_and_channel" as const, opacity: 80, position: "bottom_right" } };
  it("is composited with the station bug on relays (the default), stream-copied with it off", () => {
    expect(senderPicture({ bugOnRelays: true }, tv)).toBe("composite");
    expect(senderPicture({ bugOnRelays: false }, tv)).toBe("copy");
    // A station with no bug, and radio (its picture is prepared): nothing to draw.
    expect(senderPicture({ bugOnRelays: true }, { ...tv, bug: { ...tv.bug, mode: "off" as const } })).toBe("copy");
    expect(senderPicture({ bugOnRelays: true }, { ...tv, band: "radio" as const })).toBe("copy");
    // Turning it off starts a new session (a new encode); what breaks show doesn't.
    const base: SenderSettings = { relayMode: "everything", breakHandling: "air_spots", bugOnRelays: true, partnerAds: false };
    expect(StationSender.signature({ ...base, bugOnRelays: false }, tv)).not.toBe(StationSender.signature(base, tv));
    expect(StationSender.signature({ ...base, breakHandling: "station_id_slate" }, tv)).toBe(StationSender.signature(base, tv));
  });
});

describe("restart timing", () => {
  const limits = limitsFrom(RULES["relays.platform_limits"].fallback, RULES["relays.platform_limits"].fallback);
  const started = at("2026-10-01T00:00:00Z");
  const twitch = restartNeed({ kind: "twitch", connected: false }, started, limits, { saveYoutubeVideos: false })!;
  // Breaks every half hour, 2 minutes long, the station ID in their last 5 seconds.
  const breaks: BreakMoment[] = [];
  for (let t = Date.parse("2026-10-02T18:28:00Z"); t < Date.parse("2026-10-03T02:00:00Z"); t += 30 * 60_000) breaks.push({ id: `b${t}`, startsAt: new Date(t), endsAt: new Date(t + 120_000), stationId: true });
  const opts = { now: at("2026-10-02T18:00:00Z"), windowHours: limits.windowHours, sidMs: 5_000 };

  it("reads the limits table: Twitch 48 hours, YouTube rolls at 11 only when saving, Facebook needs sign-in, Kick none", () => {
    expect(twitch).toMatchObject({ reason: "limit", deadline: at("2026-10-03T00:00:00Z"), aim: at("2026-10-02T23:45:00Z"), automatic: true });
    expect(restartNeed({ kind: "youtube", connected: true }, started, limits, { saveYoutubeVideos: false })).toBeNull();
    expect(restartNeed({ kind: "youtube", connected: true }, started, limits, { saveYoutubeVideos: true })).toMatchObject({ reason: "save_video", aim: at("2026-10-01T11:00:00Z"), deadline: at("2026-10-01T12:00:00Z") });
    expect(restartNeed({ kind: "facebook", connected: false }, started, limits, { saveYoutubeVideos: false })).toMatchObject({ automatic: false, deadline: at("2026-10-01T08:00:00Z") });
    expect(restartNeed({ kind: "facebook", connected: true }, started, limits, { saveYoutubeVideos: false })?.automatic).toBe(true);
    expect(restartNeed({ kind: "kick", connected: false }, started, limits, { saveYoutubeVideos: false })).toBeNull();
    expect(restartNeed({ kind: "custom", connected: false, limitHours: 4 }, started, limits, { saveYoutubeVideos: false })?.deadline).toEqual(at("2026-10-01T04:00:00Z"));
  });

  it("lands on the station ID in the last break before the limit", () => {
    const plan = planRestart(twitch, breaks, [], opts);
    // The 23:28 break's station ID, 23:29:55 (the next break, 23:58, is past the 23:45 aim).
    expect(plan).toMatchObject({ at: at("2026-10-02T23:29:55Z"), duringBreak: true, why: "last_break" });
  });

  it("with a live block running past that window, the first break after it ends, still inside the limit", () => {
    // Live until 23:47, past the 23:45 aim; a break right after it, at 23:49.
    const lives = [{ startsAt: at("2026-10-02T22:00:00Z"), endsAt: at("2026-10-02T23:47:00Z") }];
    const withAfter = [...breaks, { id: "after", startsAt: at("2026-10-02T23:49:00Z"), endsAt: at("2026-10-02T23:51:00Z"), stationId: true }];
    const plan = planRestart(twitch, withAfter, lives, opts);
    expect(plan).toMatchObject({ at: at("2026-10-02T23:50:55Z"), duringBreak: true, breakId: "after", why: "after_live" });
    expect(plan.at < twitch.deadline).toBe(true);
    // If the first break after it would be past the limit: the last one before the live block.
    const longer = [{ startsAt: at("2026-10-02T22:00:00Z"), endsAt: at("2026-10-03T00:30:00Z") }];
    expect(planRestart(twitch, breaks, longer, opts)).toMatchObject({ at: at("2026-10-02T21:59:55Z"), why: "last_break" });
    // No break at all: at the aim, and it says so.
    expect(planRestart(twitch, [], [], opts)).toMatchObject({ at: twitch.aim, duringBreak: false, why: "no_break" });
  });
});

describe("relay modes", () => {
  it("live shows only (the default): the live source's own Livepeer stream multistreams to the platforms during its block; no relay", async () => {
    const id = await station("LIVE");
    const liveStream = lp.addStream("live-src-1");
    const [source] = await h.db.insert(schema.liveSources).values({ stationId: id, kind: "encoder", name: "Studio A", livepeerStreamId: liveStream.id, livepeerPlaybackId: "pb" }).returning();
    const [program] = await h.db.insert(schema.programs).values({ stationId: id, title: "Town Hall", isLive: true }).returning();
    await kai.post(`/v1/stations/${id}/log`, { kind: "live", startsAt: "2026-10-01T20:00:00.000Z", endsAt: "2026-10-01T21:00:00.000Z", liveSourceId: source.id, programId: program.id }).expect(201);
    const p = fakePlatforms();
    p.dests.set(id, [yt(id), tw(id)]);
    const { runner, senders } = runnerFor(p.seam);

    // Before the block (a rehearsal): nothing goes out.
    await runner.tick();
    expect([...lp.targets.values()].filter((t) => !t.disabled)).toHaveLength(0);

    h.clock.set("2026-10-01T20:05:00.000Z");
    await runner.tick();
    const on = [...lp.targets.values()].filter((t) => !t.disabled);
    expect(on.map((t) => t.url).sort()).toEqual([`rtmp://a.rtmp.youtube.com/live2/yt-key-${id}`, `rtmp://live.twitch.tv/app/tw-key-${id}`]);
    expect(liveStream.multistream.targets).toHaveLength(2);
    expect(liveStream.multistream.targets.every((t) => t.profile === "source")).toBe(true);
    // No relay stream, no sender.
    expect(lp.calls.filter((c) => c.method === "POST" && c.path === "/stream")).toHaveLength(0);
    expect(senders.has(id)).toBe(false);
    expect((await kai.get(`/v1/stations/${id}/relay`).expect(200)).body).toMatchObject({ mode: "live_only", status: "relaying" });

    // The block ends: the targets go off.
    h.clock.set("2026-10-01T21:00:30.000Z");
    await runner.tick();
    expect([...lp.targets.values()].filter((t) => !t.disabled)).toHaveLength(0);
    await runner.stopAll();
  });

  it("everything I air: one push to a per-station Livepeer relay stream with profiles [] and a source target per platform", async () => {
    const id = await station("EVRY");
    const p = fakePlatforms();
    p.dests.set(id, [yt(id), tw(id)]);
    const view = RelayView.parse((await kai.patch(`/v1/stations/${id}/relay`, { mode: "everything" }).expect(200)).body);
    expect(view).toMatchObject({ mode: "everything", breakHandling: "air_spots", bugOnRelays: true, saveYoutubeVideos: false });
    const { runner, senders, outputs } = runnerFor(p.seam);
    await runner.tick();

    const created = lp.calls.filter((c) => c.method === "POST" && c.path === "/stream");
    expect(created).toHaveLength(1);
    expect(created[0].body).toMatchObject({ profiles: [], record: false });
    const [relayStream] = [...lp.streams.values()].filter((s) => s.name === "EVRY relay");
    expect(relayStream.profiles).toEqual([]);
    expect(relayStream.multistream.targets).toHaveLength(2);
    expect(relayStream.multistream.targets.every((t) => t.profile === "source" && t.videoOnly === false)).toBe(true);
    const urls = relayStream.multistream.targets.map((t) => lp.targets.get(t.id)!).map((t) => [t.url, t.disabled]);
    expect(urls.sort()).toEqual([
      [`rtmp://a.rtmp.youtube.com/live2/yt-key-${id}`, false],
      [`rtmp://live.twitch.tv/app/tw-key-${id}`, false]
    ]);
    // One sender, one push: to the relay stream's ingest, whatever the number of platforms.
    const sender = senders.get(id)!;
    expect(sender.input.settings).toMatchObject({ relayMode: "everything", breakHandling: "air_spots", bugOnRelays: true });
    expect(outputs.get(id)!.dests).toEqual([{ id: "livepeer", url: `rtmp://ingest.livepeer.test/live/${relayStream.streamKey}` }]);

    // A third platform: Livepeer gets a target; the push is the same, and the sender isn't restarted.
    p.dests.set(id, [yt(id), tw(id), fb(id)]);
    await runner.tick();
    expect(relayStream.multistream.targets).toHaveLength(3);
    expect(lp.calls.filter((c) => c.method === "POST" && c.path === "/stream")).toHaveLength(1);
    expect(sender.started).toBe(1);
    expect(outputs.get(id)!.dests).toHaveLength(1);

    // Billed per hour, per station: its sessions say `everything`.
    expect((await h.services.stations.relayModes([id])).get(id)).toBe("everything");
    await runner.stopAll();
  });

  it("the bug off restarts the push stream-copied; the break setting applies on the fly", async () => {
    const id = await station("BUGS");
    const p = fakePlatforms();
    p.dests.set(id, [tw(id)]);
    await kai.patch(`/v1/stations/${id}/relay`, { mode: "everything" }).expect(200);
    const { runner, senders } = runnerFor(p.seam);
    await runner.tick();
    const first = senders.get(id)!;
    expect(first.mode).toBe("composite");
    await kai.patch(`/v1/stations/${id}/relay`, { breakHandling: "station_id_slate" }).expect(200);
    await runner.tick();
    expect(senders.get(id)).toBe(first);
    expect(first.input.settings.breakHandling).toBe("station_id_slate");
    await kai.patch(`/v1/stations/${id}/relay`, { bugOnRelays: false }).expect(200);
    await runner.tick();
    expect(first.running).toBe(false);
    expect(senders.get(id)!.mode).toBe("copy");
    await runner.stopAll();
  });

  it("radio in live shows only: the relay service relays just the live block (free)", async () => {
    const id = await station("WAVE", "radio");
    const [source] = await h.db.insert(schema.liveSources).values({ stationId: id, kind: "encoder", name: "Booth" }).returning();
    const [program] = await h.db.insert(schema.programs).values({ stationId: id, title: "Morning Mix", isLive: true }).returning();
    await kai.post(`/v1/stations/${id}/log`, { kind: "live", startsAt: "2026-10-01T20:00:00.000Z", endsAt: "2026-10-01T21:00:00.000Z", liveSourceId: source.id, programId: program.id }).expect(201);
    const p = fakePlatforms();
    p.dests.set(id, [tw(id)]);
    const { runner, senders } = runnerFor(p.seam);
    await runner.tick();
    expect(senders.has(id)).toBe(false);
    h.clock.set("2026-10-01T20:10:00.000Z");
    await runner.tick();
    expect(senders.get(id)!.input.settings.relayMode).toBe("live_only");
    h.clock.set("2026-10-01T21:01:00.000Z");
    await runner.tick();
    expect(senders.get(id)!.running).toBe(false);
    await runner.stopAll();
  });

  it("paused by its cap: everything stops, live shows still go out, never the channel", async () => {
    const id = await station("CAPD");
    await kai.patch(`/v1/stations/${id}/relay`, { mode: "everything" }).expect(200);
    await h.db.insert(schema.stationBilling).values({ stationId: id, capsReached: { relay_everything: "2026-10" } }).onConflictDoNothing();
    const paused = await h.services.billing.paused(id);
    const p = fakePlatforms();
    p.dests.set(id, [tw(id)]);
    const { runner, senders } = runnerFor(p.seam);
    expect(paused.relays).toBe(true);
    await runner.tick();
    expect(senders.has(id)).toBe(false);
    const view = RelayView.parse((await kai.get(`/v1/stations/${id}/relay`).expect(200)).body);
    expect(view).toMatchObject({ status: "paused", pausedBecause: "cap" });
    const [state] = await h.db.select().from(schema.playoutState).where(eq(schema.playoutState.stationId, id));
    expect(state.onAir).toBe(true);
    await runner.stopAll();
  });
});

describe("paid promotion", () => {
  it("connected YouTube is marked through the platforms module; a pasted key gets a reminder the page shows", async () => {
    const id = await station("PAID");
    const p = fakePlatforms();
    p.dests.set(id, [yt(id), fb(id)]);
    await kai.patch(`/v1/stations/${id}/relay`, { mode: "everything" }).expect(200);
    const { runner, senders } = runnerFor(p.seam);
    await runner.tick();
    // A spot goes out on the relay.
    senders.get(id)!.input.onPaidPromotion();
    await runner.markPaidPromotion();
    expect(p.calls).toContain(`paid:${id}-yt:true`);
    expect(p.calls.filter((c) => c.startsWith(`paid:${id}-fb`))).toHaveLength(0);
    await h.deps.bus.settle();
    const view = RelayView.parse((await kai.get(`/v1/stations/${id}/relay`).expect(200)).body);
    expect(view.platforms.find((x) => x.kind === "youtube")?.paidPromotion).toBe("marked");
    expect(view.platforms.find((x) => x.kind === "facebook")?.paidPromotion).toBe("remind");
    const notices = (await kai.get("/v1/me/notices").expect(200)).body as Array<{ kind: string; title: string }>;
    expect(notices.find((n) => n.kind === "relay")?.title).toBe("Mark your stream on Facebook as paid promotion");
    // Once per broadcast.
    senders.get(id)!.input.onPaidPromotion();
    await runner.markPaidPromotion();
    expect(p.calls.filter((c) => c === `paid:${id}-yt:true`)).toHaveLength(1);
    await kai.post(`/v1/stations/${id}/relay/platforms/${id}-fb/paid-promotion-reminder/dismiss`).expect(200);
    expect(RelayView.parse((await kai.get(`/v1/stations/${id}/relay`).expect(200)).body).platforms.find((x) => x.kind === "facebook")?.paidPromotion).toBeNull();
    await runner.stopAll();
  });
});

describe("restarts for platform limits", () => {
  async function withBreaks(id: string) {
    await kai.put(`/v1/stations/${id}/break-rule`, { mode: "every_n_minutes", everyMinutes: 30, lengthMs: 120_000, spotMsPerHour: 180_000, sameSpotPerHour: 2, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "station_id_and_bumpers", blockedCategories: [] }).expect(200);
    const show = await itemFixture(h, id, { title: "Show", durationMs: 50 * 60_000, location: await dummyFile() });
    for (let t = Date.parse("2026-10-01T18:00:00Z"); t < Date.parse("2026-10-02T02:00:00Z"); t += H) {
      await kai.post(`/v1/stations/${id}/log`, { kind: "program", startsAt: new Date(t).toISOString(), endsAt: new Date(t + H).toISOString(), itemId: show.id }).expect(201);
    }
  }

  it("restarts only Twitch, during the station ID in a break, while YouTube keeps streaming; logged and shown", async () => {
    const id = await station("RSTR");
    await withBreaks(id);
    const p = fakePlatforms();
    p.dests.set(id, [yt(id), tw(id)]);
    await kai.patch(`/v1/stations/${id}/relay`, { mode: "everything" }).expect(200);
    const { runner } = runnerFor(p.seam);
    await runner.tick();
    // Twitch has been live 46 h 45 m: its limit is at 20:15, the aim 20:00.
    await h.db
      .update(schema.relayTargets)
      .set({ broadcastStartedAt: new Date(Date.parse("2026-10-01T19:00:00Z") - 46.75 * H) })
      .where(and(eq(schema.relayTargets.stationId, id), eq(schema.relayTargets.platformId, `${id}-tw`)));
    await runner.checkRestarts();
    const [planned] = await h.db.select().from(schema.relayRestarts).where(and(eq(schema.relayRestarts.stationId, id), eq(schema.relayRestarts.status, "scheduled")));
    expect(planned).toMatchObject({ platformId: `${id}-tw`, status: "scheduled", reason: "limit", duringBreak: true, automatic: true, method: "toggle" });
    // A break's station ID: its last 5 seconds.
    const breaks = await h.services.log.breaks(id, at("2026-10-01T19:00:00Z"), at("2026-10-01T20:15:00Z"));
    const ends = breaks.map((b) => Date.parse(b.startsAt) + b.lengthMs - 5_000);
    expect(ends).toContain(planned.at.getTime());
    expect(planned.at.getTime()).toBeLessThanOrEqual(Date.parse("2026-10-01T20:00:00Z"));
    const view = RelayView.parse((await kai.get(`/v1/stations/${id}/relay`).expect(200)).body);
    expect(view.nextRestarts[0].label).toMatch(/^Twitch restarts Thursday at \d{1,2}:\d{2} [ap]m, during a break$/);
    expect(view.platforms.find((x) => x.kind === "twitch")?.nextRestart?.id).toBe(planned.id);

    // At the station ID: only Twitch's target goes off and on.
    const [twTarget] = await h.db.select().from(schema.relayTargets).where(and(eq(schema.relayTargets.stationId, id), eq(schema.relayTargets.platformId, `${id}-tw`)));
    const [ytTarget] = await h.db.select().from(schema.relayTargets).where(and(eq(schema.relayTargets.stationId, id), eq(schema.relayTargets.platformId, `${id}-yt`)));
    lp.calls.length = 0;
    h.clock.set(planned.at.toISOString());
    await runner.checkRestarts();
    const toggles = lp.calls.filter((c) => c.method === "PATCH" && c.path.startsWith("/multistream/target/"));
    expect(toggles.map((c) => [c.path, c.body])).toEqual([
      [`/multistream/target/${twTarget.livepeerTargetId}`, { disabled: true }],
      [`/multistream/target/${twTarget.livepeerTargetId}`, { disabled: false }]
    ]);
    expect(lp.calls.some((c) => c.path.includes(ytTarget.livepeerTargetId!))).toBe(false);
    expect(lp.calls.some((c) => c.path.startsWith("/stream"))).toBe(false);
    const [done] = await h.db.select().from(schema.relayRestarts).where(eq(schema.relayRestarts.id, planned.id));
    expect(done).toMatchObject({ status: "done" });
    const [after] = await h.db.select().from(schema.relayTargets).where(eq(schema.relayTargets.id, twTarget.id));
    expect(after.broadcastStartedAt?.toISOString()).toBe(planned.at.toISOString());
    // A pasted Twitch key: nothing asked of the platforms module.
    expect(p.calls.filter((c) => c.includes("-tw"))).toEqual([]);
    const log = (await kai.get(`/v1/stations/${id}/relay/restarts`).expect(200)).body as Array<{ status: string; label: string }>;
    expect(log[0]).toMatchObject({ status: "done" });
    expect(log[0].label).toMatch(/^Twitch restarted Thursday at .*, during a break$/);
    await runner.stopAll();
  });

  it("a connected YouTube saving its relays rolls about every 11 hours: the next broadcast is made before the current one ends", async () => {
    const id = await station("ROLL");
    const p = fakePlatforms();
    p.dests.set(id, [yt(id), tw(id)]);
    await kai.patch(`/v1/stations/${id}/relay`, { mode: "everything", saveYoutubeVideos: true }).expect(200);
    const { runner } = runnerFor(p.seam);
    await runner.tick();
    const [target] = await h.db.select().from(schema.relayTargets).where(and(eq(schema.relayTargets.stationId, id), eq(schema.relayTargets.platformId, `${id}-yt`)));
    await h.db.update(schema.relayTargets).set({ broadcastStartedAt: new Date(Date.parse("2026-10-01T19:00:00Z") - 11 * H - 60_000), broadcastId: "bc-first" }).where(eq(schema.relayTargets.id, target.id));
    lp.calls.length = 0;
    await runner.checkRestarts();
    // No break left before 11 hours: now (it says so), well inside the 12.
    const [row] = await h.db.select().from(schema.relayRestarts).where(and(eq(schema.relayRestarts.stationId, id), eq(schema.relayRestarts.reason, "save_video")));
    expect(row).toMatchObject({ reason: "save_video", method: "new_broadcast", status: "done", duringBreak: false });
    // The order: the next broadcast first, the push moved to it, then the last one ended.
    expect(p.calls).toEqual([`prepare:${id}-yt`, `end:${id}-yt:bc-first`]);
    const patches = lp.calls.filter((c) => c.path === `/multistream/target/${target.livepeerTargetId}`).map((c) => c.body);
    expect(patches).toEqual([{ disabled: true }, { url: "rtmp://a.rtmp.youtube.com/live2/yt-next-1" }, { disabled: false }]);
    const [after] = await h.db.select().from(schema.relayTargets).where(eq(schema.relayTargets.id, target.id));
    expect(after.broadcastId).toBe("bc-1");
    await runner.stopAll();
  });

  it("Facebook with a pasted key: the station is told when a restart is due", async () => {
    const id = await station("FBKY");
    const p = fakePlatforms();
    p.dests.set(id, [fb(id)]);
    await kai.patch(`/v1/stations/${id}/relay`, { mode: "everything" }).expect(200);
    const { runner } = runnerFor(p.seam);
    await runner.tick();
    await h.db.update(schema.relayTargets).set({ broadcastStartedAt: new Date(Date.parse("2026-10-01T19:00:00Z") - 7.9 * H) }).where(eq(schema.relayTargets.stationId, id));
    lp.calls.length = 0;
    await runner.checkRestarts();
    const [row] = await h.db.select().from(schema.relayRestarts).where(and(eq(schema.relayRestarts.stationId, id), eq(schema.relayRestarts.status, "due")));
    expect(row).toMatchObject({ automatic: false, method: "remind", status: "due" });
    expect(lp.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    await h.deps.bus.settle();
    const notices = (await kai.get("/v1/me/notices").expect(200)).body as Array<{ kind: string; title: string; body: string }>;
    expect(notices.find((n) => n.title === "Restart your stream on Facebook")?.body).toMatch(/^Facebook needs a restart by Thursday at /);
    await runner.stopAll();
  });

  it("direct fan-out: only that platform's push restarts", async () => {
    const id = await station("DRCT");
    const p = fakePlatforms();
    p.dests.set(id, [yt(id, false), tw(id)]);
    await kai.patch(`/v1/stations/${id}/relay`, { mode: "everything" }).expect(200);
    const { runner, outputs } = runnerFor(p.seam, { fanOut: "direct" });
    await runner.tick();
    expect(outputs.get(id)!.dests.map((d) => d.id).sort()).toEqual([`${id}-tw`, `${id}-yt`]);
    await h.db.update(schema.relayTargets).set({ broadcastStartedAt: new Date(Date.parse("2026-10-01T19:00:00Z") - 48 * H + 60_000) }).where(and(eq(schema.relayTargets.stationId, id), eq(schema.relayTargets.platformId, `${id}-tw`)));
    await runner.checkRestarts();
    expect(outputs.get(id)!.restarts).toEqual([`${id}-tw`]);
    expect(lp.calls.filter((c) => c.path.startsWith("/multistream") || c.path.startsWith("/stream"))).toHaveLength(0);
    await runner.stopAll();
  });
});

describe("health and failure", () => {
  it("a relay that stops tells the station and the Network desk; the channel carries on", async () => {
    const id = await station("DOWN");
    await itemFixture(h, id, { title: "DOWN ident", code: "SID", durationMs: 4_000, location: await dummyFile() });
    const show = await itemFixture(h, id, { title: "Show", durationMs: 40_000, location: await dummyFile() });
    await kai.post(`/v1/stations/${id}/log`, { kind: "program", startsAt: "2026-10-01T19:00:00.000Z", endsAt: "2026-10-01T19:02:00.000Z", itemId: show.id }).expect(201);
    const engine = createEngine({ deps: h.deps, services: h.services }, { transcoder: fakeTranscoder(), log: () => undefined });
    const p = fakePlatforms();
    p.dests.set(id, [tw(id)]);
    await kai.patch(`/v1/stations/${id}/relay`, { mode: "everything" }).expect(200);
    const { runner, outputs } = runnerFor(p.seam, { alertAfterMs: 20 });
    const played = async () => (await h.services.playout.playlist(id, "v720.m3u8"))?.body ?? "";
    for (let i = 0; i < 5; i++) {
      h.clock.advance(1_000);
      await engine.tick();
      await prepareQueued(h, engine.preparer);
    }
    const before = await played();
    expect(before).toContain("#EXTINF");

    // Sending, then nothing: stopped.
    await runner.tick();
    outputs.get(id)!.sent = 5_000;
    await runner.tick();
    await new Promise((r) => setTimeout(r, 40));
    await runner.tick();
    await h.deps.bus.settle();
    const view = RelayView.parse((await kai.get(`/v1/stations/${id}/relay`).expect(200)).body);
    expect(view.status).toBe("stopped");
    for (const who of [kai, desk]) {
      const notices = (await who.get("/v1/me/notices").expect(200)).body as Array<{ kind: string; title: string; body: string }>;
      expect(notices.find((n) => n.kind === "relay" && n.title === "DOWN's relays stopped")?.body).toMatch(/Your channel is still on air on Opencast/);
    }
    const health = runner.health({ instance: "test", leader: true });
    expect(health.stations.find((s) => s.stationId === id)).toMatchObject({ status: "stopped", platforms: 1, bytesSent: 5_000 });

    // The channel: still on air, still assembling.
    for (let i = 0; i < 5; i++) {
      h.clock.advance(1_000);
      await engine.tick();
    }
    const [state] = await h.db.select().from(schema.playoutState).where(eq(schema.playoutState.stationId, id));
    expect(state.onAir).toBe(true);
    expect((await played()).split("#EXTINF").length).toBeGreaterThanOrEqual(before.split("#EXTINF").length);

    // Bytes again: back.
    outputs.get(id)!.sent = 9_000;
    await runner.tick();
    await h.deps.bus.settle();
    expect(RelayView.parse((await kai.get(`/v1/stations/${id}/relay`).expect(200)).body).status).toBe("relaying");
    expect(((await desk.get("/v1/me/notices").expect(200)).body as Array<{ title: string }>).some((n) => n.title === "DOWN's relays are back")).toBe(true);
    await runner.stopAll();
    await engine.stopAll();
  }, 30_000); // Several relay ticks and the bus: slow on CI runners.
});

describe("the Translators page's API", () => {
  it("an operator sees the relay setting but can't change it (it's billed); an owner can", async () => {
    const id = await station("OPER");
    const op = await h.signIn("Otto");
    await h.db.insert(schema.stationMemberships).values({ stationId: id, userId: op.id, role: "operator" });
    const seen = RelayView.parse((await op.get(`/v1/stations/${id}/relay`).expect(200)).body);
    expect(seen.canManage).toBe(false);
    await op.patch(`/v1/stations/${id}/relay`, { mode: "everything" }).expect(403);
    expect(RelayView.parse((await kai.get(`/v1/stations/${id}/relay`).expect(200)).body).canManage).toBe(true);
  });

  it("relay mode, the break setting, the bug, hours and cost this month from billing; owners and operators only", async () => {
    const id = await station("PAGE");
    const view = RelayView.parse((await kai.get(`/v1/stations/${id}/relay`).expect(200)).body);
    expect(view).toMatchObject({ mode: "live_only", breakHandling: "air_spots", bugOnRelays: true, saveYoutubeVideos: false, status: "off", platforms: [], nextRestarts: [] });
    expect(view.month).toMatchObject({ month: "2026-10", hours: 0, soFarMicros: 0 });
    // Relayed hours this month come from the Station account (sessions the relay recorded).
    await h.db.insert(schema.translatorSessions).values({ translatorId: id, stationId: id, mode: "copy", relayMode: "everything", platforms: 2, startedAt: at("2026-10-01T02:00:00Z"), endedAt: at("2026-10-01T05:00:00Z"), updatedAt: at("2026-10-01T05:00:00Z") });
    await h.db.insert(schema.translatorSessions).values({ translatorId: id, stationId: id, mode: "copy", relayMode: "live_only", platforms: 1, startedAt: at("2026-10-01T06:00:00Z"), endedAt: at("2026-10-01T07:00:00Z"), updatedAt: at("2026-10-01T07:00:00Z") });
    await h.services.billing.meterDay("2026-10-01", h.clock.now());
    const month = RelayView.parse((await kai.get(`/v1/stations/${id}/relay`).expect(200)).body).month;
    expect(month.hours).toBeCloseTo(3, 5);
    expect(month.liveOnlyHours).toBeCloseTo(1, 5);
    expect(month.priceMicros).toBe(200_000);

    const stranger = await h.signIn("Stranger");
    await stranger.get(`/v1/stations/${id}/relay`).expect(404);
    await kai.patch(`/v1/stations/${id}/relay`, { mode: "nope" }).expect(400);
  });
});
