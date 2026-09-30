// Reserved call signs (desk-pages 02): the page's rows and words. Two people holding the same name
// are one row ("2 people"), as the frame draws VALE; every other reservation is its own row, in
// reservation order (the order "Invite the next 10" goes in).

import type { Reservation, ReservationState } from "@opencast/contracts";
import { daysBetween } from "../../lib/dates";

/** The frame's short months: "Aug 30", "Sept 3", "June 2". */
const SHORT = ["Jan", "Feb", "March", "April", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];

export function shortDay(ts: string, timeZone: string): string {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, month: "numeric", day: "numeric" }).formatToParts(new Date(ts));
  const get = (t: string) => Number(f.find((p) => p.type === t)?.value ?? 0);
  return `${SHORT[get("month") - 1]} ${get("day")}`;
}

export interface Line {
  key: string;
  callSign: string;
  state: ReservationState;
  /** One reservation, or everyone asking for the same name. */
  rows: Reservation[];
}

export function linesOf(rows: Reservation[]): Line[] {
  const ordered = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const lines: Line[] = [];
  const bySign = new Map<string, Line>();
  for (const r of ordered) {
    if (r.state === "same_name") {
      const line = bySign.get(r.callSign);
      if (line) {
        line.rows.push(r);
        continue;
      }
      const made: Line = { key: `same-${r.callSign}`, callSign: r.callSign, state: r.state, rows: [r] };
      bySign.set(r.callSign, made);
      lines.push(made);
      continue;
    }
    lines.push({ key: r.id, callSign: r.callSign, state: r.state, rows: [r] });
  }
  return lines;
}

export type Tone = "on" | "wait" | "off" | "plain";

/** The State column's words, and how the sign is drawn (.st9, .st9.on, .st9.wait, .st9.off). */
export function stateWords(r: Reservation, now: Date, timeZone: string): { label: string; tone: Tone } {
  switch (r.state) {
    case "signing_on":
      return { label: "Invited, signing on", tone: "on" };
    case "invited":
      return { label: "Invited", tone: "plain" };
    case "waiting":
      return { label: "Waiting for an invite", tone: "plain" };
    case "same_name":
      return { label: "Same name twice", tone: "wait" };
    case "not_allowed":
      return { label: "Not allowed", tone: "off" };
    case "held_after_sign_off":
      return { label: "Held after sign-off", tone: "plain" };
    case "ending": {
      const days = r.heldUntil ? daysBetween(now, r.heldUntil, timeZone) : 0;
      return { label: days <= 0 ? "Ends today" : days === 1 ? "Ends tomorrow" : `Ends ${shortDay(r.heldUntil!, timeZone)}`, tone: "plain" };
    }
  }
}

export type RowAction = "invite" | "open" | "decide" | "suggest" | "extend" | "release";

/** The buttons at the row's end, as the frame draws them for each state. */
export function actionsFor(state: ReservationState): RowAction[] {
  switch (state) {
    case "waiting":
      return ["invite"];
    case "same_name":
      return ["decide"];
    case "not_allowed":
      return ["suggest"];
    case "ending":
      return ["extend", "release"];
    default:
      return ["open"];
  }
}

export const ACTION_WORDS: Record<RowAction, string> = { invite: "Invite", open: "Open", decide: "Decide", suggest: "Suggest", extend: "Extend", release: "Release" };

/** Who asked: their name and what for, or "2 people" and each one's line. */
export function reservedBy(line: Line): { name: string; detail: string | null } {
  if (line.rows.length > 1) return { name: `${line.rows.length} people`, detail: line.rows.map((r) => r.about ?? r.name ?? r.email ?? "").filter(Boolean).join("; ") || null };
  const r = line.rows[0]!;
  if (r.reason === "signed_off") return { name: "A station that signed off", detail: "Held for it for a year" };
  return { name: r.name ?? r.email ?? "Held by Opencast", detail: r.about ?? (r.name ? r.email : null) };
}

/** The Since column: each one's date ("Sept 8, Sept 11"). */
export function sinceWords(line: Line, timeZone: string): string {
  return line.rows.map((r) => shortDay(r.createdAt, timeZone)).join(", ");
}

/** Who'd get an invite from "Invite the next 10": waiting, allowed, one person per name, with an email. */
export function nextToInvite(rows: Reservation[], count = 10): Reservation[] {
  return [...rows]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .filter((r) => r.reason === "waitlist" && !r.invitedAt && !r.stationId && !r.refusal && !r.sameName.length && !!r.email)
    .slice(0, count);
}

/** "Hank V." or the email: how a person is named in the dialogs. */
export const whoIs = (r: Reservation) => r.name ?? r.email ?? "They";
