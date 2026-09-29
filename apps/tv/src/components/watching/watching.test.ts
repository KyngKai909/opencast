import { afterEach, describe, expect, it } from "vitest";
import type { DialRowX } from "../../api/ext";
import { bandTarget, lastOnBand, otherBand, rememberOnBand } from "./bands";
import { keyHintsHidden, readFirstUse, recordFirstUse, visibleHints, WEEK_MS } from "./hintRow";
import { canPledge, menuItems, savedText, stationsText, toggledCaptions } from "./menu";
import { airState, backTime, canSuggest, identText, signOnAt, signOnDay, suggestion, type Row } from "./offAir";
import { byRef, pledgePath, pledgeRoute, pledgeUrl, shownUrl } from "./pledge";
import { firstKey, nowLine, okAction, saveOnDevice, sixSlots, stripCommand } from "./presetStrip";
import { cardText, reminderCard, switchDue } from "./reminders";
import { sleepCommand, sleepOptions } from "./sleep";
import { watchCommand, type WatchState } from "./watchCommands";

const T = Date.parse("2026-09-27T03:42:00Z"); // 8:42 pm in the market

function row(callSign: string, channel: string, o: Partial<Row> & { kind?: Row["station"]["kind"]; band?: "tv" | "radio" } = {}): Row & DialRowX {
  const { kind = "station", band = "tv", ...rest } = o;
  return {
    station: { id: callSign, kind, callSign, handle: callSign.toLowerCase(), name: `${callSign} name`, colour: null, band, channel, marketSlug: "inland-empire", homeCity: null },
    onAir: true,
    now: { logEntryId: null, title: `${callSign} now`, episodeTitle: null, code: "PGM", kind: "program", startsAt: "2026-09-27T03:00:00Z", endsAt: "2026-09-27T04:00:00Z", live: false, carriedFrom: null, programId: null },
    next: null,
    playback: { kind: "hls", url: `/x/${callSign}.m3u8` },
    ...rest
  } as Row & DialRowX;
}

const off = (r: Row & DialRowX): Row & DialRowX => ({ ...r, onAir: false, playback: null });

