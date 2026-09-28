import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Checkbox } from "./Checkbox";

afterEach(cleanup);

describe("Checkbox", () => {
  it("is a real checkbox named by its words", () => {
    const onChange = vi.fn();
    render(
      <Checkbox checked={false} onChange={onChange} label="Credit me on air">
        as "Kai M." in BEAT's monthly thank-you to members
      </Checkbox>
    );
    const box = screen.getByRole("checkbox", { name: /Credit me on air/ });
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
