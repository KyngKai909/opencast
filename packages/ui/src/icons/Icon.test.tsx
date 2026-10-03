import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Icon } from "./Icon";

afterEach(cleanup);

describe("Icon", () => {
  it("keeps its shapes across renders, so a press that starts on one is still a click", () => {
    const { container, rerender } = render(<Icon name="keypad" size={22} />);
    const shape = container.querySelector("svg")!.firstElementChild;
    rerender(<Icon name="keypad" size={22} />);
    expect(container.querySelector("svg")!.firstElementChild).toBe(shape);
    expect(shape?.isConnected).toBe(true);
  });
});
