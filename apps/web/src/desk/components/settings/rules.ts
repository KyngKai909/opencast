// Settings' Rules (desk-pages 04): the groups the page draws, and a rule's value as form fields and
// back. Money is typed in dollars (stored in micros), shares in percent (stored in basis points).

import type { RuleView } from "@opencast/contracts";

export const GROUPS: Array<{ id: RuleView["group"]; label: string }> = [
  { id: "pay_as_you_go", label: "Pay-as-you-go" },
  { id: "shares", label: "Shares" },
  { id: "rights", label: "Rights" },
  { id: "relays", label: "Relays" },
  { id: "call_signs", label: "Call signs" },
  { id: "sponsors", label: "Catalog sponsors" },
  // Added 2026-09-29 (follow-up Phase 1): how long watch data is kept and when it shows; the apps' switches.
  { id: "watch_data", label: "Watch data" },
  // Added 2026-09-30 (follow-up Phase 6): other markets' streams and DASH stream links (A200, A201).
  { id: "external", label: "External stations" },
  { id: "features", label: "Features" }
];

/** `letters`: a list of capital-letter words, typed with commas between (call signs' lists). */
export type FieldKind = "dollars" | "percent" | "number" | "choice" | "json" | "letters";

export interface ValueField {
  /** The key in the rule's value; "" for a value that's a single word (payout schedule). */
  name: string;
  label: string;
  kind: FieldKind;
  /** Empty means "Not set yet" (the value is null). */
  nullable: boolean;
  options?: Array<{ value: string; label: string }>;
  /** As typed. */
  text: string;
}

const LABELS: Record<string, [string, FieldKind]> = {
  perGbMonthMicros: ["Price a GB a month", "dollars"],
  perHourMicros: ["Price an hour", "dollars"],
  storageGb: ["Storage, GB", "number"],
  liveHours: ["Live hours", "number"],
  spotBps: ["Spots and sponsorships", "percent"],
  pledgeBps: ["Pledges", "percent"],
  productionBps: ["Production", "percent"],
  shareBps: ["The pool's share", "percent"],
  baseBps: ["Base share", "percent"],
  watchTimeBps: ["Watch-time share", "percent"],
  fundBps: ["Creator fund", "percent"],
  termYears: ["Years after publication", "number"],
  renewalRequiredThrough: ["Renewal searched for works published through", "number"],
  noticeRequiredThrough: ["Notice checked for works published through", "number"],
  allBefore: ["Recordings published before this year", "number"],
  answerDays: ["Answer window, days", "number"],
  counterNoticeBusinessDays: ["Counter-notice wait, business days", "number"],
  upheldIn12Months: ["Upheld claims in 12 months", "number"],
  days: ["Days", "number"],
  platforms: ["Platforms (JSON)", "json"],
  tiers: ["Terms by year (JSON)", "json"],
  signers: ["Keys (JSON)", "json"],
  threshold: ["Approvals a claim needs", "number"],
  reminderDays: ["Reminder, days before the end", "number"],
  impersonation: ["Brands and stations", "letters"],
  denylist: ["Denylist", "letters"],
  seriesMonthlyMicros: ["One series in a market, a month", "dollars"],
  everySeriesMonthlyMicros: ["Every series in a market, a month", "dollars"],
  opencastBps: ["Opencast", "percent"],
  poolBps: ["The co-op pool", "percent"],
  viewers: ["Viewers at once", "number"],
  carriedAirings: ["Other stations' airings, together", "number"]
};

const YES_NO = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" }
];

/** A feature's switch (`features.*`): on or off. */
const ON_OFF = [
  { value: "true", label: "On" },
  { value: "false", label: "Off" }
];

/** Rules whose value has a yes-or-no part, in words. `enabled` is a feature's switch, on or off. */
const YES_NO_LABELS: Record<string, string> = { refuseKwFourLetters: "Refuse K or W and three letters", enabled: "In the apps", allowed: "Allowed", played: "Played" };
const ON_OFF_FIELDS = new Set(["enabled"]);

