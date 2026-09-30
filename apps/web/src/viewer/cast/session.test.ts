import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockSender, type BridgeTransport } from "./mockSender";
import { createRelaySender, type RelayHandlers, type RelayLink } from "./relay";
import { CAST_NAMESPACE, type MockCastMessage } from "./messages";
import type { CastTarget } from "./types";

/** A bridge that records what the phone posts and lets the test play the receiver. */
function fakeBridge() {
  const posted: MockCastMessage[] = [];
  let listener: ((m: MockCastMessage) => void) | null = null;
  let closed = false;
  const transport: BridgeTransport = {
    ready: async () => {},
    post: (m) => void posted.push(m),
    listen: (l) => ((listener = l), () => (listener = null)),
    close: () => void (closed = true)
  };
  return {
    transport,
    posted,
    receiver: (senderId: string | null, data: unknown) => listener?.({ to: "sender", senderId, namespace: CAST_NAMESPACE, data }),
    closed: () => closed
  };
}

const LIVING: CastTarget = { id: "l", name: "Living room TV", kind: "chromecast" };
const INTRO = { from: "Kai's phone", marketSlug: "inland-empire", othersCanChange: true };

describe("dev:mock's Cast sender", () => {
  it("connects, then introduces the phone: the mock channel's connect, then the session message", async () => {
    const b = fakeBridge();
    const sender = createMockSender(() => b.transport, [LIVING]);
    expect(await sender.targets()).toEqual([LIVING]);
    await sender.connect(LIVING, INTRO);
    const id = (b.posted[0] as { senderId: string }).senderId;
    expect(b.posted).toEqual([
      { to: "receiver", senderId: id, kind: "connect", name: "Kai's phone" },
      { to: "receiver", senderId: id, namespace: CAST_NAMESPACE, data: { type: "session", from: "Kai's phone", marketSlug: "inland-empire", othersCanChange: true } }
    ]);
    expect(sender.connected()).toEqual(LIVING);
  });

  it("sends commands naming the phone, and hears the state sent to every phone or to it", async () => {
    const b = fakeBridge();
    const sender = createMockSender(() => b.transport, [LIVING]);
    await sender.connect(LIVING, INTRO);
    const id = (b.posted[0] as { senderId: string }).senderId;
    sender.send({ type: "channel", dir: "up" });
    expect(b.posted[2]).toEqual({ to: "receiver", senderId: id, namespace: CAST_NAMESPACE, data: { type: "channel", dir: "up", from: "Kai's phone" } });

    const states: unknown[] = [];
    sender.onState((s) => states.push(s));
    b.receiver(null, { type: "state", stationId: "r", paused: false, changedBy: "Kai's phone", sleepEndsAt: null });
    b.receiver(id, { type: "state", stationId: "b", paused: true, changedBy: null, sleepEndsAt: null });
    b.receiver("someone-else", { type: "state", stationId: "x", paused: false, changedBy: null, sleepEndsAt: null });
    expect(states).toEqual([
      { stationId: "r", paused: false, changedBy: "Kai's phone", sleepEndsAt: null },
      { stationId: "b", paused: true, changedBy: null, sleepEndsAt: null }
    ]);
  });

  it("introduces itself again when the receiver starts again, and says goodbye on disconnect", async () => {
    const b = fakeBridge();
    const sender = createMockSender(() => b.transport, [LIVING]);
    await sender.connect(LIVING, INTRO);
    b.receiver(null, { type: "receiver-ready" });
    expect(b.posted.slice(2).map((m) => ("kind" in m ? m.kind : (m.data as { type: string }).type))).toEqual(["connect", "session"]);
    const id = (b.posted[0] as { senderId: string }).senderId;
    sender.disconnect();
    expect(b.posted[b.posted.length - 1]).toEqual({ to: "receiver", senderId: id, kind: "disconnect" });
    expect(b.closed()).toBe(true);
    expect(sender.connected()).toBeNull();
    sender.send({ type: "info" });
    expect(b.posted[b.posted.length - 1]).toMatchObject({ kind: "disconnect" });
  });
});

// ---------- The session ----------

const bridge = fakeBridge();
/** The relay's stream for the TV app, played by the test. */
const relay: { on: RelayHandlers | null; sent: unknown[]; link: RelayLink } = {
  on: null,
  sent: [],
  link: {
    open: async (_tvId, _auth, on) => ((relay.on = on), () => (relay.on = null)),
    send: async (_tvId, _auth, command) => void relay.sent.push(command)
  }
};
vi.mock("./sender", () => ({
  getSender: async () => createMockSender(() => bridge.transport, [LIVING]),
  senderFor: async (t: CastTarget) => (t.kind === "tv_app" ? createRelaySender(relay.link) : createMockSender(() => bridge.transport, [LIVING])),
  castOffered: () => true
}));
vi.mock("./mirroring", async (orig) => ({ ...(await orig<typeof import("./mirroring")>()), getMirroring: async () => null }));

