import { describe, expect, it } from "vitest";
import { guessEpisode, nextEpisode, nextEpisodes, type PlaybackOrder, type WalkEpisode } from "../src/index.js";

// A program's episodes: "a1" is episode 1, added a day apart unless said.
const ep = (id: string, n: number | null, more: Partial<WalkEpisode> = {}): WalkEpisode => ({ id, programId: "A", episodeNumber: n, seasonNumber: null, createdAt: Date.UTC(2026, 0, 1 + (n ?? 0)), ...more });
const series = (prefix: string, count: number, programId = "A") => Array.from({ length: count }, (_, i) => ep(`${prefix}${i + 1}`, i + 1, { programId }));
const ids = (airings: Array<{ episodes: WalkEpisode[] }>) => airings.map((a) => a.episodes.map((e) => e.id).join("+"));
const walk = (episodes: WalkEpisode[], order: PlaybackOrder, position: string[] | number, count: number, seed = "slot-1") => ids(nextEpisodes({ episodes, order, seed, position }, count));

describe("the walker, any order", () => {
  it("has nothing for an empty program", () => {
    for (const order of ["in_order", "newest_first", "shuffle", "shuffle_shows", "marathon"] as const) {
      expect(nextEpisode({ episodes: [], order, seed: "s", position: [] })).toBeNull();
      expect(nextEpisodes({ episodes: [], order, seed: "s", position: 4 }, 3)).toEqual([]);
    }
  });

  it("has nothing when nothing is ready", () => {
    expect(nextEpisode({ episodes: series("a", 3).map((e) => ({ ...e, ready: false })), order: "in_order", seed: "s", position: [] })).toBeNull();
  });

  it("is deterministic: the same inputs give the same airings", () => {
    const eps = series("a", 9);
    for (const order of ["in_order", "newest_first", "shuffle", "marathon"] as const) {
      expect(walk(eps, order, ["a3", "a7"], 12)).toEqual(walk([...eps].reverse(), order, ["a3", "a7"], 12));
    }
  });

  it("takes a count as the airings it would have made", () => {
    const eps = series("a", 5);
    for (const order of ["in_order", "newest_first", "shuffle", "marathon"] as const) {
      const first = walk(eps, order, [], 8);
      expect(walk(eps, order, 3, 5)).toEqual(first.slice(3, 8));
      expect(walk(eps, order, first.slice(0, 3), 5)).toEqual(first.slice(3, 8));
    }
  });
});

describe("In order", () => {
  it("goes by season, then episode, then date added", () => {
    const eps = [
      ep("s2e1", 1, { seasonNumber: 2 }),
      ep("s1e2", 2, { seasonNumber: 1 }),
      ep("s1e1", 1, { seasonNumber: 1 }),
      ep("extra-new", null, { seasonNumber: 1, createdAt: Date.UTC(2026, 5, 2) }),
      ep("extra-old", null, { seasonNumber: 1, createdAt: Date.UTC(2026, 5, 1) })
    ];
    expect(walk(eps, "in_order", [], 5)).toEqual(["s1e1", "s1e2", "extra-old", "extra-new", "s2e1"]);
  });

  it("picks up after the last airing, then starts over", () => {
    const eps = series("a", 4);
    const airings = nextEpisodes({ episodes: eps, order: "in_order", seed: "s", position: ["a1", "a2"] }, 4);
    expect(ids(airings)).toEqual(["a3", "a4", "a1", "a2"]);
    expect(airings.map((a) => [a.cycle, a.endsCycle])).toEqual([[0, false], [0, true], [1, false], [1, false]]);
  });

  it("counts a program's pieces around breaks as one airing", () => {
    expect(walk(series("a", 3), "in_order", ["a1", "a1", "a1", "a2", "a2"], 1)).toEqual(["a3"]);
  });

  it("airs an episode added partway through when the walk reaches it", () => {
    const eps = series("a", 4);
    // a1 to a3 aired, then a5 was uploaded.
    expect(walk([...eps, ep("a5", 5)], "in_order", ["a1", "a2", "a3"], 4)).toEqual(["a4", "a5", "a1", "a2"]);
    // An earlier episode added late comes at the end of this time round, not after a3.
    expect(walk([...eps, ep("a2b", 2, { createdAt: Date.UTC(2026, 2, 1) })], "in_order", ["a1", "a2", "a3"], 3)).toEqual(["a4", "a2b", "a1"]);
  });

  it("passes over an episode that isn't ready, and owes it", () => {
    const eps = series("a", 5);
    const notReady = eps.map((e) => (e.id === "a3" ? { ...e, ready: false } : e));
    expect(walk(notReady, "in_order", ["a1", "a2"], 1)).toEqual(["a4"]);
    // Ready again: it airs before the walk starts over, without anything repeating.
    expect(walk(eps, "in_order", ["a1", "a2", "a4"], 4)).toEqual(["a5", "a3", "a1", "a2"]);
    // Still not ready at the end: the walk starts over, and it airs this time round.
    expect(walk(notReady, "in_order", ["a1", "a2", "a4", "a5"], 2)).toEqual(["a1", "a2"]);
  });

  it("walks a mix of programs by taking turns", () => {
    const eps = [...series("a", 3, "A"), ...series("b", 2, "B")];
    expect(walk(eps, "in_order", [], 6)).toEqual(["a1", "b1", "a2", "b2", "a3", "a1"]);
  });
});

