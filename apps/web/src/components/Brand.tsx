import { cn } from "../lib/utils";
import { hueFromId } from "../lib/format";

export function SignalGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
      <path
        d="M7.4 7.4a6.5 6.5 0 000 9.2M16.6 16.6a6.5 6.5 0 000-9.2M4.6 4.6a10.5 10.5 0 000 14.8M19.4 19.4a10.5 10.5 0 000-14.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <SignalGlyph className="h-5 w-5 text-signal" />
      <span className="font-display text-lg font-semibold tracking-tight text-ink">
        Open<span className="text-signal">Cast</span>
      </span>
    </span>
  );
}

/** Broadcast channel-number badge, e.g. "07". */
export function ChannelBadge({
  number,
  size = 54,
  brand,
  className
}: {
  number: string;
  size?: number;
  brand?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-md font-display font-bold text-signal-ink glow-ring",
        className
      )}
      style={{ width: size, height: size, fontSize: size * 0.37, background: brand || "var(--signal)" }}
    >
      {number}
    </span>
  );
}

/** Channel avatar — image when available, else a deterministic gradient monogram. */
export function ChannelAvatar({
  id,
  name,
  src,
  size = 40,
  className
}: {
  id: string;
  name: string;
  src?: string;
  size?: number;
  className?: string;
}) {
  const hue = hueFromId(id);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-md border border-line font-display font-semibold text-white/90",
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: src ? undefined : `radial-gradient(120% 120% at 20% 10%, hsl(${hue} 65% 32%), hsl(${(hue + 40) % 360} 55% 12%))`
      }}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials || "•"}
    </span>
  );
}
