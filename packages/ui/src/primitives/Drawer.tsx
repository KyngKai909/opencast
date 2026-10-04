import type { RefObject } from "react";
import { DialogShell, type DialogContentProps } from "./dialog";

export interface DrawerProps extends DialogContentProps {
  /** Shown or not. Closed renders nothing. */
  open: boolean;
  /** Close button, Escape, and a press on the scrim all call this. */
  onClose: () => void;
  /** Width in px: 470 by default (the schedule reference's Add drawer). The whole width on the phone. */
  width?: number;
  /** viewport: over the whole window (apps). container: inside the nearest positioned box (a drawn frame). */
  placement?: "viewport" | "container";
  /** Move focus in, keep it there, give it back on close. Off only for still pictures (the gallery). */
  manageFocus?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * A drawer (A246, the schedule reference's .drawer): the modal's head, body and foot in a panel
 * along the right edge, over what it's for (dimmed, still in view). role="dialog" with aria-modal;
 * focus is trapped, Escape closes, focus returns to the opener.
 */
export function Drawer({ open, onClose, width = 470, placement = "viewport", manageFocus = true, initialFocus, className, ...content }: DrawerProps) {
  if (!open) return null;
  return (
    <DialogShell
      kind="drawer"
      onClose={onClose}
      showClose
      manageFocus={manageFocus}
      initialFocus={initialFocus}
      placement={placement}
      panelStyle={{ width }}
      className={className}
      {...content}
    />
  );
}
