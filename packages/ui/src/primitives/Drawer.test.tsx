import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Drawer } from "./Drawer";

afterEach(cleanup);

describe("Drawer", () => {
  it("is a dialog named by its title, along the right edge, closing with Escape and its button", () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="Add at 11:40 pm" subtitle="20 min free, until Late Crate, ep. 13 at 12:00 am">
        <p>Choices</p>
      </Drawer>
    );
    const dialog = screen.getByRole("dialog", { name: "Add at 11:40 pm" });
    expect(dialog.className).toContain("oc-drawer");
    expect(dialog.parentElement!.className).toContain("oc-backdrop--drawer");
    expect(screen.getByText("20 min free, until Late Crate, ep. 13 at 12:00 am")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders nothing closed", () => {
    render(<Drawer open={false} onClose={() => {}} title="Add" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
