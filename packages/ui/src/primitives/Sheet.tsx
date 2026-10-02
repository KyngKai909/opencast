import { useRef, useState, type PointerEvent, type RefObject } from "react";
import { DialogShell, type DialogContentProps } from "./dialog";

/** How far the grab handle must travel before a drag closes (down) or expands (up) the sheet, in px. */
export const SHEET_DRAG_CLOSE = 80;
export const SHEET_DRAG_EXPAND = 60;

export interface SheetProps extends DialogContentProps {
  open: boolean;
  /** The grab handle (pressed or dragged down), Escape and a press on the scrim all call this. */
  onClose: () => void;
  /** Dragging the handle up: the station preview opens the full station page. */
  onExpand?: () => void;
  /** viewport: over the whole screen (the phone app). container: inside the nearest positioned box (a drawn phone). */
  placement?: "viewport" | "container";
  /** A close button in the head. Off by default: sheets close from the handle, as drawn. */
  showClose?: boolean;
  /** Move focus in, keep it there, give it back on close. Off only for still pictures (the gallery). */
  manageFocus?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * A sheet (phone): the modal's content and buttons, rising from the bottom edge, with a grab handle.
 * role="dialog" with aria-modal; focus is trapped, Escape closes, focus returns to the opener.
 */
export function Sheet({ open, onClose, onExpand, placement = "viewport", showClose = false, manageFocus = true, initialFocus, className, ...content }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null);
  const start = useRef<{ y: number; moved: boolean } | null>(null);
  const [drag, setDrag] = useState(0);

  if (!open) return null;

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    start.current = { y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!start.current) return;
    const dy = e.clientY - start.current.y;
    if (Math.abs(dy) > 4) start.current.moved = true;
    // Down follows the finger; up gives a little, then hands over to the full page.
    setDrag(dy > 0 ? dy : Math.max(dy, -SHEET_DRAG_EXPAND) / 3);
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    start.current = null;
    setDrag(0);
    if (!s) return;
    const dy = e.clientY - s.y;
    if (dy >= SHEET_DRAG_CLOSE) onClose();
    else if (dy <= -SHEET_DRAG_EXPAND && onExpand) onExpand();
    else if (!s.moved) onClose();
  };

  const grab = (
    <button
      type="button"
      className="oc-sheet__grab"
      aria-label="Close"
      onClick={(e) => {
        // Keyboard presses arrive as clicks with no pointer travel; pointer presses are handled on pointer up.
        if (e.detail === 0) onClose();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        start.current = null;
        setDrag(0);
      }}
    >
      <i aria-hidden="true" />
    </button>
  );

  return (
    <DialogShell
      kind="sheet"
      onClose={onClose}
      showClose={showClose}
      manageFocus={manageFocus}
      initialFocus={initialFocus}
      placement={placement}
      panelRef={panel}
      panelClassName={drag ? "oc-sheet--dragging" : undefined}
      panelStyle={drag ? { transform: `translateY(${drag}px)` } : undefined}
      top={grab}
      className={className}
      {...content}
    />
  );
}