const trimZeros = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

function textOf(kind: FieldKind, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (kind === "dollars") return trimZeros(((v as number) / 1_000_000).toFixed(6));
  if (kind === "percent") return trimZeros(((v as number) / 100).toFixed(2));
  if (kind === "json") return JSON.stringify(v, null, 2);
  if (kind === "letters") return (v as string[]).join(", ");
  return String(v);
}

/** The value's form fields. `jurisdiction` is fixed ("US only") and isn't a field. */
export function fieldsFor(value: unknown): ValueField[] {
  if (typeof value === "string") return [{ name: "", label: "How often", kind: "choice", nullable: false, options: [{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }], text: value }];
  if (!value || typeof value !== "object") return [{ name: "", label: "Value (JSON)", kind: "json", nullable: false, text: JSON.stringify(value) }];
  return Object.entries(value as Record<string, unknown>)
    .filter(([k]) => k !== "jurisdiction")
    .map(([k, v]) => {
      if (typeof v === "boolean") return { name: k, label: YES_NO_LABELS[k] ?? k, kind: "choice" as const, nullable: false, options: ON_OFF_FIELDS.has(k) ? ON_OFF : YES_NO, text: String(v) };
      const [label, kind] = LABELS[k] ?? [k, Array.isArray(v) || (v && typeof v === "object") ? "json" : "number"];
      return { name: k, label, kind, nullable: v === null || k.endsWith("Micros"), text: textOf(kind, v) };
    });
}

/** The value from the fields, on the shape of `original`; or the first field that doesn't read. */
export function valueFrom(original: unknown, fields: ValueField[]): { value: unknown } | { error: string; field: string } {
  const read = (f: ValueField): { ok: true; v: unknown } | { ok: false; error: string } => {
    const t = f.text.trim();
    if (f.kind === "choice") return { ok: true, v: f.options === YES_NO || f.options === ON_OFF ? t === "true" : t };
    if (f.kind === "letters") {
      const words = t.split(/[\s,]+/).map((w) => w.toUpperCase()).filter(Boolean);
      const bad = words.find((w) => !/^[A-Z]{2,12}$/.test(w));
      return bad ? { ok: false, error: `${bad} isn't 2 to 12 letters.` } : { ok: true, v: [...new Set(words)] };
    }
    if (f.kind === "json") {
      try {
        return { ok: true, v: JSON.parse(t) };
      } catch {
        return { ok: false, error: "That isn't valid JSON." };
      }
    }
    if (!t) return f.nullable ? { ok: true, v: null } : { ok: false, error: "Enter a number." };
    const n = Number(t.replace(/[$,%\s]/g, ""));
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: "Enter a number, 0 or more." };
    if (f.kind === "dollars") return { ok: true, v: Math.round(n * 1_000_000) };
    if (f.kind === "percent") return { ok: true, v: Math.round(n * 100) };
    return { ok: true, v: n };
  };
  if (typeof original !== "object" || original === null) {
    const r = read(fields[0]!);
    return r.ok ? { value: r.v } : { error: r.error, field: fields[0]!.name };
  }
  const out: Record<string, unknown> = { ...(original as Record<string, unknown>) };
  for (const f of fields) {
    const r = read(f);
    if (!r.ok) return { error: r.error, field: f.name };
    out[f.name] = r.v;
  }
  return { value: out };
}

/** Today in UTC, `YYYY-MM-DD`: the earliest a change can take effect. */
export function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** "From November 1": when a version starts, in words. A version from the start of time reads "Since the start". */
export function fromWords(iso: string, dayMonth: (iso: string) => string): string {
  return Date.parse(iso) <= 0 ? "Since the start" : `From ${dayMonth(iso)}`;
}

/** "0x7099…79C8". */
export function shortKey(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
