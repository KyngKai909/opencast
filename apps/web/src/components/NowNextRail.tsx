import { cn } from "../lib/utils";
import { formatDuration } from "../lib/format";
import type { RailSlot, SlotTag } from "../state/ChannelsProvider";

/**
 * NowNextRail — the signature component. A horizontal, time-based track of
 * program slots driven by real schedule/playout data. The `now` slot carries a
 * glowing live edge; `next` and `sponsor` are visually distinct.
 */

const TAG_LABEL: Record<SlotTag, string> = {
  aired: "Aired",
  now: "On air",
  next: "Up next",
  sponsor: "Sponsor",
  scheduled: "Scheduled"
};

function timeLabel(startsInMin: number, tag: SlotTag): string {
  if (tag === "now") return "now";
  const m = Math.round(startsInMin);
  if (m <= 0) return `${Math.abs(m)}m ago`;
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  return `in ${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
}

export function NowNextRail({
  slots,
  className,
  size = "md"
}: {
  slots: RailSlot[];
  className?: string;
  size?: "sm" | "md";
}) {
  if (slots.length === 0) {
    return (
      <div className={cn("rounded-lg border border-dashed border-line-strong bg-surface/40 px-4 py-6 text-center text-sm text-ink-faint", className)}>
        No schedule yet — add segments to build the lineup.
      </div>
    );
  }
  return (
    <div
      className={cn(
        "no-scrollbar flex gap-2 overflow-x-auto rounded-lg border border-line bg-surface p-2.5",
        className
      )}
      role="list"
      aria-label="Now and next"
    >
      {slots.map((slot) => (
        <RailBlock key={slot.id} slot={slot} size={size} />
      ))}
    </div>
  );
}

function RailBlock({ slot, size }: { slot: RailSlot; size: "sm" | "md" }) {
  const now = slot.tag === "now";
  const tone =
    slot.tag === "now"
      ? "border-[var(--signal-line)] bg-[color-mix(in_oklab,var(--signal)_10%,var(--surface-2))] glow-ring"
      : slot.tag === "next"
        ? "border-[color-mix(in_oklab,var(--next)_40%,var(--line))]"
        : slot.tag === "sponsor"
          ? "border-[color-mix(in_oklab,var(--sponsor)_40%,var(--line))] bg-[color-mix(in_oklab,var(--sponsor)_8%,var(--surface-2))]"
          : "border-line bg-surface2";
  const tagColor =
    slot.tag === "now"
      ? "text-signal"
      : slot.tag === "next"
        ? "text-next"
        : slot.tag === "sponsor"
          ? "text-sponsor"
          : "text-ink-faint";

  return (
    <div
      role="listitem"
      data-drift
      className={cn(
        "relative flex shrink-0 flex-col justify-between rounded-md border p-3",
        size === "sm" ? "min-w-[128px]" : "min-w-[152px]",
        slot.tag === "aired" && "opacity-60",
        tone
      )}
    >
      {now && (
        <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-[3px] bg-signal shadow-[0_0_12px_var(--signal)]" />
      )}
      <div className="font-mono text-[11px] text-ink-faint">{timeLabel(slot.startsInMin, slot.tag)}</div>
      <div className={cn("mt-1 line-clamp-2 font-semibold leading-snug text-ink", size === "sm" ? "text-[13px]" : "text-sm")}>
        {slot.title}
      </div>
      <div className={cn("mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em]", tagColor)}>
        <span className="inline-flex items-center gap-1">
          {now && <span className="live-dot" />}
          {TAG_LABEL[slot.tag]}
        </span>
        <span className="text-ink-faint">{formatDuration(slot.durationSec)}</span>
      </div>
    </div>
  );
}
