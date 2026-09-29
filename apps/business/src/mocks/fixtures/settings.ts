// The Settings area's mock state (biz-settings): invites waiting on each team, each person's
// notification settings per business, connections (Clear Pay, an online checkout), the short name
// title cards use, and the monthly statements the receipts list carries. Saved under its own key,
// so a reload keeps it. Memberships themselves are the shared db's (db.members).
//
// The rules the handlers apply live here as plain functions, so they're tested without a server.

import type { Business, BusinessLocation, Invite, Movement, NotificationPrefs } from "@opencast/contracts";
import type { ReceiptX } from "../../api/ext/settings";
import { now } from "../../lib/clock";
import type { DbMember } from "../db";
import { CYPRESS_ID, OSC_ID } from "./businesses";
import { PEOPLE, uid } from "./people";
import { at } from "./time";

const DAY = 86_400_000;
const $ = (dollars: number) => Math.round(dollars * 1_000_000);

export type Role = DbMember["role"];

export interface MockInvite extends Invite {
  businessId: string;
  note: string | null;
}

export interface MockStatement {
  id: string;
  businessId: string;
  /** "September statement". */
  title: string;
  /** "118 airings, 1 sponsorship". */
  detail: string;
  amountMicros: number;
  /** When it's issued: the first of the next month. Not listed before then. */
  issuedAt: string;
}

export interface SettingsState {
  version: number;
  invites: MockInvite[];
  /** Per person, per business: "<personId>:<businessId>". Missing means the role's defaults. */
  prefs: Record<string, NotificationPrefs>;
  connections: Record<string, { clearPay: boolean; checkout: "shopify" | "stripe" | "square" | null }>;
  shortNames: Record<string, string>;
  statements: MockStatement[];
  /** People who joined through an invite (not in the sign-in list): id to email. */
  joined: Record<string, string>;
  /** Closed businesses: id to when. */
  closed: Record<string, string>;
}

export const SETTINGS_VERSION = 1;
const KEY = "oc-mock-spots-settings";

export function seedSettings(): SettingsState {
  return {
    version: SETTINGS_VERSION,
    invites: [
      // biz-settings 02.1: "sam@orangestreet.example, Invited Friday, Viewer, Not joined yet".
      { id: uid(65001), businessId: OSC_ID, email: "sam@orangestreet.example", phone: null, role: "viewer", note: null, createdAt: at("-1 10:00"), expiresAt: at("+6 10:00"), acceptedAt: null }
    ],
    prefs: {},
    connections: {
      // biz-settings 04.1: Clear Pay connected, no online checkout.
      [OSC_ID]: { clearPay: true, checkout: null },
      [CYPRESS_ID]: { clearPay: false, checkout: null }
    },
    shortNames: { [OSC_ID]: "Orange Street", [CYPRESS_ID]: "Cypress Dental" },
    statements: [
      // biz-settings 03.1. September's is issued October 1: listed from then on.
      { id: uid(66001), businessId: OSC_ID, title: "September statement", detail: "118 airings, 1 sponsorship", amountMicros: $(298.9), issuedAt: at("+5 00:05") },
      { id: uid(66002), businessId: OSC_ID, title: "August statement", detail: "96 airings, 1 sponsorship", amountMicros: $(290.4), issuedAt: at("-25 00:05") },
      { id: uid(66101), businessId: CYPRESS_ID, title: "August statement", detail: "31 airings", amountMicros: $(64.2), issuedAt: at("-25 00:05") }
    ],
    joined: {},
    closed: {}
  };
}

let state: SettingsState | null = null;

export function settingsState(): SettingsState {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as SettingsState) : null;
    state = saved && saved.version === SETTINGS_VERSION ? saved : seedSettings();
  } catch {
    state = seedSettings();
  }
  return state;
}

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settingsState()));
  } catch {
    // Private windows: this visit only.
  }
}

export function resetSettings() {
  state = seedSettings();
  saveSettings();
}

// ---- People ----

export function emailOf(personId: string): string | null {
  return PEOPLE.find((p) => p.id === personId)?.email ?? settingsState().joined[personId] ?? null;
}

export function nameOf(personId: string): string | null {
  return PEOPLE.find((p) => p.id === personId)?.displayName ?? null;
}

// ---- Team ----

export type InviteCheck = { ok: true; replaces: MockInvite | null } | { ok: false; status: number; code: string; message: string };

/**
 * Whether `email` can be invited to a business: not already on the team, and not already invited
 * (an expired invite is replaced).
 */
export function checkInvite(email: string, businessId: string, members: DbMember[], invites: MockInvite[], at: Date): InviteCheck {
  const e = email.trim().toLowerCase();
  if (members.some((m) => m.businessId === businessId && emailOf(m.personId) === e)) return { ok: false, status: 409, code: "already_member", message: `${e} is already on the team.` };
  const waiting = invites.find((i) => i.businessId === businessId && i.email === e && i.acceptedAt === null);
  if (waiting && Date.parse(waiting.expiresAt) > at.getTime())
    return { ok: false, status: 409, code: "already_invited", message: `${e} already has an invite waiting. Resend it from the list.` };
  return { ok: true, replaces: waiting ?? null };
}