describe("off air: the station to offer instead", () => {
  const dial = [row("CIVC", "7.1"), row("RDLS", "9.1", { kind: "listed", playback: { kind: "embed", url: "/city" } }), row("BEAT", "12.1"), row("SAZN", "18.1"), row("REEL", "24.1"), row("PREP", "31.1")];

  it("is the nearest on-air station up the dial, skipping listed city streams", () => {
    const rows = [off(dial[0]!), ...dial.slice(1)];
    expect(suggestion(rows, "CIVC")?.station.callSign).toBe("BEAT");
  });

  it("looks up the dial first when both directions are as near", () => {
    const rows = [dial[0]!, dial[1]!, dial[2]!, off(dial[3]!), dial[4]!, dial[5]!];
    expect(suggestion(rows, "SAZN")?.station.callSign).toBe("REEL");
  });

  it("goes down the dial when nothing above is on, and skips stations standing by", () => {
    const rows = [dial[0]!, dial[1]!, { ...dial[2]!, signal: "standby" as const }, dial[3]!, off(dial[4]!), off(dial[5]!)];
    expect(suggestion(rows, "PREP")?.station.callSign).toBe("SAZN");
    expect(canSuggest(rows[2]!)).toBe(false);
  });

  it("offers the other band only when this band has nothing on, and nothing when nothing is on", () => {
    const radio = row("NITE", "88.4", { band: "radio" });
    expect(suggestion([off(dial[0]!), off(dial[2]!), radio], "CIVC")?.station.callSign).toBe("NITE");
    expect(suggestion([off(dial[0]!), off(dial[2]!)], "CIVC")).toBeNull();
    expect(suggestion([dial[0]!], "nope")).toBeNull();
  });

  it("says when the station signs on: the end of its off-air block, or its next airing", () => {
    const block = { ...row("CIVC", "7.1").now!, kind: "off_air" as const, endsAt: "2026-09-27T13:00:00Z" };
    expect(signOnAt({ ...off(dial[0]!), now: block })).toBe("2026-09-27T13:00:00Z");
    const next = { ...row("CIVC", "7.1").now!, startsAt: "2026-09-27T04:30:00Z" };
    expect(signOnAt({ ...off(dial[0]!), now: null, next })).toBe("2026-09-27T04:30:00Z");
    expect(signOnAt({ ...off(dial[0]!), now: null, next: null })).toBeNull();
  });

  it("planned off air (G9): the row's backAt, then the off air airing's; the player's own word comes first", () => {
    const block = { ...row("CIVC", "7.1").now!, kind: "off_air" as const, code: "OPEN" as const, endsAt: "2026-09-27T13:00:00Z", backAt: "2026-09-27T13:30:00Z" };
    expect(signOnAt({ ...off(dial[0]!), now: block })).toBe("2026-09-27T13:30:00Z");
    const planned = { ...off(dial[0]!), now: block, backAt: "2026-09-27T14:00:00Z" };
    expect(signOnAt(planned)).toBe("2026-09-27T14:00:00Z");
    // A stream that signed off says when it's back, in its sign-off tag.
    expect(backTime(planned, { stationId: planned.station.id, backAt: "2026-09-27T12:00:00Z" })).toBe("2026-09-27T12:00:00Z");
    expect(backTime(planned, { stationId: "someone-else", backAt: "2026-09-27T12:00:00Z" })).toBe("2026-09-27T14:00:00Z");
    expect(backTime(planned, { stationId: planned.station.id, backAt: null })).toBe("2026-09-27T14:00:00Z");
  });

  it("names the day only when the sign-on isn't in the day ahead", () => {
    const now = new Date(T);
    expect(signOnDay("2026-09-27T13:00:00Z", now, "America/Los_Angeles")).toBeNull();
    expect(signOnDay("2026-09-30T02:00:00Z", now, "America/Los_Angeles")).toBe("Tuesday");
  });

  it("shows off air when the dial or the player says so, stand by only when the dial says standby", () => {
    expect(airState(off(dial[0]!), "playing")).toBe("off_air");
    expect(airState(dial[0]!, "off_air")).toBe("off_air");
    expect(airState({ ...dial[0]!, signal: "standby" }, "playing")).toBe("standby");
    expect(airState({ ...dial[0]!, signal: "ok" }, "playing")).toBeNull();
    expect(airState(undefined, "idle")).toBeNull();
  });

  it("keeps the ident on one line", () => {
    expect(identText(dial[4]!.station)).toBe("REEL 24.1");
  });
});

describe("the reminder card and switch me over", () => {
  const r = (id: string, startsAt: string, switchMeOver = false, station = "BEAT") => ({
    id,
    switchMeOver,
    airing: { title: "Beat Tape Live", startsAt, station: row(station, "12.1").station, listed: false, logEntryId: id, listedAiringId: null }
  });
  const nine = "2026-09-27T04:00:00Z";
  const at = (hhmmss: string) => Date.parse(`2026-09-27T0${hhmmss}Z`);

  it("comes up a minute before the start and goes two minutes after", () => {
    expect(reminderCard([r("a", nine)], at("3:58:59"), "CIVC", new Set())).toBeNull();
    expect(reminderCard([r("a", nine)], at("3:59:00"), "CIVC", new Set())?.id).toBe("a");
    expect(reminderCard([r("a", nine)], at("4:01:59"), "CIVC", new Set())?.id).toBe("a");
    expect(reminderCard([r("a", nine)], at("4:02:00"), "CIVC", new Set())).toBeNull();
  });

  it("isn't shown on the station itself, or once waved away", () => {
    expect(reminderCard([r("a", nine)], at("3:59:30"), "BEAT", new Set())).toBeNull();
    expect(reminderCard([r("a", nine)], at("3:59:30"), "CIVC", new Set(["a"]))).toBeNull();
  });

  it("switches over at the start, once, within five minutes", () => {
    const list = [r("a", nine, true), r("b", nine, false)];
    expect(switchDue(list, at("3:59:59"), new Set())).toBeNull();
    expect(switchDue(list, at("4:00:00"), new Set())?.id).toBe("a");
    expect(switchDue(list, at("4:00:00"), new Set(["a"]))).toBeNull();
    expect(switchDue(list, at("4:05:00"), new Set())).toBeNull();
  });

  it("says what's starting where", () => {
    expect(cardText(r("a", nine))).toBe("Beat Tape Live is starting on BEAT 12.1.");
  });
});

