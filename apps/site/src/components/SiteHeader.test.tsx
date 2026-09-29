import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GroundProvider } from "@opencast/ui";
import { GroundToggle, SiteHeader } from "./SiteHeader";

function systemPrefers(light: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("light") ? light : q.includes("dark") ? !light : false, addEventListener() {}, removeEventListener() {} }));
}

describe("the ground toggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("follows the system until chosen, and names the other ground", () => {
    systemPrefers(true);
    render(<GroundProvider><GroundToggle /></GroundProvider>);
    expect(screen.getByRole("button").textContent).toBe("Dark ground");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("switches and saves the choice in oc-ground", () => {
    systemPrefers(false);
    render(<GroundProvider><GroundToggle /></GroundProvider>);
    expect(screen.getByRole("button").textContent).toBe("Light ground");
    fireEvent.click(screen.getByRole("button"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("oc-ground")).toBe("light");
    expect(screen.getByRole("button").textContent).toBe("Dark ground");
    fireEvent.click(screen.getByRole("button"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("oc-ground")).toBe("dark");
  });

  it("starts from a saved choice over the system's", () => {
    systemPrefers(true);
    localStorage.setItem("oc-ground", "dark");
    render(<GroundProvider><GroundToggle /></GroundProvider>);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByRole("button").textContent).toBe("Light ground");
  });

  it("sits in the header with the nav and Join the waitlist", () => {
    systemPrefers(false);
    render(<GroundProvider><SiteHeader /></GroundProvider>);
    expect(screen.getByRole("navigation", { name: "Sections" }).textContent).toBe("The dialOn your TVRun a stationFor producersFor businessesOpen source");
    expect(screen.getByRole("link", { name: "Join the waitlist" }).getAttribute("href")).toBe("#join");
  });
});
