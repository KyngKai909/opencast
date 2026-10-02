import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChoiceList } from "./ChoiceList";

afterEach(cleanup);

describe("ChoiceList", () => {
  const options = [
    { value: "repeat", title: "Repeat from your library" },
    { value: "carry", title: "Carry Slow Hours", disabled: true },
    { value: "off", title: "Sign off at 11:40 pm" }
  ];

  it("arrow keys skip disabled rows; Space chooses", () => {
    const onChange = vi.fn();
    render(<ChoiceList label="Fill the gap" value="repeat" options={options} onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radios[0]!, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith("off");
    fireEvent.keyDown(radios[1]!, { key: " " });
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(radios[2]!);
    expect(onChange).toHaveBeenLastCalledWith("off");
  });

  it("with nothing chosen the first enabled row takes the tab stop", () => {
    render(<ChoiceList label="Fill the gap" value={null} options={options} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });
});
