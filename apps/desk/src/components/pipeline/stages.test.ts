// The pipeline's rules on the frame's creators (network-desk 02.1): the strip's counts, each row's
// Station and Next words, its button, and the order.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatorX } from "../../api/ext";
import { actionFor, needsAction, nextLine, pipelineOrder, stageCounts, stationCell, STRIP, type Ctx } from "./stages";

const NOW = new Date("2026-09-27T03:42:12Z");
let all: CreatorX[];
const held = new Map([["95.5", "GOSP"], ["41.1", "TACO"]]);
const ctx: Ctx = { now: NOW, timeZone: "America/Los_Angeles", held };
const by = (name: string) => all.find((c) => c.displayName === name)!;

beforeAll(() => vi.useFakeTimers({ toFake: ["Date"], now: NOW }));
beforeEach(async () => {
  localStorage.clear();
  const db = await import("../../mocks/db");
  db.resetDb();
  all = db.getDb().creators.filter((c) => c.marketId === "00000000-0000-4000-8000-000000000001").map(db.creatorView);
});

describe("the stage strip", () => {
  it("counts as drawn: 6 found, 2 already licensed, 3 asked, 4 said yes, 1 setting up, 1 on air, 3 claimed", () => {
    const counts = stageCounts(all);
    expect(STRIP.map((s) => `${counts[s.stage]} ${s.label}`)).toEqual(["6 Found", "2 Already licensed", "3 Asked", "4 Said yes", "1 Setting up", "1 On air, not claimed", "3 Claimed"]);
    expect(counts.declined).toBe(1);
  });

  it("moves a creator from one count to the next", () => {
    const skate = by("Desert Skate Films");
    const next = all.map((c) => (c === skate ? { ...c, stage: "asked" as const } : c));
    expect(stageCounts(next)).toMatchObject({ found: 5, asked: 4 });
  });
});

describe("each row", () => {
  it("reads the frame's Station and Next words", () => {
    const row = (n: string) => [stationCell(by(n), held), nextLine(by(n), ctx).text];
    expect(row("Tía Lupe’s Kitchen")).toEqual(["33.1 LUPE", "Signs on Monday, 6:00 am"]);
    expect(row("Desert Skate Films")).toEqual(["38.1 or 45.1", "Ask, with a preview of their station"]);
    expect(row("Mojave Field Recordings")).toEqual(["91.9 FLDR", "On air with credit. Claim invite sent Sept 24"]);
    expect(row("Riverside Poetry Collective")).toEqual(["Radio band", "Reminder due today"]);
    expect(row("Inland Gospel Choirs")).toEqual(["95.5, held", "Waitlist holds 95.5; pick another"]);
    expect(row("Marcus Reyes")).toEqual(["101.9 CRAT", "Claim link sent Sept 20"]);
    expect(row("Sazón family kitchen")).toEqual(["18.1 SAZN", "Claimed August 28. Running it themselves"]);
    expect(row("Inland Jazz Society")).toEqual(["", "Said no Sept 2. Don’t ask again"]);
  });

  it("marks a reminder due today in standby, and one due later quietly", () => {
    expect(nextLine(by("Riverside Poetry Collective"), ctx).due).toBe(true);
    expect(nextLine(by("Rialto Robotics Club"), ctx)).toEqual({ text: "Reminder due October 1", due: false });
  });

  it("offers the frame's buttons, and none for finished rows", () => {
    const label = (n: string) => actionFor(by(n), ctx)?.label ?? null;
    expect(["Tía Lupe’s Kitchen", "Desert Skate Films", "Mojave Field Recordings", "Riverside Poetry Collective", "Inland Gospel Choirs", "Marcus Reyes", "Sazón family kitchen", "Inland Jazz Society"].map(label)).toEqual([
      "Open", "Ask", "Open", "Remind", "Set up", "Open", null, null
    ]);
    // After the one reminder, the next thing is No answer.
    expect(actionFor({ ...by("Riverside Poetry Collective"), remindedAt: "2026-09-26T18:00:00Z" }, ctx)?.label).toBe("No answer");
  });

  it("counts the yeses waiting to be set up, the reminders due and the asks as work to do", () => {
    expect(all.filter((c) => needsAction(c, ctx)).length).toBe(6 + 1 + 4 + 1);
  });
});

describe("the order", () => {
  it("puts due follow-ups first, then new yeses (newest first), finished rows last", () => {
    const names = pipelineOrder(all, ctx).map((c) => c.displayName);
    expect(names[0]).toBe("Riverside Poetry Collective");
    expect(names.slice(1, 6)).toEqual(["Inland Gospel Choirs", "Moreno Valley Mariachi", "Corona Garden Club", "Yucaipa Fiddlers", "Inland Empire Oral Histories"]);
    expect(names.slice(-4)).toEqual(["Inland Jazz Society", "Sazón family kitchen", "Prep Sports Weekly", "Night Shift Radio"]);
  });
});
