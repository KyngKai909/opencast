import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SettingsLayout } from "./SettingsLayout";

afterEach(cleanup);

const sections = [
  { id: "identity", label: "Identity", href: "#identity" },
  { id: "team", label: "Team", href: "#team" },
  { id: "ownership", label: "Ownership", href: "#ownership", danger: true }
];

describe("SettingsLayout", () => {
  it("on the web, marks the section on screen and heads the pane with it", () => {
    render(<SettingsLayout sections={sections} active="team" description="Who can run BEAT." />);
    expect(screen.getByRole("link", { name: "Team" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { level: 3, name: "Team" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ownership" }).className).toContain("--danger");
  });

  it("on the phone, lists the sections when none is open", () => {
    render(<SettingsLayout form="phone" sections={sections} active={null} />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("on the phone, shows a section as its own screen with a back arrow", () => {
    const back = vi.fn();
    render(
      <SettingsLayout form="phone" sections={sections} active="team" onBack={back}>
        <p>Rows</p>
      </SettingsLayout>
    );
    expect(screen.getByRole("heading", { name: "Team" })).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(back).toHaveBeenCalledOnce();
  });
});
