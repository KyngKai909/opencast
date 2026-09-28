import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

afterEach(cleanup);

function Opener({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Modal
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        eyebrow="All six keys are taken"
        title="Where should PREP 31.1 go?"
        footer={<Button variant="primary">Save PREP 31.1</Button>}
      >
        <p>Body</p>
      </Modal>
    </>
  );
}

describe("Modal", () => {
  it("is a named modal dialog that takes the focus", () => {
    render(<Opener />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Where should PREP 31.1 go?" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(dialog);
  });

  it("keeps Tab and Shift+Tab inside", () => {
    render(<Opener />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const close = screen.getByRole("button", { name: "Close" });
    const save = screen.getByRole("button", { name: "Save PREP 31.1" });
    save.focus();
    fireEvent.keyDown(save, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  it("Escape closes and the focus goes back to the opener", () => {
    const onClose = vi.fn();
    render(<Opener onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("the close button and a press on the scrim close it; a press inside doesn't", () => {
    const onClose = vi.fn();
    render(<Opener onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.mouseDown(screen.getByText("Body"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("a band-only head is named by its label, and still has a close button", () => {
    render(<Modal open onClose={() => {}} label="Inland Civic" stationBand={<div>7.1 CIVC</div>} />);
    expect(screen.getByRole("dialog", { name: "Inland Civic" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("closed renders nothing", () => {
    render(<Modal open={false} onClose={() => {}} title="Hidden" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
