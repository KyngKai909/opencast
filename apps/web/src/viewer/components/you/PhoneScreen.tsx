// A screen over the whole phone (sign-in on the phone, you 01.2 and 01.3): a dialog that takes the
// full screen, keeps focus inside and closes on Escape, with the back bar when there's somewhere
// to go back to.

import { useEffect, useRef, type ReactNode } from "react";
import { PhoneBackBar } from "@opencast/ui";
import "./PhoneScreen.css";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface PhoneScreenProps {
  /** The dialog's name. */
  label: string;
  /** The back bar's title; without it there's no back bar. */
  title?: ReactNode;
  onBack?: () => void;
  onClose: () => void;
  children: ReactNode;
}

export function PhoneScreen({ label, title, onBack, onClose, children }: PhoneScreenProps) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current;
    first?.focus({ preventScroll: true });
    return () => opener?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={panel}
      className="vw-phone-screen"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
          return;
        }
        if (e.key !== "Tab" || !panel.current) return;
        const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (!items.length) return;
        const firstEl = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && (document.activeElement === firstEl || document.activeElement === panel.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          firstEl.focus();
        }
      }}
    >
      {title !== undefined && <PhoneBackBar title={title} onBack={onBack} />}
      <div className="vw-phone-screen__body">{children}</div>
    </div>
  );
}
