import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Field, SelectField } from "./Field";

afterEach(cleanup);

describe("Field", () => {
  it("labels the input and describes it with its help and state lines", () => {
    render(<Field label="Call sign" help="Four letters." ok="BEAT is free" defaultValue="BEAT" />);
    const input = screen.getByLabelText("Call sign") as HTMLInputElement;
    expect(input.value).toBe("BEAT");
    const described = input.getAttribute("aria-describedby")!.split(" ").map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(["Four letters.", "BEAT is free"]);
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("an error replaces the ok line and marks the input invalid", () => {
    render(<Field label="Call sign" ok="BEAT is free" error="CIVC is taken" />);
    const input = screen.getByLabelText("Call sign");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByText("BEAT is free")).toBeNull();
    expect(screen.getByText("CIVC is taken")).toBeTruthy();
  });

  it("the select-looking field is a real select", () => {
    render(
      <SelectField label="Category" defaultValue="food">
        <option value="food">Coffee and food</option>
        <option value="music">Music</option>
      </SelectField>
    );
    expect((screen.getByLabelText("Category") as HTMLSelectElement).tagName).toBe("SELECT");
  });
});
