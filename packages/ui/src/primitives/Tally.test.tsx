import { describe, expect, it } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { Tally } from "./Tally";

const sign = (c: HTMLElement) => c.querySelector(".oc-tally") as HTMLElement;

describe("Tally", () => {
  it("switches on with the flicker when it first lights", () => {
    const { container } = render(<Tally state="lit" />);
    expect(sign(container).className).toContain("oc-tally--switching");
    expect(sign(container).getAttribute("aria-label")).toBe("On air");
  });

  it("holds after the switch-on and never replays it on re-render", () => {
    const { container, rerender } = render(<Tally state="lit" />);
    fireEvent.animationEnd(sign(container));
    expect(sign(container).className).not.toContain("oc-tally--switching");
    rerender(<Tally state="lit" size="lg" />);
    expect(sign(container).className).not.toContain("oc-tally--switching");
    expect(sign(container).className).toContain("oc-tally--lit");
  });

  it("flickers again only on a new unlit → lit transition", () => {
    const { container, rerender } = render(<Tally state="unlit" />);
    expect(sign(container).className).not.toContain("oc-tally--switching");
    rerender(<Tally state="lit" />);
    expect(sign(container).className).toContain("oc-tally--switching");
  });

  it("can light without the flicker", () => {
    const { container } = render(<Tally state="lit" flicker={false} />);
    expect(sign(container).className).not.toContain("oc-tally--switching");
  });

  it("says stand by and off air in words", () => {
    const standby = render(<Tally state="standby" />);
    expect(standby.container.textContent).toBe("STAND BY");
    const off = render(<Tally state="unlit">OFF AIR</Tally>);
    expect(sign(off.container).getAttribute("aria-label")).toBe("Off air");
  });
});