describe("the sleep timer's choices", () => {
  const now = Date.parse("2026-09-27T06:52:00Z"); // 11:52 pm

  it("gives each choice the time it ends, End of this program first", () => {
    const o = sleepOptions(now, "2026-09-27T07:00:00Z");
    expect(o.map((x) => x.label)).toEqual(["End of this program", "30 min", "60 min", "90 min", "Off"]);
    expect(o.map((x) => x.endsAt && new Date(x.endsAt).toISOString())).toEqual(["2026-09-27T07:00:00.000Z", "2026-09-27T07:22:00.000Z", "2026-09-27T07:52:00.000Z", "2026-09-27T08:22:00.000Z", null]);
  });

  it("leaves out End of this program when there's no end still to come", () => {
    expect(sleepOptions(now, null)[0]!.label).toBe("30 min");
    expect(sleepOptions(now, "2026-09-27T06:00:00Z")).toHaveLength(4);
  });

  it("sends the player what it takes", () => {
    expect(sleepCommand("end_of_program")).toBe("end_of_program");
    expect(sleepCommand(60)).toBe(60);
    expect(sleepCommand("off")).toBeNull();
  });
});

describe("the presets strip", () => {
  const beat = row("BEAT", "12.1");
  const slots = sixSlots([
    { key: 1, stationId: "BEAT", row: beat },
    { key: 4, stationId: "REEL", row: row("REEL", "24.1") }
  ]);

  it("has six keys, empty where nothing is saved, and opens on the channel on now", () => {
    expect(slots.map((s) => s.stationId)).toEqual(["BEAT", null, null, "REEL", null, null]);
    expect(firstKey(slots, "REEL")).toBe(4);
    expect(firstKey(slots, "SAZN")).toBe(1);
  });

  it("OK tunes a full key and saves to an empty one; held, it replaces a full one", () => {
    expect(okAction(slots[0]!, false, "SAZN")).toBe("tune");
    expect(okAction(slots[1]!, false, "SAZN")).toBe("save");
    expect(okAction(slots[0]!, true, "SAZN")).toBe("save");
    expect(okAction(slots[0]!, true, "BEAT")).toBe("tune");
    expect(okAction(slots[1]!, false, null)).toBe("none");
  });

  it("takes 1 to 6, a phone's keys and a held OK; everything else goes on", () => {
    expect(stripCommand({ type: "digit", digit: 4 }, slots, 1, "SAZN")).toEqual({ do: "tune", key: 4 });
    expect(stripCommand({ type: "digit", digit: 2 }, slots, 1, "SAZN")).toEqual({ do: "nothing" });
    expect(stripCommand({ type: "digit", digit: 9 }, slots, 1, "SAZN")).toEqual({ do: "nothing" });
    expect(stripCommand({ type: "preset", key: 1 }, slots, 1, "SAZN")).toEqual({ do: "tune", key: 1 });
    expect(stripCommand({ type: "savePreset", key: 3 }, slots, 1, "SAZN")).toEqual({ do: "save", key: 3 });
    expect(stripCommand({ type: "select", hold: true }, slots, 4, "SAZN")).toEqual({ do: "save", key: 4 });
    expect(stripCommand({ type: "select" }, slots, 4, "SAZN")).toBeNull();
    expect(stripCommand({ type: "focus", dir: "left" }, slots, 4, "SAZN")).toBeNull();
    expect(stripCommand({ type: "back" }, slots, 4, "SAZN")).toBeNull();
  });

  it("saves on this TV: the station leaves any other key, the key's old station goes", () => {
    expect(saveOnDevice({ 1: "BEAT", 2: "CIVC" }, 2, "BEAT")).toEqual({ 2: "BEAT" });
    expect(saveOnDevice({ 1: "BEAT" }, 3, "SAZN")).toEqual({ 1: "BEAT", 3: "SAZN" });
  });

  it("says what's on on each key", () => {
    expect(nowLine(beat)).toEqual({ live: false, text: "BEAT now" });
    expect(nowLine({ ...beat, now: { ...beat.now!, live: true } })).toEqual({ live: true, text: "BEAT now" });
    expect(nowLine(off(beat))).toEqual({ live: false, text: "Off air" });
    expect(nowLine(null)).toBeNull();
  });
});

