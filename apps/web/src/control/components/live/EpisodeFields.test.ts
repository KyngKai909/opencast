// Programming Phase 2: a program's episode, in words, on its library page.

import { describe, expect, it, vi } from "vitest";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { episodeWords } from "./EpisodeFields";

describe("episode words", () => {
  it("say the season, episode and part it has", () => {
    expect(episodeWords({ seasonNumber: 2, episodeNumber: 5, partOf: null, partNumber: null })).toBe("Season 2, episode 5");
    expect(episodeWords({ seasonNumber: null, episodeNumber: 5, partOf: null, partNumber: null })).toBe("Episode 5");
    expect(episodeWords({ seasonNumber: 2, episodeNumber: null })).toBe("Season 2");
    expect(episodeWords({ seasonNumber: 1, episodeNumber: 8, partOf: "The Long Night", partNumber: 2 })).toBe("Season 1, episode 8. Part 2 of The Long Night");
    expect(episodeWords({ episodeNumber: null, partOf: "The Long Night", partNumber: null })).toBe("A part of The Long Night");
    expect(episodeWords({ episodeNumber: null })).toBe("Not numbered");
  });
});
