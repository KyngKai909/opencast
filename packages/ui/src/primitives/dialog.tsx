// What Modal, Sheet and Drawer share: the focus trap, Escape, the head, body and foot. Not exported from
// the package; use Modal (web), Sheet (phone) or Drawer (a side panel on the web).

import { useEffect, useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { cx } from "../lib/cx";
import { IconButton } from "./Button";

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("inert") && el.getAttribute("aria-hidden") !== "true");
}

/**
 * While active: focus moves into the panel (or to `initialFocus`), Tab and Shift+Tab stay inside,
 * and when it ends focus goes back to whatever opened it.
 */
export function useFocusTrap(panel: RefObject<HTMLElement | null>, active: boolean, initialFocus?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = initialFocus?.current ?? panel.current;
    target?.focus({ preventScroll: true });
    return () => {
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
    // The opener is read once, when the trap starts.
  }, [active]);

  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Tab" || !panel.current) return;
    const items = focusables(panel.current);
    if (!items.length) {
      e.preventDefault();
      panel.current.focus();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const here = document.activeElement;
    if (e.shiftKey && (here === first || here === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && here === last) {
      e.preventDefault();
      first.focus();
    }
  };
}

export interface DialogContentProps {
  /** The heading. Also the dialog's name. */
  title?: ReactNode;
  /** A quiet line above the heading: the reason or the context ("All six keys are taken", "BEAT 12.1, on air"). */
  eyebrow?: ReactNode;
  /** A line under the heading. */
  subtitle?: ReactNode;
  /** A station's colour band in place of the head (the broadcast group's StationBand). */
  stationBand?: ReactNode;
  /** The dialog's name when there's no title (a band-only head): "Inland Civic". */
  label?: string;
  /** The buttons at the foot. Each takes an equal share of the width. */
  footer?: ReactNode;
  /** Stack the foot's buttons, one above the other. */
  footStacked?: boolean;
  /** The body. */
  children?: ReactNode;
}

export interface DialogShellProps extends DialogContentProps {
  kind: "modal" | "sheet" | "drawer";
  onClose: () => void;
  /** Show the close button in the head (or on the band). */
  showClose: boolean;
  /** Move focus in, trap it, return it on close. Off only for still pictures (the gallery). */
  manageFocus: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  placement: "viewport" | "container";
  panelClassName?: string;
  panelStyle?: CSSProperties;
  /** Drawn above the head (the sheet's grab handle). */
  top?: ReactNode;
  panelRef?: RefObject<HTMLDivElement | null>;
  className?: string;
}

export function DialogShell(props: DialogShellProps) {
  const {
    kind, onClose, showClose, manageFocus, initialFocus, placement, panelClassName, panelStyle, top,
    title, eyebrow, subtitle, stationBand, label, footer, footStacked, children, className
  } = props;
  const ownRef = useRef<HTMLDivElement>(null);
  const panel = props.panelRef ?? ownRef;
  const titleId = useId();
  const onTab = useFocusTrap(panel, manageFocus, initialFocus);

  const close = showClose ? <IconButton icon="x" label="Close" bare={!stationBand} className="oc-modal__x" onClick={onClose} /> : null;

  return (
    <div
      className={cx("oc-backdrop", kind === "sheet" && "oc-backdrop--sheet", kind === "drawer" && "oc-backdrop--drawer", placement === "container" && "oc-backdrop--container", className)}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
          return;
        }
        if (manageFocus) onTab(e);
      }}
    >
      <div
        ref={panel}
        className={cx(kind === "modal" ? "oc-modal" : kind === "drawer" ? "oc-drawer" : "oc-sheet", panelClassName)}
        style={panelStyle}
        role="dialog"
        aria-modal={manageFocus ? true : undefined}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        tabIndex={-1}
      >
        {top}
        {stationBand ? (
          <div className="oc-modal__band">
            {stationBand}
            {close}
          </div>
        ) : (
          (title || eyebrow || subtitle || close) && (
            <div className="oc-modal__head">
              <div className="oc-modal__titles">
                {eyebrow && (
                  <div className="oc-modal__eyebrow">
                    <span>{eyebrow}</span>
                  </div>
                )}
                {title && (
                  <h2 className="oc-modal__title" id={titleId}>
                    {title}
                  </h2>
                )}
                {subtitle && <p className="oc-modal__sub">{subtitle}</p>}
              </div>
              {close}
            </div>
          )
        )}
        {children !== undefined && children !== null && <div className="oc-modal__main">{children}</div>}
        {footer && <div className={cx("oc-modal__foot", footStacked && "oc-modal__foot--stacked")}>{footer}</div>}
      </div>
    </div>
  );
}