/** An invite lasts a week from when it's sent (or sent again). */
export function inviteExpiry(from: Date): string {
  return new Date(from.getTime() + 7 * DAY).toISOString();
}

let seq = 0;
export function newId(): string {
  return uid((Date.now() % 1e9) * 100 + (++seq % 100));
}

// ---- Notifications ----

/** The rows of biz-settings 04.1, and the kind each maps to. */
export const BUSINESS_KINDS = ["low_balance", "spot_paused", "spot_added", "sponsorship_answered", "order_update", "weekly_summary", "code_used"] as const;

/** Spots about to pause can't be turned off (the one alert that protects what's on air). */
export const ALWAYS_ON = ["low_balance"] as const;

/** Where each person starts: everything but every code used; viewers only the weekly summary. */
export function defaultPrefs(role: Role): NotificationPrefs {
  const on = (k: string) => (role === "viewer" ? k === "weekly_summary" || k === "low_balance" : k !== "code_used");
  return Object.fromEntries(BUSINESS_KINDS.map((k) => [k, { push: on(k), email: on(k) }]));
}

/** A person's settings: the defaults, with what they changed on top, and always-on kinds on. */
export function prefsFor(personId: string, businessId: string, role: Role): NotificationPrefs {
  const saved = settingsState().prefs[`${personId}:${businessId}`] ?? {};
  const merged = { ...defaultPrefs(role), ...saved };
  for (const k of ALWAYS_ON) merged[k] = { push: true, email: true };
  return merged;
}

// ---- Receipts ----

/** A receipt for a movement that's one: money added (prepayment), an order or a sponsorship (expenses). */
export function receiptOf(m: Movement): ReceiptX | null {
  const base = { id: m.id, at: m.at, amountMicros: Math.abs(m.amountMicros), pdfUrl: `/mock-media/receipts/${m.id}.pdf` };
  switch (m.kind) {
    case "added": {
      const bank = /bank/i.test(m.label);
      const detail = bank ? (/clear/i.test(m.detail ?? "") ? "Bank transfer through Clear" : "Bank transfer") : /card/i.test(m.label) ? `Card${m.detail ? `, ${m.detail}` : ""}` : m.detail;
      return { ...base, kind: "prepayment", title: "Money added", detail };
    }
    case "order":
      return { ...base, kind: "expense", title: "Production order", detail: m.detail ?? m.label };
    case "sponsorship":
      return { ...base, kind: "expense", title: "Sponsorship", detail: m.detail ?? m.label };
    default:
      return null;
  }
}

/** Every receipt and statement issued by `at`, newest first. */
export function receiptsFor(businessId: string, movements: Movement[], statements: MockStatement[], at: Date): ReceiptX[] {
  const fromMoves = movements.map(receiptOf).filter((r): r is ReceiptX => r !== null);
  const fromStatements: ReceiptX[] = statements
    .filter((s) => s.businessId === businessId && Date.parse(s.issuedAt) <= at.getTime())
    .map((s) => ({ id: s.id, kind: "statement", title: s.title, detail: s.detail, amountMicros: s.amountMicros, at: s.issuedAt, pdfUrl: `/mock-media/receipts/${s.id}.pdf` }));
  return [...fromMoves, ...fromStatements].filter((r) => Date.parse(r.at) <= at.getTime()).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

// ---- Locations ----

/**
 * Whether a location can go: a business with a door or a service area keeps at least one, and a
 * spot that targets it has to be changed first.
 */
export function checkRemoveLocation(b: Business, locationId: string, spots: { title: string; state: string; targeting: { locationIds: string[] } }[]): { ok: true } | { ok: false; message: string } {
  const loc = b.locations.find((l) => l.id === locationId);
  if (!loc) return { ok: false, message: "That location wasn't found." };
  if (b.customersWhere !== "online" && b.locations.length <= 1) return { ok: false, message: "A business needs at least one location or service area. Choose Online instead." };
  const using = spots.find((s) => s.state !== "ended" && s.targeting.locationIds.includes(locationId));
  if (using) return { ok: false, message: `${using.title} targets ${placeName(loc)}. Change its targeting first.` };
  return { ok: true };
}

export function placeName(l: Pick<BusinessLocation, "label" | "city">): string {
  return l.label ?? l.city;
}

export function isClosed(businessId: string): boolean {
  return businessId in settingsState().closed;
}

/** The mock's "now", for handlers. */
export function mockNow(): Date {
  return now();
}

// ---- Receipt PDFs ----
// A one-page PDF of plain lines, so the mock's receipt and statement links open a real document.
function esc(s: string): string {
  // PDF strings: escape the delimiters; keep to Latin-1 (the standard Helvetica encoding).
  return s
    .replace(/[−–—]/g, "-")
    .replace(/[^\x20-\xFF]/g, "?")
    .replace(/[\\()]/g, (c) => `\\${c}`);
}

export function pdfOf(lines: string[]): string {
  const text = lines.map((l, i) => `BT /F1 ${i === 0 ? 16 : 11} Tf 56 ${760 - i * 22} Td (${esc(l)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