describe("the casting session", () => {
  beforeEach(async () => {
    const { resetCastSessionForTests } = await import("./session");
    resetCastSessionForTests();
    bridge.posted.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("tunes the TV to the phone's station when the receiver's answer shows another", async () => {
    const s = await import("./session");
    await s.startCast(LIVING, INTRO, { stationId: "civc", channel: "7.1" });
    const types = () => bridge.posted.map((m) => ("data" in m ? (m.data as { type: string }).type : m.kind));
    expect(types()).toEqual(["connect", "session"]);
    expect(s.getCastSession()).toMatchObject({ status: "casting", target: LIVING, me: "Kai's phone", receiver: null });
    // The answer to the introduction: the TV is on BEAT.
    bridge.receiver(null, { type: "state", stationId: "beat", paused: false, changedBy: "Kai's phone", sleepEndsAt: null });
    expect(types()).toEqual(["connect", "session", "tune"]);
    expect(s.receiverOf(s.getCastSession())?.stationId).toBe("beat");
    bridge.receiver(null, { type: "state", stationId: "civc", paused: false, changedBy: "Kai's phone", sleepEndsAt: null });
    expect(types()).toEqual(["connect", "session", "tune"]);
    expect(s.receiverOf(s.getCastSession())?.stationId).toBe("civc");
    s.stopCasting();
    expect(s.getCastSession()).toEqual({ status: "idle", error: null });
    expect(bridge.posted[bridge.posted.length - 1]).toMatchObject({ kind: "disconnect" });
  });

  it("doesn't tune a TV that's already on the station", async () => {
    const s = await import("./session");
    await s.startCast(LIVING, INTRO, { stationId: "civc", channel: "7.1" });
    bridge.receiver(null, { type: "state", stationId: "civc", paused: false, changedBy: "Kai's phone", sleepEndsAt: null });
    expect(bridge.posted.some((m) => "data" in m && (m.data as { type: string }).type === "tune")).toBe(false);
  });

  it("assumes the station when a receiver doesn't answer", async () => {
    vi.useFakeTimers();
    const s = await import("./session");
    await s.startCast(LIVING, INTRO, { stationId: "civc", channel: "7.1" });
    vi.advanceTimersByTime(s.ASSUME_AFTER_MS);
    expect(bridge.posted[bridge.posted.length - 1]).toMatchObject({ data: { type: "tune", channel: "7.1", from: "Kai's phone" } });
    expect(s.receiverOf(s.getCastSession())).toEqual({ stationId: "civc", paused: false, changedBy: "Kai's phone", sleepEndsAt: null });
  });

  it("goes back to not casting when the receiver ends the session (the sleep timer)", async () => {
    const s = await import("./session");
    await s.startCast(LIVING, INTRO, null);
    expect(s.getCastSession().status).toBe("casting");
    bridge.receiver(null, { type: "session-ended" });
    expect(s.getCastSession()).toEqual({ status: "idle", error: null });
  });

  it("asks again once when the receiver wasn't ready, but never over another phone or its own later command", async () => {
    const { shouldRetune } = await import("./session");
    const st = (stationId: string, changedBy: string | null) => ({ stationId, paused: false, changedBy, sleepEndsAt: null });
    expect(shouldRetune(st("civc", "Kai's phone"), "beat", "Kai's phone", 0, 3000)).toBe(true);
    expect(shouldRetune(st("civc", null), "beat", "Kai's phone", 0, 3000)).toBe(true);
    expect(shouldRetune(st("beat", "Kai's phone"), "beat", "Kai's phone", 0, 3000)).toBe(false);
    expect(shouldRetune(st("rdls", "Dana's phone"), "beat", "Kai's phone", 0, 3000)).toBe(false);
    expect(shouldRetune(st("civc", "Kai's phone"), "beat", "Kai's phone", 0, 9000)).toBe(false);

    const s = await import("./session");
    const tunes = () => bridge.posted.filter((m) => "data" in m && (m.data as { type: string }).type === "tune").length;
    // The receiver was still loading its dial: it answered with nothing, dropped the tune, then put its first station on.
    await s.startCast(LIVING, INTRO, { stationId: "beat", channel: "12.1" });
    bridge.receiver(null, { type: "state", stationId: null, paused: false, changedBy: "Kai's phone", sleepEndsAt: null });
    bridge.receiver(null, { type: "state", stationId: "civc", paused: false, changedBy: "Kai's phone", sleepEndsAt: null });
    expect(tunes()).toBe(2);
    bridge.receiver(null, { type: "state", stationId: "civc", paused: false, changedBy: "Kai's phone", sleepEndsAt: null });
    expect(tunes()).toBe(2);

    // Channel up before the second state: the phone's own command, so no asking again.
    bridge.posted.length = 0;
    await s.startCast(LIVING, INTRO, { stationId: "beat", channel: "12.1" });
    bridge.receiver(null, { type: "state", stationId: "civc", paused: false, changedBy: "Kai's phone", sleepEndsAt: null });
    s.sendToTv({ type: "channel", dir: "up" });
    bridge.receiver(null, { type: "state", stationId: "sazn", paused: false, changedBy: "Kai's phone", sleepEndsAt: null });
    expect(tunes()).toBe(1);
  });

  it("drives the TV app over the relay the same way, and says why when the relay ends it", async () => {
    const s = await import("./session");
    const den: CastTarget = { id: "00000000-0000-4000-8000-0000000c0001", name: "Den TV", kind: "tv_app", online: true };
    await s.startCast(den, INTRO, { stationId: "civc", channel: "7.1" });
    expect(s.getCastSession()).toMatchObject({ status: "casting", target: den, me: "Kai's phone" });
    relay.on!.event({ event: "state", data: { stationId: "beat", paused: false, changedBy: "Den TV", sleepEndsAt: null } });
    expect(relay.sent).toEqual([{ type: "tune", channel: "7.1" }]);
    expect(s.receiverOf(s.getCastSession())?.stationId).toBe("beat");
    s.sendToTv({ type: "channel", dir: "up" });
    expect(relay.sent[1]).toEqual({ type: "channel", dir: "up" });
    relay.on!.event({ event: "ended", data: { reason: "signed_out" } });
    expect(s.getCastSession()).toEqual({ status: "idle", error: "Den TV was signed out." });
  });

  it("the remote's Guide opens the guide on the TV, over the relay and over Cast, and the arrows and OK drive it there", async () => {
    const s = await import("./session");
    const guideKeys = [{ type: "guide" }, { type: "focus", dir: "down" }, { type: "focus", dir: "right" }, { type: "select" }, { type: "back" }] as const;
    // The TV app, through the relay.
    const den: CastTarget = { id: "00000000-0000-4000-8000-0000000c0002", name: "Den TV", kind: "tv_app", online: true };
    relay.sent.length = 0;
    await s.startCast(den, INTRO, null);
    for (const c of guideKeys) s.sendToTv(c);
    await Promise.resolve();
    expect(relay.sent).toEqual(guideKeys);
    s.stopCasting();
    // A Chromecast: the same commands on Opencast's namespace, naming the phone.
    bridge.posted.length = 0;
    await s.startCast(LIVING, INTRO, null);
    for (const c of guideKeys) s.sendToTv(c);
    const sent = bridge.posted.filter((m) => "data" in m && (m.data as { type: string }).type !== "session").map((m) => (m as { data: unknown }).data);
    expect(sent).toEqual(guideKeys.map((c) => ({ ...c, from: "Kai's phone" })));
    s.stopCasting();
  });

  it("follows the mirroring plugin: connected, locked, stopped", async () => {
    const s = await import("./session");
    s.applyMirrorStatus({ connected: true, tvName: "Bedroom TV", lockedAt: null });
    expect(s.getCastSession()).toMatchObject({ status: "mirroring", target: { name: "Bedroom TV", kind: "airplay" } });
    s.setMirrorReceiver({ stationId: "beat", paused: false, changedBy: null, sleepEndsAt: null });
    expect(s.receiverOf(s.getCastSession())?.stationId).toBe("beat");
    s.applyMirrorStatus({ connected: false, tvName: "Bedroom TV", lockedAt: 1000 });
    expect(s.getCastSession()).toMatchObject({ status: "mirror_stopped", lockedAt: 1000 });
    s.applyMirrorStatus({ connected: true, tvName: "Bedroom TV", lockedAt: null });
    expect(s.getCastSession().status).toBe("mirroring");
    s.applyMirrorStatus({ connected: false, tvName: "Bedroom TV", lockedAt: null });
    expect(s.getCastSession().status).toBe("idle");
  });
});
