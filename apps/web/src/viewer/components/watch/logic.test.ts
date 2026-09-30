import { describe, expect, it } from "vitest";
import type { AiringX, DialRowX } from "../../api/ext";
import { backAtOf, bandHint, isOffAir, liveRest, listingText, nextMidnight, resolveStation, stationSlug, swipeChannel, swipePreview, tonightRows, tuneForUrl, urlForChannel, watchKey } from "./logic";

const TZ = "America/Los_Angeles";
// Saturday, September 26, 2026 at 8:42 pm in Redlands (UTC−7).
const NOW = new Date("2026-09-27T03:42:00Z");
const pt = (hhmm: string, dayOffset = 0) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 8, 26 + dayOffset, h! + 7, m!)).toISOString();
};

function row(id: string, callSign: string, channel: string, band: "tv" | "radio"): DialRowX {
  return {
    station: { id, kind: "station", callSign, handle: callSign.toLowerCase(), name: callSign, colour: "#33507A", band, channel, marketSlug: "inland-empire", homeCity: "Redlands" },
    onAir: true,
    now: null,
    next: null,
    playback: null
  } as DialRowX;
}

const DIAL = [row("c", "CIVC", "7.1", "tv"), row("r", "RDLS", "9.1", "tv"), row("b", "BEAT", "12.1", "tv"), row("n", "NITE", "88.4", "radio"), row("h", "HALL", "90.8", "radio"), row("x", "CRAT", "102.0", "radio"), row("v", "VOZE", "104.4", "radio")];

function airing(title: string, start: string, end: string, o: Partial<AiringX> = {}): AiringX {
  return { logEntryId: title, title, episodeTitle: null, code: "PGM", kind: "program", startsAt: start, endsAt: end, live: false, carriedFrom: null, programId: null, note: null, listedAiringId: null, ...o };
}

describe("the station a URL names", () => {
  it("matches by call sign, handle or id, in any case", () => {
    expect(resolveStation(DIAL, "beat")?.station.id).toBe("b");
    expect(resolveStation(DIAL, "BEAT")?.station.id).toBe("b");
    expect(resolveStation(DIAL, "b")?.station.id).toBe("b");
    expect(resolveStation(DIAL, "nope")).toBeNull();
  });
  it("writes the call sign in lower case", () => {
    expect(stationSlug(DIAL[2]!.station)).toBe("beat");
  });
});

describe("keeping the URL in step with the channel", () => {
  it("tunes to the URL's station unless it's already on", () => {
    expect(tuneForUrl("b", "c")).toBe("b");
    expect(tuneForUrl("b", "b")).toBeNull();
    expect(tuneForUrl(null, "c")).toBeNull();
  });
  it("leaves the URL alone until the page has read its own", () => {
    // Arriving from another page with CIVC still playing: the URL (BEAT) wins, not CIVC.
    expect(urlForChannel("c", null)).toBeNull();
  });
  it("follows a channel change once it has", () => {
    expect(urlForChannel("s", "b")).toBe("s");
    expect(urlForChannel("b", "b")).toBeNull();
  });
  it("walks through arriving, then pressing up, without tuning twice", () => {
    let last: string | null = null;
    let playing: string | null = "c";
    // The page opens on /watch/beat.
    const tune = tuneForUrl("b", playing);
    expect(tune).toBe("b");
    last = "b";
    playing = "b";
    expect(urlForChannel(playing, last)).toBeNull();
    // Arrow up: the player moves to SAZN, so the URL does.
    playing = "s";
    const nav = urlForChannel(playing, last);
    expect(nav).toBe("s");
    last = nav;
    // The new URL names what's already on: nothing more to tune.
    expect(tuneForUrl("s", playing)).toBeNull();
  });
});

describe("the swipe on the picture", () => {
  it("needs a real vertical movement", () => {
    expect(swipeChannel(-30, 200)).toBeNull();
    expect(swipeChannel(-56, 200)).toBe("up");
    expect(swipeChannel(60, 200)).toBe("down");
  });
  it("scales with a tall picture", () => {
    // 22% of 400px is 88px.
    expect(swipeChannel(-80, 400)).toBeNull();
    expect(swipeChannel(-90, 400)).toBe("up");
  });
  it("ignores a sideways drag", () => {
    expect(swipeChannel(-70, 200, 120)).toBeNull();
  });
  it("shows the next channel as soon as the finger moves", () => {
    expect(swipePreview(-5)).toBeNull();
    expect(swipePreview(-14)).toBe("up");
    expect(swipePreview(20)).toBe("down");
  });
});

describe("the radio band's hint", () => {
  it("says where down wraps at the bottom of the band", () => {
    expect(bandHint(DIAL, "n")).toBe("Down wraps to 104.4, up is 90.8");
  });
  it("says where up wraps at the top", () => {
    expect(bandHint(DIAL, "v")).toBe("Down is 102.0, up wraps to 88.4");
  });
  it("stays in the band", () => {
    expect(bandHint(DIAL, "h")).toBe("Down is 88.4, up is 102.0");
  });
});

