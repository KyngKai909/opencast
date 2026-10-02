import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "../lib/cx";

export interface ToastProps {
  /** What just happened, in a line: "Reminder set for Beat Tape Live, 9:00 pm". */
  message: ReactNode;
  /** Shows Undo; called when it's pressed. */
  onUndo?: () => void;
  /** "status" when it stands alone; the provider's region already announces, so it passes "none". */
  role?: "status" | "none";
  className?: string;
}

/** A toast: ink on the ground's opposite, one line, with Undo. It replaces a confirmation step. */
export function Toast({ message, onUndo, role = "status", className }: ToastProps) {
  return (
    <div className={cx("oc-toast", className)} role={role === "none" ? undefined : role}>
      <span className="oc-toast__msg">{message}</span>
      {onUndo && (
        <button type="button" className="oc-toast__undo" onClick={onUndo}>
          Undo
        </button>
      )}
    </div>
  );
}

export interface ShowToast {
  message: ReactNode;
  /** Called when Undo is pressed. Without it there's no Undo. */
  onUndo?: () => void;
  /** Called when the toast goes by itself: the change stands. */
  onExpire?: () => void;
  /** How long it stays, in ms. Default 5000. Hover or focus holds it. */
  timeout?: number;
}

interface ToastApi {
  /** Shows a toast, replacing any on screen. Returns its id. */
  show(toast: ShowToast): number;
  /** Takes the toast away (or only the one with this id). */
  dismiss(id?: number): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export const TOAST_TIMEOUT = 5000;

export interface ToastProviderProps {
  children?: ReactNode;
  /** viewport: fixed to the window (apps). container: inside the nearest positioned box (a phone frame). */
  placement?: "viewport" | "container";
  className?: string;
}

/**
 * Holds the one toast on screen. Apps put it once near the root and call useToast().show(…).
 * A new toast replaces the old one; each goes after its timeout unless hovered or focused.
 */
export function ToastProvider({ children, placement = "viewport", className }: ToastProviderProps) {
  const [current, setCurrent] = useState<(ShowToast & { id: number }) | null>(null);
  const [held, setHeld] = useState(false);
  const nextId = useRef(1);

  const dismiss = useCallback((id?: number) => {
    setCurrent((c) => (c && (id === undefined || c.id === id) ? null : c));
    setHeld(false);
  }, []);

  const show = useCallback((toast: ShowToast) => {
    const id = nextId.current++;
    setCurrent({ ...toast, id });
    return id;
  }, []);

  useEffect(() => {
    if (!current || held) return;
    const t = setTimeout(() => {
      current.onExpire?.();
      dismiss(current.id);
    }, current.timeout ?? TOAST_TIMEOUT);
    return () => clearTimeout(t);
  }, [current, held, dismiss]);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className={cx("oc-toast-region", placement === "container" && "oc-toast-region--container", className)}
        role="status"
        aria-live="polite"
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
        }}
      >
        {current && (
          <Toast
            key={current.id}
            role="none"
            message={current.message}
            onUndo={
              current.onUndo
                ? () => {
                    current.onUndo?.();
                    dismiss(current.id);
                  }
                : undefined
            }
          />
        )}
      </div>
    </ToastContext.Provider>
  );
}

/** The toast API from the nearest ToastProvider. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast needs a ToastProvider above it");
  return ctx;
}
