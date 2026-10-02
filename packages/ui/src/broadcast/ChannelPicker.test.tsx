import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { ChannelPicker, channelOptions } from "./ChannelPicker";

afterEach(cleanup);

function Picker() {
  const [v, setV] = useState("8");
  return <ChannelPicker options={channelOptions(2, 41, [7, 9, 18])} value={v} onChange={setV} />;
}

const radio = (c: HTMLElement, name: string) => c.querySelector(`[aria-label="${name}"]`) as HTMLElement;

describe("ChannelPicker", () => {
  it("is a radio group with the chosen channel checked and taken ones disabled", () => {
    const { container } = render(<Picker />);
    expect(container.querySelector("[role=radiogroup]")).not.toBeNull();
    expect(radio(container, "8").getAttribute("aria-checked")).toBe("true");
    expect(radio(container, "7, taken").getAttribute("aria-disabled")).toBe("true");
    expect(radio(container, "8").tabIndex).toBe(0);
    expect(radio(container, "10").tabIndex).toBe(-1);
  });
  it("skips taken channels with the arrow keys", () => {
    const { container } = render(<Picker />);
    fireEvent.keyDown(radio(container, "8"), { key: "ArrowRight" });
    expect(radio(container, "10").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radio(container, "10"), { key: "ArrowLeft" });
    fireEvent.keyDown(radio(container, "8"), { key: "ArrowLeft" });
    expect(radio(container, "6").getAttribute("aria-checked")).toBe("true");
  });
  it("moves a row with up and down, and ignores clicks on taken channels", () => {
    const { container } = render(<Picker />);
    fireEvent.keyDown(radio(container, "8"), { key: "ArrowDown" });
    // 18 is taken, so down from 8 keeps to the column and lands on 28.
    expect(radio(container, "28").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radio(container, "28"), { key: "ArrowUp" });
    expect(radio(container, "8").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(radio(container, "7, taken"));
    expect(radio(container, "8").getAttribute("aria-checked")).toBe("true");
  });
});
