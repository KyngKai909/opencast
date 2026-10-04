import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BreakStrip, breakKindClass } from "./BreakStrip";

afterEach(cleanup);

describe("BreakStrip", () => {
  const parts = [
    { kind: "bumper" as const, length: 5_000, label: "Bumper" },
    { kind: "open" as const, length: 30_000, label: "0:30 open" },
    { kind: "credit" as const, length: 10_000 },
    { kind: "id" as const, length: 5_000, label: "ID" },
    { kind: "spots" as const, length: 0 }
  ];

  it("draws each part to length by its kind, named in words, leaving out what has no length", () => {
    const { container } = render(<BreakStrip parts={parts} />);
    expect(screen.getByRole("img", { name: "Bumper :05, Open :30, Credit :10, ID :05" })).toBeTruthy();
    const spans = [...container.querySelectorAll(".oc-brkstrip > span")] as HTMLElement[];
    expect(spans.map((s) => [s.className, s.style.flexGrow || s.style.flex, s.textContent])).toEqual([
      ["oc-brk--bumper", expect.stringMatching(/^5000/), "Bumper"],
      ["oc-brk--open", expect.stringMatching(/^30000/), "0:30 open"],
      ["oc-brk--credit", expect.stringMatching(/^10000/), ""],
      ["oc-brk--id", expect.stringMatching(/^5000/), "ID"]
    ]);
  });

  it("as a row's bar, draws no words on the parts", () => {
    const { container } = render(<BreakStrip parts={parts} variant="bar" label="2 spots, credit, ID" />);
    expect(screen.getByRole("img", { name: "2 spots, credit, ID" }).className).toContain("oc-brkstrip--bar");
    expect(container.textContent).toBe("");
    expect(breakKindClass("upnext")).toBe("oc-brk--upnext");
  });

  it("big (A246): each part's words over its length; mini: words, no lengths", () => {
    const big = [
      { kind: "bumper" as const, length: 5_000, label: "Bumper", detail: "0:05" },
      { kind: "spots" as const, length: 90_000, label: "Spots", detail: "up to 1:30" }
    ];
    const { container, rerender } = render(<BreakStrip parts={big} variant="big" />);
    expect(screen.getByRole("img", { name: "Bumper :05, Spots 1:30" }).className).toContain("oc-brkstrip--big");
    expect([...container.querySelectorAll(".oc-brkstrip > span small")].map((s) => s.textContent)).toEqual(["0:05", "up to 1:30"]);
    rerender(<BreakStrip parts={big} variant="mini" />);
    expect(container.querySelector(".oc-brkstrip--mini")!.textContent).toBe("BumperSpots");
  });
});
