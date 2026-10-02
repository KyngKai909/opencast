// Settings, Breaks: the bumper sequences (A243), alone and on the mocks. Adding, removing and
// reordering roles by keys (announced), what fills each role under its chip, the empty row, at most
// four, how often each position airs, and BreaksSection saving `bumperSequences` with the rule.

import { useState } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import type { BumperRole, PositionRule } from "@opencast/contracts";

vi.mock("../../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../../mocks/handlers";
import { resetDb } from "../../../mocks/db";
import { breakRuleOf } from "../../../mocks/fixtures/station";
import { BEAT } from "../../../mocks/fixtures/stations";
import { renderWithApi, signInAs, stubMatchMedia } from "../../onair/testing";
import { BreaksSection } from "./BreaksSection";
import { SequenceBuilder } from "./SequenceBuilder";

const supply = (role: BumperRole) => ({ into_break: "None yet, so an Any bumper airs", out_of_break: "1 in your library", up_next: "None yet, so nothing airs", any: "2 in your library" })[role];

function Harness({ start, onSaved }: { start: PositionRule; onSaved?: (r: PositionRule) => void }) {
  const [rule, setRule] = useState(start);
  return (
    <SequenceBuilder
      position="open"
      title="Opening the break"
      rule={rule}
      supply={supply}
      onChange={(r) => {
        setRule(r);
        onSaved?.(r);
      }}
    />
  );
}

const chips = () => within(screen.getByRole("list", { name: "Opening the break, in this order" })).getAllByRole("listitem").map((li) => li.querySelector("b")!.textContent);

describe("a bumper sequence", () => {
  beforeAll(() => stubMatchMedia());

  it("lists its roles in air order, with what fills each under its chip", () => {
    render(<Harness start={{ roles: ["into_break", "up_next"], every: "break" }} />);
    expect(chips()).toEqual(["Into the break", "Up next"]);
    expect(screen.getByText("None yet, so an Any bumper airs")).toBeTruthy();
    expect(screen.getByText("None yet, so nothing airs")).toBeTruthy();
  });

  it("moves a role with the arrow keys, and says where it went", () => {
    render(<Harness start={{ roles: ["into_break", "up_next"], every: "break" }} />);
    const upNext = screen.getByText("Up next").closest("li")!;
    fireEvent.keyDown(upNext, { key: "ArrowUp" });
    expect(chips()).toEqual(["Up next", "Into the break"]);
    expect(screen.getByText("Up next, now 1 of 2")).toBeTruthy();
    fireEvent.keyDown(screen.getByText("Up next").closest("li")!, { key: "ArrowRight" });
    expect(chips()).toEqual(["Into the break", "Up next"]);
  });

  it("removes a role, and an empty row says nothing airs", () => {
    render(<Harness start={{ roles: ["into_break"], every: "break" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Into the break" }));
    expect(screen.getByText("Nothing airs here.")).toBeTruthy();
    expect(screen.getByText("Into the break removed")).toBeTruthy();
  });

  it("adds the roles not already there, four at most", () => {
    const saved: PositionRule[] = [];
    render(<Harness start={{ roles: ["into_break", "up_next", "out_of_break"], every: "break" }} onSaved={(r) => saved.push(r)} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to Opening the break" }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Any"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Any" }));
    expect(chips()).toEqual(["Into the break", "Up next", "Out of the break", "Any"]);
    expect(saved.at(-1)?.roles).toEqual(["into_break", "up_next", "out_of_break", "any"]);
    expect(screen.queryByRole("button", { name: "Add to Opening the break" })).toBeNull();
  });

  it("chooses how often it airs", () => {
    const saved: PositionRule[] = [];
    render(<Harness start={{ roles: ["into_break"], every: "break" }} onSaved={(r) => saved.push(r)} />);
    fireEvent.change(screen.getByRole("combobox", { name: "How often: Opening the break" }), { target: { value: "n:3" } });
    expect(saved.at(-1)).toEqual({ roles: ["into_break"], every: "n_programs", n: 3 });
  });
});

describe("Settings, Breaks: the sequences on the mocks", () => {
  const server = setupServer(...handlers);
  beforeAll(() => {
    stubMatchMedia();
    server.listen({ onUnhandledRequest: "bypass" });
  });
  afterAll(() => server.close());
  beforeEach(() => {
    resetDb();
    signInAs("kai@example.com");
  });
  afterEach(() => server.resetHandlers());
  const beat = { station: BEAT, id: BEAT.id, role: "owner" as const, studio: false, base: "/control/beat", label: "BEAT 12.1", can: () => true };

  it("counts BEAT's bumpers by role, and saves a sequence between programs with the rule", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    // BEAT has "Back to the reel" (out of a break) and the trailer (no role: Any).
    expect(await screen.findAllByText("1 in your library")).toHaveLength(1);
    expect(screen.getByText("None yet, so an Any bumper airs")).toBeTruthy();
    expect(screen.getByText("Example, a 2:00 break: Into the break :10, your spots, the credit, Out of the break :10, then your station ID.")).toBeTruthy();
    const between = screen.getByText("Between programs", { selector: "h4" }).parentElement!.nextElementSibling as HTMLElement;
    expect(within(between).getByText("Nothing airs here.")).toBeTruthy();
    fireEvent.click(within(between).getByRole("button", { name: "Add to Between programs" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Up next" }));
    await waitFor(() => expect(breakRuleOf(BEAT.id).bumperSequences?.between).toEqual({ roles: ["up_next"], every: "program" }));
    expect(await screen.findByText("Up next names the next program on your log, as the guide shows it.")).toBeTruthy();
    // Up next in the opening sequence too: it airs once.
    fireEvent.click(screen.getByRole("button", { name: "Add to Opening the break" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Up next" }));
    await waitFor(() => expect(breakRuleOf(BEAT.id).bumperSequences?.open.roles).toEqual(["into_break", "up_next"]));
    expect(await screen.findByText("Up next airs once a break. Here it only airs if it isn't earlier in the break.")).toBeTruthy();
  });
});