describe("the watching screen's commands", () => {
  const base: WatchState = { fading: false, stopped: false, tvApp: true, card: false, typing: false, airShown: false, currentId: "CIVC", flip: false };

  it("leaves the picture's commands to the player", () => {
    expect(watchCommand({ type: "select" }, base)).toBeNull();
    expect(watchCommand({ type: "channel", dir: "up" }, base)).toBeNull();
    expect(watchCommand({ type: "back" }, base)).toBeNull();
  });

  it("OK during the sleep fade is 30 more minutes; after the timer, OK starts again on the TV app", () => {
    expect(watchCommand({ type: "select" }, { ...base, fading: true, card: true })).toEqual({ do: "moreTime" });
    expect(watchCommand({ type: "select" }, { ...base, stopped: true })).toEqual({ do: "restart" });
    expect(watchCommand({ type: "select" }, { ...base, stopped: true, tvApp: false })).toBeNull();
  });

  it("the reminder card takes OK and Back, but not while a number is typed", () => {
    expect(watchCommand({ type: "select" }, { ...base, card: true })).toEqual({ do: "switch" });
    expect(watchCommand({ type: "back" }, { ...base, card: true })).toEqual({ do: "wave" });
    expect(watchCommand({ type: "select" }, { ...base, card: true, typing: true })).toBeNull();
    expect(watchCommand({ type: "channel", dir: "down" }, { ...base, card: true })).toBeNull();
  });

  it("off air: ◀ ▶ move between the buttons, ▲ ▼ still change channel (flipped by the setting), OK presses", () => {
    const air = { ...base, airShown: true };
    expect(watchCommand({ type: "focus", dir: "right" }, air)).toEqual({ do: "focus", dir: "right" });
    expect(watchCommand({ type: "focus", dir: "up" }, air)).toEqual({ do: "channel", dir: "up" });
    expect(watchCommand({ type: "focus", dir: "up" }, { ...air, flip: true })).toEqual({ do: "channel", dir: "down" });
    expect(watchCommand({ type: "select" }, air)).toEqual({ do: "press" });
    expect(watchCommand({ type: "back" }, air)).toBeNull();
    expect(watchCommand({ type: "digit", digit: 2 }, air)).toBeNull();
  });

  it("Android TV app: the remote's Back with no last channel leaves for the TV's home, unless a card or a number is up", () => {
    const leaving = { ...base, exitable: true };
    expect(watchCommand({ type: "last" }, leaving)).toEqual({ do: "exit" });
    // Off air takes the arrows, so Back arrives as back.
    expect(watchCommand({ type: "back" }, { ...leaving, airShown: true })).toEqual({ do: "exit" });
    expect(watchCommand({ type: "back" }, { ...leaving, card: true })).toEqual({ do: "wave" });
    expect(watchCommand({ type: "last" }, { ...leaving, typing: true })).toBeNull();
    // With a last channel (or in a browser, or from a phone) Back is the last channel, as before.
    expect(watchCommand({ type: "last" }, base)).toBeNull();
  });

  it("a phone's + saves what's on", () => {
    expect(watchCommand({ type: "savePreset", key: 5 }, base)).toEqual({ do: "savePreset", key: 5 });
    expect(watchCommand({ type: "savePreset", key: 5 }, { ...base, currentId: null })).toBeNull();
  });
});

