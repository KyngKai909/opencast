import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BusinessShell } from "./BusinessShell";
import { BusinessSetupShell } from "./BusinessSetupShell";
import { DeskShell } from "./DeskShell";

afterEach(cleanup);

describe("BusinessShell", () => {
  it("shows the available balance as money, and the business in its switcher", () => {
    render(
      <BusinessShell
        business={{ name: "Orange Street Coffee", initials: "OSC", colour: "#6B4A2B" }}
        available={412_500_000}
        user={{ initials: "JL", name: "J. L." }}
        active="spots"
        items={{ spots: { count: 3 } }}
        linkTo={(p) => `#${p}`}
      />
    );
    expect(screen.getByText("$412.50").closest(".oc-business-shell__balance")?.textContent).toBe("Available $412.50");
    expect(screen.getByRole("button", { name: /Orange Street Coffee/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Spots/ }).getAttribute("aria-current")).toBe("page");
  });

  it("says which step of three while getting started", () => {
    render(<BusinessSetupShell step={2} />);
    expect(screen.getByText("Getting started, step 2 of 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finish later" })).toBeTruthy();
  });
});

describe("DeskShell", () => {
  it("carries the Internal sign", () => {
    render(<DeskShell user={{ initials: "DA", name: "D. A." }} active="market-board" linkTo={(p) => `#${p}`} />);
    expect(screen.getByText("Internal")).toBeTruthy();
    expect(screen.getByText("Opencast team")).toBeTruthy();
  });
});
