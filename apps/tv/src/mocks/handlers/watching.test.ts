import { describe, expect, it } from "vitest";
import type { DialRowX } from "../../api/ext";
import { nextSixAm, patchRow } from "./watching";

const t = new Date("2026-09-27T03:42:00Z"); // 8:42 pm Pacific

function row(callSign: string, o: Partial<DialRowX> = {}): DialRowX {
  return {
    station: { id: callSign, kind: "station", callSign, handle: callSign.toLowerCase(), name: callSign, colour: null, band: "tv", channel: "7.1", marketSlug: "inland-empire", homeCity: null },
    onAir: true,
    now: { logEntryId: null, title: "Town Hall", episodeTitle: null, code: "PGM", kind: "live", startsAt: "2026-09-27T03:00:00Z", endsAt: "2026-09-27T04:30:00Z", live: true, carriedFrom: null, programId: null },
    next: { logEntryId: null, title: "Planning Commission", episodeTitle: null, code: "PGM", kind: "program", startsAt: "2026-09-27T04:30:00Z", endsAt: "2026-09-27T06:00:00Z", live: false, carriedFrom: null, programId: null },
    playback: { kind: "hls", url: "/x.m3u8" },
    ...o
  } as DialRowX;
}

const none = { offAir: [], standby: [] };

describe("the watching screen's mock dial", () => {
  it("finds the next 6:00 am in the market", () => {
    expect(nextSixAm(t)).toBe("2026-09-27T13:00:00.000Z");
    expect(nextSixAm(new Date("2026-09-27T14:00:00Z"))).toBe("2026-09-28T13:00:00.000Z");
  });

  it("leaves an on-air row alone, with its signal ok", () => {
    const r = patchRow(row("CIVC"), t, none);
    expect(r.onAir).toBe(true);
    expect(r.signal).toBe("ok");
    expect(r.now?.title).toBe("Town Hall");
  });

  it("signs a station off with the switch as planned off air (G9): until its next airing or 6:00 am, whichever is sooner", () => {
    const later = row("CIVC", { next: { ...row("X").next!, startsAt: "2026-09-30T02:00:00Z" } });
    const off = patchRow(later, t, { offAir: ["CIVC"], standby: [] });
    expect(off).toMatchObject({ onAir: false, backAt: "2026-09-27T13:00:00.000Z", now: { kind: "off_air", code: "OPEN", title: "Off air", endsAt: "2026-09-27T13:00:00.000Z", backAt: "2026-09-27T13:00:00.000Z" } });
    expect(patchRow(row("CIVC"), t, { offAir: ["CIVC"], standby: [] }).backAt).toBe("2026-09-27T04:30:00Z");
  });

  it("leaves a gap between airings as the API does: nothing on, no back time", () => {
    const gap = patchRow(row("CIVC", { onAir: false, now: null, playback: null }), t, none);
    expect(gap.now).toBeNull();
    expect("backAt" in gap).toBe(false);
  });

  it("takes a station off the air, or puts it on stand by, from the address's switches", () => {
    const offAir = patchRow(row("CIVC"), t, { offAir: ["CIVC"], standby: [] });
    expect(offAir).toMatchObject({ onAir: false, playback: null, now: { kind: "off_air" } });
    // S13: no signal at all when the station isn't on air.
    expect("signal" in offAir).toBe(false);
    expect(patchRow(row("CIVC"), t, { offAir: [], standby: ["CIVC"] }).signal).toBe("standby");
    expect(patchRow(row("BEAT"), t, { offAir: ["CIVC"], standby: ["CIVC"] }).signal).toBe("ok");
  });
});
