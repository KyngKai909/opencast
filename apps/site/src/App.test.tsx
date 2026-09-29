import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App";

describe("the page", () => {
  it("has every section's anchor", () => {
    render(<App />);
    for (const id of ["dial", "remote", "stations", "producers", "businesses", "money", "local", "open", "join", "faq"]) expect(document.getElementById(id), id).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Television, run by your neighbors.");
  });

  it("“List your programs” chooses the producer role and goes to the waitlist", () => {
    render(<App />);
    const link = screen.getByRole("link", { name: "List your programs" });
    expect(link.getAttribute("href")).toBe("#join");
    fireEvent.click(link);
    expect(screen.getByRole("radio", { name: "A producer" }).getAttribute("aria-checked")).toBe("true");
  });

  it("points the code at the real repo", () => {
    render(<App />);
    expect(screen.getByRole("link", { name: "Read the code" }).getAttribute("href")).toBe("https://github.com/KyngKai909/untitled-project");
    expect(screen.getByRole("region", { name: "Run a station locally" }).textContent).toContain("git clone https://github.com/KyngKai909/untitled-project\nnpm install\nnpm run dev");
  });
});
