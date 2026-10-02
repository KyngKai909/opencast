import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { TvShell, fitTv } from "./TvShell";

afterEach(cleanup);

describe("fitTv", () => {
  it("draws at 1 in a 1920×1080 box", () => {
    expect(fitTv(1920, 1080)).toEqual({ scale: 1, left: 0, top: 0 });
  });
  it("letterboxes in a box taller than 16:9", () => {
    expect(fitTv(960, 720)).toEqual({ scale: 0.5, left: 0, top: 90 });
  });
  it("pillarboxes in a box wider than 16:9", () => {
    expect(fitTv(2000, 540)).toEqual({ scale: 0.5, left: 520, top: 0 });
  });
  it("fits by width when the box has no height yet", () => {
    expect(fitTv(1280, 0)).toEqual({ scale: 1280 / 1920, left: 0, top: 0 });
  });
  it("draws nothing in a box with no width", () => {
    expect(fitTv(0, 500).scale).toBe(0);
  });
});

describe("TvShell", () => {
  it("is always dark and puts overlays and hints inside the title-safe area", () => {
    const { container } = render(
      <TvShell picture={<i data-p />} hints={<span>Playing from Kai's phone</span>}>
        <b data-o />
      </TvShell>
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("data-ground")).toBe("tv");
    expect(container.querySelector(".oc-tv-shell__picture [data-p]")).not.toBeNull();
    expect(container.querySelector(".oc-tv-shell__safe [data-o]")).not.toBeNull();
    expect(container.querySelector(".oc-tv-shell__safe .oc-tv-shell__hints")?.textContent).toBe("Playing from Kai's phone");
  });
});