describe("Newest first", () => {
  it("airs the newest not yet aired, then back through the rest", () => {
    expect(walk(series("a", 4), "newest_first", [], 5)).toEqual(["a4", "a3", "a2", "a1", "a4"]);
  });

  it("airs a new episode next, then carries on", () => {
    // a4 and a3 aired, then a5 was uploaded.
    expect(walk([...series("a", 4), ep("a5", 5)], "newest_first", ["a4", "a3"], 4)).toEqual(["a5", "a2", "a1", "a5"]);
  });

  it("passes over an episode that isn't ready", () => {
    const eps = series("a", 4).map((e) => (e.id === "a4" ? { ...e, ready: false } : e));
    expect(walk(eps, "newest_first", [], 2)).toEqual(["a3", "a2"]);
    expect(walk(series("a", 4), "newest_first", ["a3", "a2"], 2)).toEqual(["a4", "a1"]);
  });
});

describe("Shuffle", () => {
  const eps = series("a", 8);

  it("airs every episode once before any repeats, in a new order each time round", () => {
    const run = walk(eps, "shuffle", [], 24);
    for (const cycle of [run.slice(0, 8), run.slice(8, 16), run.slice(16, 24)]) expect([...cycle].sort()).toEqual(eps.map((e) => e.id).sort());
    expect(run.slice(0, 8)).not.toEqual(run.slice(8, 16));
    // Not back to back where one time round meets the next.
    expect(run[7]).not.toBe(run[8]);
    expect(run[15]).not.toBe(run[16]);
  });

  it("shuffles by the seed", () => {
    expect(walk(eps, "shuffle", [], 8, "slot-1")).toEqual(walk(eps, "shuffle", [], 8, "slot-1"));
    expect(walk(eps, "shuffle", [], 8, "slot-1")).not.toEqual(walk(eps, "shuffle", [], 8, "slot-2"));
  });

  it("fits an episode added partway through into this time round, without moving the rest", () => {
    const before = walk(eps, "shuffle", [], 8);
    const aired = before.slice(0, 3);
    const after = walk([...eps, ep("a9", 9)], "shuffle", aired, 6);
    expect(after).toContain("a9");
    expect(after.filter((id) => id !== "a9")).toEqual(before.slice(3, 8));
  });

  it("passes over an episode that isn't ready, and airs it this time round once it is", () => {
    const order = walk(eps, "shuffle", [], 8);
    const missing = order[2];
    const without = eps.map((e) => (e.id === missing ? { ...e, ready: false } : e));
    const aired = walk(without, "shuffle", [], 4);
    expect(aired).toEqual(order.filter((id) => id !== missing).slice(0, 4));
    const rest = walk(eps, "shuffle", aired, 4);
    expect([...aired, ...rest].sort()).toEqual(eps.map((e) => e.id).sort());
  });
});

describe("Shuffle shows, keep each in order", () => {
  const eps = [...series("a", 6, "A"), ...series("b", 6, "B"), ...series("c", 6, "C")];

  it("keeps each program's episodes in order, and shuffles which program airs", () => {
    const run = walk(eps, "shuffle_shows", [], 18);
    for (const p of ["a", "b", "c"]) expect(run.filter((id) => id.startsWith(p))).toEqual([1, 2, 3, 4, 5, 6].map((n) => `${p}${n}`));
    // Each round of three airs each program once, in a shuffled order.
    const rounds = [0, 3, 6, 9, 12, 15].map((i) => run.slice(i, i + 3).map((id) => id[0]).join(""));
    for (const r of rounds) expect([...r].sort().join("")).toBe("abc");
    expect(new Set(rounds).size).toBeGreaterThan(1);
  });

  it("carries on from what aired", () => {
    const run = walk(eps, "shuffle_shows", [], 10);
    expect(walk(eps, "shuffle_shows", run.slice(0, 4), 6)).toEqual(run.slice(4, 10));
  });

  it("skips a program with nothing ready", () => {
    const run = walk([...series("a", 3, "A"), ...series("b", 3, "B").map((e) => ({ ...e, ready: false }))], "shuffle_shows", [], 4);
    expect(run).toEqual(["a1", "a2", "a3", "a1"]);
  });
});

