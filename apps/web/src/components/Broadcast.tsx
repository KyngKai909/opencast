import { cn } from "../lib/utils";
import { formatCompact } from "../lib/format";
import { ChannelBadge } from "./Brand";

/** Broadcast lower-third — channel identity overlaid on the stream. */
export function LowerThird({
  number,
  callsign,
  name,
  now,
  brand,
  className
}: {
  number: string;
  callsign?: string;
  name: string;
  now?: string;
  brand?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <ChannelBadge number={number} brand={brand} size={54} />
      <div className="rounded-md border border-white/12 bg-black/55 px-3.5 py-2 backdrop-blur">
        <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-bright">
          CH {number}
          {callsign ? ` · ${callsign}` : ""}
        </div>
        <div className="font-display text-lg font-semibold leading-tight text-white">{name}</div>
        {now && <div className="text-xs text-white/75">On now · {now}</div>}
      </div>
    </div>
  );
}

/** Tally light + concurrent count. */
export function Tally({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-pill border border-line bg-surface2 px-3 py-1.5",
        className
      )}
    >
      <span className="h-2.5 w-2.5 rounded-full bg-onair shadow-[0_0_10px_var(--onair)]" />
      <span className="font-mono text-sm font-semibold tnum text-ink">{formatCompact(count)}</span>
      <span className="text-xs text-ink-muted">watching</span>
    </span>
  );
}

/** Live presence — stacked avatars of people in the room. */
export function Presence({ label, seeds, className }: { label: string; seeds: string[]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="flex">
        {seeds.slice(0, 4).map((s, i) => (
          <span
            key={i}
            className="grid h-6 w-6 place-items-center rounded-full border-2 border-surface2 font-mono text-[10px] text-ink-muted"
            style={{ marginLeft: i === 0 ? 0 : -7, background: `hsl(${(s.charCodeAt(0) * 47) % 360} 40% 24%)` }}
          >
            {s.slice(0, 1).toUpperCase()}
          </span>
        ))}
      </span>
      <span className="text-xs text-ink-muted">{label}</span>
    </span>
  );
}
