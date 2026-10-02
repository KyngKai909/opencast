import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { AmountPicker, type AmountChoice } from "./AmountPicker";

afterEach(cleanup);

function Pledge({ onChange }: { onChange?: (v: AmountChoice) => void }) {
  const [v, setV] = useState<AmountChoice | null>(10_000_000);
  const [text, setText] = useState("");
  return (
    <AmountPicker
      label="How much a month"
      amounts={[5_000_000, 10_000_000, 20_000_000]}
      value={v}
      onChange={(x) => {
        setV(x);
        onChange?.(x);
      }}
      otherValue={text}
      onOtherChange={setText}
    />
  );
}

describe("AmountPicker", () => {
  it("writes amounts with money() and shows a mono field for Other", () => {
    render(<Pledge />);
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["$5", "$10", "$20", "Other"]);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Other" }));
    const field = screen.getByLabelText("Other amount") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "12.50" } });
    expect(field.value).toBe("12.50");
  });

  it("arrow keys move the choice", () => {
    const onChange = vi.fn();
    render(<Pledge onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "$10" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(20_000_000);
  });
});
