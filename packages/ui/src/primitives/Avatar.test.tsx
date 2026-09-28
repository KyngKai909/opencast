import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Avatar, initialsOf } from "./Avatar";

afterEach(cleanup);

describe("Avatar", () => {
  it("takes initials from the name and is named by it", () => {
    expect(initialsOf("Kai M.")).toBe("KM");
    expect(initialsOf("Marcus Reyes")).toBe("MR");
    expect(initialsOf("kai@example.com")).toBe("K");
    render(<Avatar name="Kai M." />);
    expect(screen.getByRole("img", { name: "Kai M." }).textContent).toBe("KM");
  });
});
