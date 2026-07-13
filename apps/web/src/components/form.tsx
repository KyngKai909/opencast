import * as React from "react";
import { useEffect } from "react";
import { cn } from "../lib/utils";
import { Button } from "./ui";

const control =
  "w-full rounded-md border border-line bg-surface2 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint " +
  "transition-colors duration-[130ms] focus:border-signal focus:outline-none focus:ring-1 focus:ring-[var(--signal)] disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(control, className)} {...props} />
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(control, "min-h-[90px] resize-y", className)} {...props} />
  )
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select ref={ref} className={cn(control, "appearance-none pr-9", className)} {...props}>
        {children}
      </select>
      <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
);
Select.displayName = "Select";

export function Field({
  label,
  hint,
  children,
  className
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 flex items-center justify-between text-[13px] font-medium text-ink-muted">
        {label}
        {hint && <span className="text-[11px] font-normal text-ink-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative z-10 max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-lg rounded-b-none border border-line bg-surface shadow-[var(--shadow)] sm:rounded-b-lg">
        <div className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div>
            <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
            {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </Button>
        </div>
        {children && <div className="p-5">{children}</div>}
        {footer && <div className="flex justify-end gap-3 border-t border-line p-5">{footer}</div>}
      </div>
    </div>
  );
}
