// External stations in the player (follow-up Phase 6): a stream link plays in Opencast's player
// straight from the source, an official embed shows the source's own player, and a station whose
// stream is down (off the dial, or its row not playable) is on Stand by for whoever is watching it,
// until it's back. The banner says External, Live and the source, with nothing made up.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { PlayerEngine } from "./PlayerEngine";
import { fakeDriver, flush, station, stubMedia } from "../test-helpers";
import { startHeartbeat } from "../heartbeat";
import { neighbour } from "../dial";
import { Banner } from "../react/Banner";
import type { Channel } from "../types";

const CIVC = station("CIVC", "7.1");
const BEAT = station("BEAT", "12.1");

function external(callSign: string, channel: string, plays: "embed" | "stream_link", source: string): Channel {
  const base = station(callSign, channel, { kind: plays === "embed" ? "embed" : "hls" });
  return {
    ...base,
    station: { ...base.station, kind: "listed", name: `${source} channel` },
    now: null,
    next: null,
    playback: { kind: plays === "embed" ? "embed" : "hls", url: plays === "embed" ? "https://city.example.gov/player" : `https://city.example.gov/${callSign.toLowerCase()}/master.m3u8` },
    external: { source, plays, schedule: "none" }
  };
}

const COLT = external("COLT", "9.2", "stream_link", "City of Colton");
const RDLS = external("RDLS", "9.1", "embed", "City of Redlands");

let engine: PlayerEngine;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  stubMedia();
  host = document.createElement("div");
  engine = new PlayerEngine({ driver: fakeDriver(), warm: "buffer", bannerMs: 5000, numberWaitMs: 2000 });
  engine.attach(host);
  engine.setChannels([CIVC, RDLS, COLT, BEAT]);
});
afterEach(() => {
  engine.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("external stations in the player", () => {
  it("play a stream link in Opencast's player, from the source's own address", async () => {
    const t = engine.tune(COLT.station.id);
    await flush(10);
    await t;
    expect(engine.getState()).toMatchObject({ currentId: COLT.station.id, status: "playing" });
    expect([...host.querySelectorAll("video")].some((v) => (v as HTMLVideoElement).dataset.station === COLT.station.id)).toBe(true);
  });

  it("show an official embed as the source's player (no picture of Opencast's own to wait for)", async () => {
    await engine.tune(RDLS.station.id);
    expect(engine.getState()).toMatchObject({ currentId: RDLS.station.id, status: "embed" });
  });

  it("go to Stand by for whoever's watching when the station leaves the dial, and come back when it's back", async () => {
    const t = engine.tune(COLT.station.id);
    await flush(10);
    await t;
    // The dial refreshes without it (its stream down 5 minutes).
    engine.setChannels([CIVC, RDLS, BEAT]);
    expect(engine.getState()).toMatchObject({ currentId: COLT.station.id, status: "standby" });
    // Still on the player's list while you're on it (for Stand by, and to change channel from)...
    expect(engine.getState().channels.map((c) => c.station.callSign)).toEqual(["CIVC", "RDLS", "BEAT", "COLT"]);
    expect(neighbour(engine.getState().channels, COLT.station.id, "up")?.station.callSign).toBe("BEAT");
    // ...and gone from everyone else's swipe order.
    expect(neighbour([CIVC, RDLS, BEAT], RDLS.station.id, "up")?.station.callSign).toBe("BEAT");
    // A refresh while it's still down changes nothing.
    engine.setChannels([CIVC, RDLS, BEAT]);
    expect(engine.getState().status).toBe("standby");
    // Back on the dial: it tunes in again by itself.
    engine.setChannels([CIVC, RDLS, COLT, BEAT]);
    await flush(50);
    expect(engine.getState()).toMatchObject({ currentId: COLT.station.id, status: "playing" });
  });

  it("go to Stand by when the row says the stream isn't playable, and an embed comes back too", async () => {
    await engine.tune(RDLS.station.id);
    engine.setChannels([CIVC, { ...RDLS, onAir: false, playback: null }, COLT, BEAT]);
    expect(engine.getState()).toMatchObject({ currentId: RDLS.station.id, status: "standby" });
    engine.setChannels([CIVC, RDLS, COLT, BEAT]);
    await flush(10);
    expect(engine.getState()).toMatchObject({ currentId: RDLS.station.id, status: "embed" });
  });

  it("are on Stand by, never Off air, when tuned while down; other stations are untouched", async () => {
    engine.setChannels([CIVC, { ...COLT, onAir: false, playback: null }, BEAT]);
    await engine.tune(COLT.station.id);
    expect(engine.getState().status).toBe("standby");
    const t = engine.tune(CIVC.station.id);
    await flush(1000);
    await t;
    expect(engine.getState()).toMatchObject({ currentId: CIVC.station.id, status: "playing" });
    // A full station leaving the dial isn't this (it's the dial's business).
    engine.setChannels([RDLS, BEAT]);
    expect(engine.getState().status).toBe("playing");
  });

  it("count an embed's time on screen in the heartbeat, as tuned-in time", async () => {
    const send = vi.fn().mockResolvedValue({ nextInMs: 30_000 });
    const stop = startHeartbeat(engine, send, "web", "11111111-1111-4111-8111-111111111111");
    await engine.tune(RDLS.station.id);
    await flush(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ stationId: RDLS.station.id, playing: true, mediaTimeMs: 0 });
    await flush(30_000);
    expect(send.mock.calls[1][0]).toMatchObject({ stationId: RDLS.station.id, playing: true, mediaTimeMs: 30_000 });
    stop();
  });
});

describe("the banner on an external station", () => {
  const now = new Date("2026-09-27T03:42:00Z");

  it("with nothing scheduled: the station's name, External beside its call sign, and no progress bar", () => {
    const { container } = render(<Banner channel={COLT} size="tv" now={now} timeZone="America/Los_Angeles" onAirHere />);
    expect(container.querySelector("h3")?.textContent).toBe("City of Colton channel");
    expect(container.querySelector(".oc-banner__csrow .oc-tag--listed")?.textContent).toBe("External");
    expect(container.querySelector(".oc-banner__cs")?.textContent).toBe("COLT");
    // 2026-10-04: no "Live from {source}" line; it only said the name again.
    expect(container.querySelector(".oc-banner__src")).toBeNull();
    expect(container.querySelector("[role=progressbar]")).toBeNull();
  });

  it("with the source's own schedule: its title and a progress bar", () => {
    const meeting = { ...COLT, now: { logEntryId: null, title: "City Council, regular meeting", episodeTitle: null, code: "PGM" as const, kind: "listed" as const, startsAt: "2026-09-27T03:00:00Z", endsAt: "2026-09-27T05:00:00Z", live: true, carriedFrom: null, programId: null } };
    const { container } = render(<Banner channel={meeting} size="web" now={now} timeZone="America/Los_Angeles" onAirHere />);
    expect(container.querySelector("h3")?.textContent).toBe("City Council, regular meeting");
    expect(container.querySelector(".oc-tag--listed")?.textContent).toBe("External");
    expect(container.querySelector("[role=progressbar]")).not.toBeNull();
  });
});
