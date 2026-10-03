// A244: a station's programming blocks on its page ("Blocks"), and a block's band in the guide's rows.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { nextLine, programList, StationBlocks } from "./StationBlocks";
import { gridRows } from "../guide/logic";

const LCN = { id: "00000000-0000-4000-8000-0000000b1001", name: "Late Crate Nights", description: "Records after dark.", logoUrl: null, colour: "#1F5C99", schedule: "Saturdays, 9:00 pm to 1:00 am", next: "2026-10-11T04:00:00.000Z", programs: ["Saturday Reel", "Late Crate"] };

describe("the station page's Blocks", () => {
  it("says when each airs next and what's in it", () => {
    expect(programList(["Saturday Reel", "Late Crate"])).toBe("Saturday Reel and Late Crate");
    expect(programList(["A", "B", "C"])).toBe("A, B and C");
    expect(nextLine(LCN, "America/Los_Angeles")).toBe("Next: Sat Oct 10, Saturday Reel and Late Crate");
  });

  it("draws a card per block, and nothing without any", () => {
    render(<StationBlocks blocks={[LCN]} timeZone="America/Los_Angeles" />);
    expect(screen.getByRole("heading", { name: "Late Crate Nights" })).toBeTruthy();
    expect(screen.getByText("Saturdays, 9:00 pm to 1:00 am")).toBeTruthy();
    expect(screen.getByText("Next: Sat Oct 10, Saturday Reel and Late Crate")).toBeTruthy();
    const { container } = render(<StationBlocks blocks={undefined} timeZone="America/Los_Angeles" />);
    expect(container.textContent).toBe("");
  });
});

describe("the guide's rows", () => {
  it("carry a station's blocks as bands", () => {
    const station = { id: "s1", kind: "station", callSign: "BEAT", handle: null, name: "Inland Beat", colour: null, band: "tv", channel: "12.1", marketSlug: "inland-empire", homeCity: null };
    const rows = gridRows({ market: { id: "m", slug: "inland-empire", name: "Inland Empire", timezone: "America/Los_Angeles", open: true }, from: "2026-10-04T03:00:00.000Z", to: "2026-10-04T06:00:00.000Z", rows: [{ station, airings: [], blocks: [{ id: LCN.id, name: LCN.name, colour: LCN.colour, logoUrl: null, startsAt: "2026-10-04T04:00:00.000Z", endsAt: "2026-10-04T08:00:00.000Z" }] }] } as never);
    expect(rows[0]!.blocks).toEqual([{ id: LCN.id, name: "Late Crate Nights", start: "2026-10-04T04:00:00.000Z", end: "2026-10-04T08:00:00.000Z", colour: "#1F5C99" }]);
  });
});
