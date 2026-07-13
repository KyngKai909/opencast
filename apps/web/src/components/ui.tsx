import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";
import type { ChannelStatus, SlotTag } from "../state/ChannelsProvider";

/* ------------------------------- Button ---------------------------------- */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill font-medium select-none " +
    "transition-[transform,background-color,border-color,color] duration-[130ms] active:translate-y-px " +
    "disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        signal:
          "bg-signal text-signal-ink hover:bg-signal-bright shadow-[0_8px_22px_-8px_var(--signal-line)]",
        outline: "border border-line-strong text-ink hover:border-signal hover:text-signal bg-transparent",
        surface: "bg-surface2 text-ink border border-line hover:bg-surface3",
        ghost: "text-ink-muted hover:text-ink hover:bg-surface2",
        danger: "bg-transparent border border-line-strong text-onair hover:bg-onair hover:text-white hover:border-onair"
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-[15px]",
        icon: "h-10 w-10"
      }
    },
    defaultVariants: { variant: "surface", size: "md" }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  }
);
Button.displayName = "Button";

/* -------------------------------- Card ----------------------------------- */
export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }
>(({ className, interactive, ...props }, ref) => (
  <div
    ref={ref}
    data-drift
    className={cn(
      "rounded-lg border border-line bg-surface",
      interactive &&
        "transition-[transform,border-color,box-shadow] duration-[240ms] hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[var(--shadow)]",
      className
    )}
    {...props}
  />
));
Card.displayName = "Card";

/* ------------------------------ State pill -------------------------------- */
type PillKind = ChannelStatus | SlotTag;

const PILL: Record<PillKind, { label: string; cls: string }> = {
  live: { label: "Live", cls: "text-signal border-[var(--signal-line)] bg-[var(--signal-soft)]" },
  now: { label: "On now", cls: "text-signal border-[var(--signal-line)] bg-[var(--signal-soft)]" },
  next: { label: "Next", cls: "text-next border-[color-mix(in_oklab,var(--next)_45%,transparent)] bg-[color-mix(in_oklab,var(--next)_12%,transparent)]" },
  sponsor: { label: "Sponsor", cls: "text-sponsor border-[color-mix(in_oklab,var(--sponsor)_45%,transparent)] bg-[color-mix(in_oklab,var(--sponsor)_12%,transparent)]" },
  scheduled: { label: "Scheduled", cls: "text-ink-muted border-line-strong bg-surface2" },
  offline: { label: "Offline", cls: "text-ink-faint border-line-strong bg-surface2" },
  aired: { label: "Aired", cls: "text-ink-faint border-line bg-surface2" }
};

export function Pill({
  kind,
  children,
  className
}: {
  kind: PillKind;
  children?: React.ReactNode;
  className?: string;
}) {
  const cfg = PILL[kind];
  const isLive = kind === "live" || kind === "now";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.1em]",
        cfg.cls,
        className
      )}
    >
      <span className={cn(isLive ? "live-dot" : "h-1.5 w-1.5 rounded-full bg-current")} />
      {children ?? cfg.label}
    </span>
  );
}

/* -------------------------------- Chip ----------------------------------- */
export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill border border-line bg-surface2 px-2 py-0.5 text-[11px] text-ink-muted",
        className
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------- Skeleton / EmptyState -------------------------- */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface2", className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface/50 px-6 py-14 text-center",
        className
      )}
    >
      {icon && <div className="mb-4 grid h-12 w-12 place-items-center rounded-md bg-surface2 text-signal">{icon}</div>}
      <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ----------------------------- Metric tile -------------------------------- */
export function MetricStat({
  label,
  value,
  sub,
  accent,
  className
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div data-drift className={cn("rounded-lg border border-line bg-surface p-4", className)}>
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">{label}</div>
      <div className={cn("mt-2 font-display text-2xl font-semibold tnum", accent ? "text-signal" : "text-ink")}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}
