import { describe, expect, it } from "vitest";
import type { AiringX, StationIdentX } from "../../api/ext";
import type { EpisodeX, WhereToWatch } from "../../api/ext/station";
import { carriedByText, episodeLine, episodeState, episodeWindow, episodesMeta, primaryAction, primaryLabel, whereAction, whereLines } from "./program";

const TZ = "America/Los_Angeles";
const NOW = new Date("2026-09-27T03:42:00Z");
const pt = (day: number, hh: number, mm = 0) => new Date(Date.UTC(2026, 8, day, hh + 7, mm)).toISOString();

const st = (callSign: string, channel: string): StationIdentX => ({ id: callSign, kind: "station", callSign, handle: callSign.toLowerCase(), name: callSign, colour: "#8C3B7A", band: "tv", channel, marketSlug: "inland-empire", homeCity: null });
const air = (start: string, end: string): AiringX => ({ logEntryId: `${start}`, title: "Saturday Reel", episodeTitle: null, code: "PGM", kind: "program", startsAt: start, endsAt: end, live: false, carriedFrom: null, programId: "p" });
const BEAT = st("BEAT", "12.1");
const REEL = st("REEL", "24.1");
const SAZN = st("SAZN", "18.1");

const beat: WhereToWatch = { station: BEAT, slot: "Saturdays at 8:30 pm", now: air(pt(26, 20, 30), pt(26, 21)), next: null };
const reel: WhereToWatch = { station: REEL, slot: "Saturdays, all day", now: air(pt(26, 20), pt(26, 21)), next: null };
const sazn: WhereToWatch = { station: SAZN, slot: "Weekly", now: null, next: air(pt(27, 9), pt(27, 9, 30)) };

describe("the program page's primary button", () => {
  it("tunes where it's on now, in channel order", () => {
    const p = primaryAction([reel, sazn, beat]);
    expect(p?.kind).toBe("tune");
    expect(p && primaryLabel(p)).toBe("Tune in to BEAT 12.1, on now");
  });

  it("prefers the station you're already tuned to", () => {
    const p = primaryAction([reel, sazn, beat], "REEL");
    expect(p && primaryLabel(p)).toBe("Tune in to REEL 24.1, on now");
  });

  it("is Remind me for the next airing when it isn't on anywhere now", () => {
    const later: WhereToWatch = { ...reel, now: null, next: air(pt(33, 20), pt(33, 20, 30)) };
    const p = primaryAction([later, sazn]);
    expect(p?.kind).toBe("remind");
    expect(p?.row.station.callSign).toBe("SAZN");
    expect(p && primaryLabel(p)).toBe("Remind me");
  });

  it("is nothing when it isn't scheduled in the market", () => {
    expect(primaryAction([])).toBeNull();
    expect(primaryAction([{ ...sazn, next: null }])).toBeNull();
  });
});

describe("Where to watch", () => {
  it("reads each row as the frame does", () => {
    expect(whereLines(beat, "REEL", NOW, TZ)).toEqual({ title: "Now, until 9:00 pm", sub: "Saturdays at 8:30 pm" });
    expect(whereLines(reel, "REEL", NOW, TZ)).toEqual({ title: "Saturdays, all day", sub: "Its own station" });
    expect(whereLines(sazn, "REEL", NOW, TZ)).toEqual({ title: "Sunday at 9:00 am", sub: "Weekly" });
  });

  it("signs the row the primary button tunes to, and offers Tune in or Remind me on the rest", () => {
    const p = primaryAction([beat, reel, sazn]);
    expect(whereAction(beat, p)).toBe("on-now");
    expect(whereAction(reel, p)).toBe("tune");
    expect(whereAction(sazn, p)).toBe("remind");
    expect(whereAction({ ...sazn, next: null }, p)).toBeNull();
  });

  it("counts carriers in words", () => {
    expect(carriedByText(12)).toBe("Carried by 12 stations");
    expect(carriedByText(1)).toBe("Carried by 1 station");
    expect(episodesMeta(40, 30 * 60e3)).toBe("40 episodes of 30 minutes");
    expect(episodesMeta(0, null)).toBeNull();
  });
});

describe("episodes", () => {
  const ep = (n: number, o: Partial<EpisodeX> = {}): EpisodeX => ({ id: String(n), title: `Episode ${n}`, episodeNumber: n, durationMs: null, ...o });
  const at = (s: StationIdentX, start: string) => ({ station: s, airing: air(start, start) });

  it("says when each one airs", () => {
    expect(episodeLine(ep(13, { aired: true, lastAiring: at(REEL, pt(26, 20)) }), NOW, TZ)).toBe("Last aired tonight on REEL, 8:00 pm");
    expect(episodeLine(ep(14, { aired: true, onNow: at(BEAT, pt(26, 20, 30)) }), NOW, TZ)).toBe("On BEAT now");
    expect(episodeLine(ep(15, { nextAiring: at(SAZN, pt(27, 9)) }), NOW, TZ)).toBe("Next: SAZN, Sunday 9:00 am");
    expect(episodeLine(ep(16, { nextAiring: at(REEL, pt(33, 20)) }), NOW, TZ)).toBe("Next: REEL, October 3, 8:00 pm");
    expect(episodeLine(ep(17), NOW, TZ)).toBe("Not scheduled yet");
  });

  it("shows the last aired, the one on now and what's next", () => {
    const list = Array.from({ length: 40 }, (_, i) => {
      const n = i + 1;
      if (n === 14) return ep(n, { aired: true, onNow: at(BEAT, pt(26, 20, 30)) });
      if (n === 15) return ep(n, { nextAiring: at(SAZN, pt(27, 9)) });
      return ep(n, { aired: n < 14 });
    });
    expect(episodeWindow(list).map((e) => e.episodeNumber)).toEqual([13, 14, 15, 16, 17]);
    expect(list.map(episodeState).slice(12, 17)).toEqual(["aired", "now", "next", "unscheduled", "unscheduled"]);
    expect(episodeWindow(list.slice(0, 3))).toHaveLength(3);
  });
});
