import type { RefObject } from "react";
import { DialogShell, type DialogContentProps } from "./dialog";

export interface ModalProps extends DialogContentProps {
  /** Shown or not. Closed renders nothing. */
  open: boolean;
  /** Close button, Escape, and a press on the backdrop all call this. */
  onClose: () => void;
  /** Width in px: 480 by default; 360 for the guide's listing, 520 for the presets question. */
  width?: number;
  /** viewport: over the whole window (apps). container: inside the nearest positioned box (a drawn frame). */
  placement?: "viewport" | "container";
  /** The close button in the head. On by default. */
  showClose?: boolean;
  /** Move focus in, keep it there, give it back on close. Off only for still pictures (the gallery). */
  manageFocus?: boolean;
  /** Where focus goes first. Defaults to the dialog itself, so its heading is read. */
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * A modal (web): a panel on the scrim, with a head (title, subtitle, close), a body and a foot of
 * buttons. role="dialog" with aria-modal; focus is trapped, Escape closes, focus returns to the opener.
 * On the phone, use Sheet with the same content and buttons.
 */
export function Modal({ open, onClose, width = 480, placement = "viewport", showClose = true, manageFocus = true, initialFocus, className, ...content }: ModalProps) {
  if (!open) return null;
  return (
    <DialogShell
      kind="modal"
      onClose={onClose}
      showClose={showClose}
      manageFocus={manageFocus}
      initialFocus={initialFocus}
      placement={placement}
      panelStyle={{ width }}
      className={className}
      {...content}
    />
  );
}