describe("Marathon", () => {
  it("airs a whole season in a row, then the next; a mix takes turns a season at a time", () => {
    const season = (p: string, s: number, n: number) => ep(`${p}s${s}e${n}`, n, { programId: p.toUpperCase(), seasonNumber: s });
    const eps = [season("a", 1, 1), season("a", 1, 2), season("a", 2, 1), season("b", 1, 1), season("b", 1, 2), season("b", 1, 3), season("b", 2, 1)];
    expect(walk(eps, "marathon", [], 8)).toEqual(["as1e1", "as1e2", "bs1e1", "bs1e2", "bs1e3", "as2e1", "bs2e1", "as1e1"]);
    expect(walk(eps, "marathon", ["as1e1", "as1e2", "bs1e1"], 2)).toEqual(["bs1e2", "bs1e3"]);
  });
});

describe("Multi-part episodes", () => {
  const eps = [
    ep("a1", 1),
    ep("night-2", 3, { partOf: "The Long Night", partNumber: 2 }),
    ep("night-1", 2, { partOf: "the long night ", partNumber: 1 }),
    ep("a4", 4),
    ep("other-1", 5, { programId: "B", partOf: "The Long Night", partNumber: 1 })
  ].filter((e) => e.programId === "A");

  it("air together, in part order, in every order", () => {
    expect(walk(eps, "in_order", [], 3)).toEqual(["a1", "night-1+night-2", "a4"]);
    expect(walk(eps, "newest_first", [], 3)).toEqual(["a4", "night-1+night-2", "a1"]);
    for (const order of ["shuffle", "shuffle_shows", "marathon"] as const) expect(walk(eps, order, [], 3)).toContain("night-1+night-2");
  });

  it("count as one airing in what aired", () => {
    expect(walk(eps, "in_order", ["a1", "night-1", "night-2"], 1)).toEqual(["a4"]);
    // A part aired on its own still counts the episode as aired.
    expect(walk(eps, "in_order", ["a1", "night-2"], 1)).toEqual(["a4"]);
  });

  it("wait while any part isn't ready", () => {
    const notReady = eps.map((e) => (e.id === "night-2" ? { ...e, ready: false } : e));
    expect(walk(notReady, "in_order", ["a1"], 2)).toEqual(["a4", "a1"]);
  });

  it("are only grouped within a program", () => {
    const both = [ep("x", 1, { partOf: "Pilot", partNumber: 1 }), ep("y", 1, { programId: "B", partOf: "Pilot", partNumber: 2 })];
    expect(walk(both, "in_order", [], 2)).toEqual(["x", "y"]);
  });
});

describe("guessing from a file's name", () => {
  const cases: Array<[string, string | null, Partial<ReturnType<typeof guessEpisode>>]> = [
    ["Late.Crate.S02E05.1080p.WEB.mp4", null, { seasonNumber: 2, episodeNumber: 5 }],
    ["late_crate_s2e5.mov", null, { seasonNumber: 2, episodeNumber: 5 }],
    ["Late Crate S02 E05.mp4", null, { seasonNumber: 2, episodeNumber: 5 }],
    ["Late Crate 2x05.mkv", null, { seasonNumber: 2, episodeNumber: 5 }],
    ["Late Crate - Season 2 Episode 5.mp4", null, { seasonNumber: 2, episodeNumber: 5 }],
    ["Late Crate Season 2, Ep. 5.mp4", null, { seasonNumber: 2, episodeNumber: 5 }],
    ["Crate Talk Episode 12.mp3", null, { seasonNumber: null, episodeNumber: 12 }],
    ["Crate Talk Ep 7.wav", null, { seasonNumber: null, episodeNumber: 7 }],
    ["Crate Talk E07.mp4", null, { seasonNumber: null, episodeNumber: 7 }],
    ["show 1920x1080 h264.mp4", null, { seasonNumber: null, episodeNumber: null }],
    ["IMG_4471.MOV", null, { seasonNumber: null, episodeNumber: null, partOf: null }],
    ["Late Crate S01E00 Special.mp4", null, { seasonNumber: 1, episodeNumber: null }],
    ["The.Long.Night.Part.1.mp4", null, { partOf: "The Long Night", partNumber: 1 }],
    ["x.mp4", "The Long Night, Part Two", { partOf: "The Long Night", partNumber: 2 }],
    ["x.mp4", "The Long Night (Pt. 3)", { partOf: "The Long Night", partNumber: 3 }],
    ["x.mp4", "The Long Night Part II", { partOf: "The Long Night", partNumber: 2 }],
    ["x.mp4", "Harvest Moon (2)", { partOf: "Harvest Moon", partNumber: 2 }],
    ["x.mp4", "Part 1", { partOf: null, partNumber: null }],
    ["x.mp4", "The Department of Truth", { partOf: null, partNumber: null }],
    ["x.mp4", "Party Mix 2", { partOf: null, partNumber: null }]
  ];
  it.each(cases)("%s (%s)", (file, title, want) => {
    expect(guessEpisode(file, title)).toMatchObject(want);
  });
});
