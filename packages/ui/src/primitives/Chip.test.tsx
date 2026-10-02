import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Chip, ChipRow } from "./Chip";

afterEach(cleanup);

describe("Chip and ChipRow", () => {
  it("a lone chip is a toggle button", () => {
    render(<Chip on>Music</Chip>);
    expect(screen.getByRole("button", { name: "Music" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("single choice moves with the arrows", () => {
    const onChange = vi.fn();
    render(
      <ChipRow
        label="Filter"
        value="all"
        onChange={onChange}
        options={[
          { value: "all", label: "All" },
          { value: "live", label: "Live now" }
        ]}
      />
    );
    const [all] = screen.getAllByRole("radio");
    fireEvent.keyDown(all!, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("live");
  });

  it("multiple choice toggles each chip and keeps the options' order", () => {
    const onChange = vi.fn();
    render(
      <ChipRow
        multiple
        label="Times of day"
        value={["evenings"]}
        onChange={onChange}
        options={[
          { value: "mornings", label: "Mornings" },
          { value: "afternoons", label: "Afternoons" },
          { value: "evenings", label: "Evenings, 6 to 11 pm" }
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Mornings" }));
    expect(onChange).toHaveBeenLastCalledWith(["mornings", "evenings"]);
    fireEvent.click(screen.getByRole("button", { name: "Evenings, 6 to 11 pm" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