describe("tonight's rows", () => {
  const SCH = [
    airing("Crate Session 02", pt("18:00"), pt("20:00")),
    airing("Late Crate, ep. 14", pt("20:00"), pt("20:30")),
    airing("Saturday Reel", pt("20:30"), pt("21:00")),
    airing("Beat Tape Live", pt("21:00"), pt("22:00")),
    airing("Late Crate, ep. 15", pt("22:00"), pt("23:00")),
    airing("Slow Hours", pt("23:00"), pt("24:00")),
    airing("Late Crate, eps. 12 to 15", pt("24:00"), pt("26:00"))
  ];
  it("midnight is in the market's zone", () => {
    expect(nextMidnight(NOW, TZ).toISOString()).toBe("2026-09-27T07:00:00.000Z");
  });
  it("web: one before, now, then until midnight", () => {
    expect(tonightRows(SCH, NOW, { before: 1, timeZone: TZ }).map((a) => a.title)).toEqual(["Late Crate, ep. 14", "Saturday Reel", "Beat Tape Live", "Late Crate, ep. 15", "Slow Hours"]);
  });
  it("phone: from now", () => {
    expect(tonightRows(SCH, NOW, { before: 0, timeZone: TZ }).map((a) => a.title)).toEqual(["Saturday Reel", "Beat Tape Live", "Late Crate, ep. 15", "Slow Hours"]);
  });
  it("an all-night program shows the morning, not tomorrow evening", () => {
    const radio = [airing("Radio dramas", pt("20:00"), pt("30:00")), airing("Morning desk", pt("30:00"), pt("44:00")), airing("Radio dramas", pt("44:00"), pt("54:00"))];
    expect(tonightRows(radio, NOW, { before: 0, timeZone: TZ }).map((a) => a.title)).toEqual(["Radio dramas", "Morning desk"]);
  });
  it("late at night it still shows what's after now", () => {
    const late = new Date(pt("23:30"));
    expect(tonightRows(SCH, late, { before: 0, timeZone: TZ }).map((a) => a.title)).toEqual(["Slow Hours", "Late Crate, eps. 12 to 15"]);
  });
});

describe("words around Live", () => {
  it("splits a leading Live off a note", () => {
    expect(liveRest("Live from the Redlands studio")).toEqual({ live: true, rest: "from the Redlands studio" });
    expect(liveRest("Beat showcase")).toEqual({ live: false, rest: "Beat showcase" });
    expect(liveRest("Lively beats")).toEqual({ live: false, rest: "Lively beats" });
  });
  it("puts the note first and doesn't repeat it", () => {
    expect(listingText("Live from the Redlands studio", "Producers play unreleased tapes and talk through how they were made. Live from the Redlands studio.")).toBe(
      "Live from the Redlands studio. Producers play unreleased tapes and talk through how they were made."
    );
    expect(listingText(null, "One producer, one crate.")).toBe("One producer, one crate.");
  });
});

describe("planned off air (G9)", () => {
  const off = { logEntryId: "o", title: "Off air", episodeTitle: null, code: "OPEN", kind: "off_air", startsAt: pt("23:00"), endsAt: pt("06:00", 1), live: false, carriedFrom: null, programId: null, backAt: pt("06:30", 1) } as AiringX;
  const later = { ...off, title: "Morning", code: "PGM", kind: "program", startsAt: pt("07:00", 1), endsAt: pt("08:00", 1), backAt: undefined } as AiringX;
  it("says when the station is back: the player's word, then the dial's backAt, the off air airing's, then its next airing", () => {
    const r = { ...row("p", "PREP", "31.1", "tv"), onAir: false, now: off, next: later };
    expect(isOffAir(off)).toBe(true);
    expect(isOffAir(later)).toBe(false);
    expect(backAtOf(r)).toBe(pt("06:30", 1));
    expect(backAtOf({ ...r, backAt: pt("06:15", 1) })).toBe(pt("06:15", 1));
    expect(backAtOf(r, { stationId: "p", backAt: pt("05:00", 1) }, "p")).toBe(pt("05:00", 1));
    expect(backAtOf(r, { stationId: "q", backAt: pt("05:00", 1) }, "p")).toBe(pt("06:30", 1));
    expect(backAtOf({ ...r, now: null })).toBe(pt("07:00", 1));
    expect(backAtOf({ ...r, now: null, next: null })).toBeNull();
  });
});

describe("the tuned-in page's keys", () => {
  const press = (key: string, target: Element | null = document.body, o: Partial<KeyboardEvent> = {}) =>
    watchKey({ key, target, defaultPrevented: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...o });

  it("▲ ▼ change channel, space or k pause and resume, l or End go back to live", () => {
    expect(press("ArrowUp")).toEqual({ type: "channel", dir: "up" });
    expect(press("ArrowDown")).toEqual({ type: "channel", dir: "down" });
    expect(press(" ")).toEqual({ type: "togglePlay" });
    expect(press("k")).toEqual({ type: "togglePlay" });
    expect(press("l")).toEqual({ type: "backToLive" });
    expect(press("End")).toEqual({ type: "backToLive" });
    expect(press("x")).toBeNull();
  });

  it("with the same guards: modifiers, text fields, dialogs and menus", () => {
    expect(press("l", document.body, { shiftKey: true })).toBeNull();
    expect(press("End", document.body, { metaKey: true })).toBeNull();
    expect(press("l", document.body, { defaultPrevented: true })).toBeNull();
    const input = document.createElement("input");
    expect(press("l", input)).toBeNull();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inside = dialog.appendChild(document.createElement("button"));
    expect(press("End", inside)).toBeNull();
  });

  it("l and End work from a focused button (only the space bar presses it); End leaves a slider alone", () => {
    const button = document.createElement("button");
    expect(press("l", button)).toEqual({ type: "backToLive" });
    expect(press("End", button)).toEqual({ type: "backToLive" });
    expect(press(" ", button)).toBeNull();
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    expect(press("End", slider)).toBeNull();
  });
});
