import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Segmented } from "./Segmented";

afterEach(cleanup);

function Band() {
  const [v, setV] = useState<"tv" | "radio">("tv");
  return (
    <Segmented
      label="Band"
      value={v}
      onChange={setV}
      options={[
        { value: "tv", label: "TV band" },
        { value: "radio", label: "Radio band" }
      ]}
    />
  );
}

describe("Segmented", () => {
  it("is a radio group whose arrow keys move the choice and the focus", () => {
    render(<Band />);
    const group = screen.getByRole("radiogroup", { name: "Band" });
    const [tv, radio] = screen.getAllByRole("radio");
    expect(group).toBeTruthy();
    expect(tv!.getAttribute("aria-checked")).toBe("true");
    expect(tv!.tabIndex).toBe(0);
    expect(radio!.tabIndex).toBe(-1);
    tv!.focus();
    fireEvent.keyDown(tv!, { key: "ArrowRight" });
    expect(radio!.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radio);
    fireEvent.keyDown(radio!, { key: "ArrowRight" });
    expect(tv!.getAttribute("aria-checked")).toBe("true");
  });
});