describe("the menu rail", () => {
  it("has every item on the TV app, in order, with Sleep timer after Presets", () => {
    expect(menuItems({ mode: "tv", station: { kind: "station" } })).toEqual(["guide", "presets", "sleep", "band", "market", "captions", "settings", "pledge", "account"]);
  });

  it("leaves settings and the account to the phone on a Cast receiver or a mirrored iPhone", () => {
    expect(menuItems({ mode: "cast", station: { kind: "station" } })).toEqual(["guide", "presets", "sleep", "band", "pledge"]);
    expect(menuItems({ mode: "mirror", station: null })).toEqual(["guide", "presets", "sleep", "band"]);
  });

  it("has the Pledge line only for stations that take pledges", () => {
    expect(canPledge({ kind: "listed" })).toBe(false);
    expect(canPledge({ kind: "claimable" })).toBe(false);
    expect(menuItems({ mode: "tv", station: { kind: "listed" } })).not.toContain("pledge");
  });

  it("toggles captions on and off, and counts", () => {
    expect(toggledCaptions("off")).toBe("on");
    expect(toggledCaptions("on")).toBe("off");
    expect(toggledCaptions("muted_only")).toBe("on");
    expect(savedText(5)).toBe("5 saved");
    expect(savedText(null)).toBeNull();
    expect(stationsText(1)).toBe("1 station");
    expect(stationsText(4)).toBe("4 stations");
  });
});

describe("crossing bands", () => {
  afterEach(() => localStorage.clear());
  const rows = [row("CIVC", "7.1"), off(row("NITE", "88.4", { band: "radio" })), row("HALL", "90.8", { band: "radio" }), row("CRAT", "102.0", { band: "radio" })];

  it("goes to the station last heard on the band, else the first on the air", () => {
    expect(bandTarget(rows, "radio", null)?.station.callSign).toBe("HALL");
    expect(bandTarget(rows, "radio", "CRAT")?.station.callSign).toBe("CRAT");
    expect(bandTarget(rows, "radio", "GONE")?.station.callSign).toBe("HALL");
    expect(bandTarget(rows, "tv", null)?.station.callSign).toBe("CIVC");
    expect(bandTarget([], "radio", null)).toBeNull();
  });

  it("remembers the last station on each band, and crosses to the other", () => {
    rememberOnBand("radio", "CRAT");
    rememberOnBand("tv", "BEAT");
    expect(lastOnBand("radio")).toBe("CRAT");
    expect(lastOnBand("tv")).toBe("BEAT");
    expect(otherBand(rows[2])).toBe("tv");
    expect(otherBand(rows[0])).toBe("radio");
    expect(otherBand(undefined)).toBe("radio");
  });
});

describe("the hint row", () => {
  afterEach(() => localStorage.clear());
  const hints = [
    { kind: "key" as const, key: "OK", label: "Guide" },
    { kind: "chip" as const, label: "Playing from Kai's phone", detail: "Change channel on your phone" }
  ];

  it("hides the key hints after a week of use, never the chip", () => {
    expect(keyHintsHidden(null, T)).toBe(false);
    expect(keyHintsHidden(T - WEEK_MS + 1, T)).toBe(false);
    expect(keyHintsHidden(T - WEEK_MS, T)).toBe(true);
    expect(visibleHints(hints, true)).toEqual([hints[1]]);
    expect(visibleHints(hints, false)).toEqual(hints);
  });

  it("notes the first use once", () => {
    recordFirstUse(1000);
    recordFirstUse(2000);
    expect(readFirstUse()).toBe(1000);
  });
});

describe("pledge by QR", () => {
  const beat = row("BEAT", "12.1").station;

  it("opens the viewer's pledge page for the station, by handle or call sign", () => {
    expect(pledgePath(beat)).toBe("/beat/pledge");
    expect(pledgePath({ ...beat, handle: null })).toBe("/beat/pledge");
    expect(pledgeRoute(beat)).toBe("/pledge/beat");
    expect(pledgeUrl("https://useopencast.org/", beat)).toBe("https://useopencast.org/beat/pledge");
    expect(shownUrl("https://www.useopencast.org", beat)).toBe("useopencast.org/beat/pledge");
  });

  it("finds the station on the dial by id, call sign or handle, in any case", () => {
    const rows = [row("CIVC", "7.1"), row("BEAT", "12.1")];
    expect(byRef(rows, "beat")?.station.callSign).toBe("BEAT");
    expect(byRef(rows, "CIVC")?.station.callSign).toBe("CIVC");
    expect(byRef(rows, "nope")).toBeNull();
  });
});
