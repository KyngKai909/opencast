import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tabs } from "./Tabs";

afterEach(cleanup);

describe("Tabs", () => {
  it("is a tablist; arrows, Home and End select", () => {
    const onChange = vi.fn();
    render(
      <Tabs
        label="Market"
        value="browse"
        onChange={onChange}
        items={[
          { value: "browse", label: "Browse" },
          { value: "offered", label: "Offered by BEAT", count: 1 },
          { value: "carried", label: "Carried by BEAT" }
        ]}
      />
    );
    expect(screen.getByRole("tablist", { name: "Market" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs[0]!, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("carried");
    fireEvent.keyDown(tabs[0]!, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("carried");
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("offered");
  });
});
