/** Formatting helpers shared across the OpenCast UI. */

/** 3725 -> "1:02:05", 92 -> "1:32". */
export function formatDuration(totalSeconds: number | undefined | null): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "0:00";
  }
  const s = Math.floor(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Compact human duration: "2h 05m", "6m", "48s". */
export function formatDurationLong(totalSeconds: number | undefined | null): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "0s";
  }
  const s = Math.floor(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${s}s`;
}

/** 12500 -> "12.5K", 1_400_000 -> "1.4M". */
export function formatCompact(value: number | undefined | null): string {
  const n = value ?? 0;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${trim(n / 1000)}K`;
  return `${trim(n / 1_000_000)}M`;
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

/** Clock time like "14:05" from an ISO string. */
export function formatClock(iso: string | undefined): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** "Today · 14:05", "Tomorrow · 09:00", "Aug 12 · 14:05". */
export function formatWhen(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDelta = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  const time = formatClock(iso);
  if (dayDelta === 0) return `Today · ${time}`;
  if (dayDelta === 1) return `Tomorrow · ${time}`;
  if (dayDelta === -1) return `Yesterday · ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
}

/** "in 12m", "3h", "live now", "2d ago". */
export function formatRelative(iso: string | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const suffix = diffSec >= 0 ? "in " : "";
  const ago = diffSec < 0 ? " ago" : "";
  if (abs < 45) return diffSec >= 0 ? "soon" : "just now";
  if (abs < 3600) return `${suffix}${Math.round(abs / 60)}m${ago}`;
  if (abs < 86_400) return `${suffix}${Math.round(abs / 3600)}h${ago}`;
  return `${suffix}${Math.round(abs / 86_400)}d${ago}`;
}

/** Deterministic hue (0–360) from an id — used for channel color fallbacks. */
export function hueFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }
  return hash;
}

/** Short wallet like "0x1234…abcd". */
export function shortWallet(address: string | undefined | null): string {
  if (!address) return "";
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
