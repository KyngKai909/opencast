// Programming Phase 6: the mock API's network licences, what Opencast licenses from distributors
// (licensor, the catalog programs it covers, outlets, territories, dates, the deal), and each one's
// monthly minutes. Kept in localStorage ("oc-mock-desk-licences"; remove it to start again). The
// same rules as the API: `opencast` is always among the outlets, a licence ends on or after it
// starts, and it's worldwide or names its countries. The minutes are the reference's figures, for
// the months a licence was in force.

import { outletsWithOpencast, type LicensorMinutes, type NetworkLicence, type NetworkLicenceInput, type Outlet, type StationIdent } from "@opencast/contracts";
import { now } from "../../lib/clock";
import { U } from "./fixtures/ids";
import { stationById } from "./db";
import { settingsDb } from "./settingsDb";

const KEY = "oc-mock-desk-licences";
const VERSION = 1;
const DAY = 86_400_000;
/** The log warns this far ahead. */
const WARN_DAYS = 14;

export interface MockLicence {
  id: string;
  licensor: string;
  name: string | null;
  outlets: Outlet[];
  worldwide: boolean;
  countries: string[];
  startsOn: string;
  endsOn: string;
  deal: NetworkLicence["deal"];
  notes: string | null;
  programIds: string[];
  itemIds: string[];
  updatedAt: string;
}

interface LicencesDb {
  version: number;
  licences: MockLicence[];
  seq: number;
}

function seed(): LicencesDb {
  const at = "2026-09-20T17:00:00.000Z";
  return {
    version: VERSION,
    seq: 0,
    licences: [
      {
        id: U(9101),
        licensor: "Prairie Films",
        name: "Westerns package",
        outlets: ["opencast", "other_apps", "relays"],
        worldwide: false,
        countries: ["US", "CA"],
        startsOn: "2026-07-01",
        endsOn: "2026-10-08",
        deal: { kind: "rev_share", percent: 12.5 },
        notes: "Renewal under discussion with their sales team.",
        programIds: [U(7206)],
        itemIds: [],
        updatedAt: at
      },
      {
        id: U(9102),
        licensor: "Harbor Light Pictures",
        name: null,
        outlets: ["opencast", "other_apps", "relays", "fast"],
        worldwide: true,
        countries: [],
        startsOn: "2026-09-01",
        endsOn: "2027-08-31",
        deal: { kind: "flat_fee", feeMicros: 500_000_000, per: "month" },
        notes: null,
        programIds: [U(7205)],
        itemIds: [],
        updatedAt: at
      },
      {
        id: U(9103),
        licensor: "Old Reel Archive",
        name: "Summer shorts",
        outlets: ["opencast"],
        worldwide: false,
        countries: ["US"],
        startsOn: "2026-06-01",
        endsOn: "2026-08-31",
        deal: { kind: "none" },
        notes: null,
        programIds: [],
        itemIds: [],
        updatedAt: at
      }
    ]
  };
}

let db: LicencesDb | null = null;

export function licencesDb(): LicencesDb {
  if (db) return db;
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as LicencesDb) : null;
    db = saved && saved.version === VERSION ? saved : seed();
  } catch {
    db = seed();
  }
  return db;
}

export function saveLicences() {
  try {
    localStorage.setItem(KEY, JSON.stringify(licencesDb()));
  } catch {
    // Private windows: kept for this visit only.
  }
}

export function resetLicences() {
  db = seed();
  saveLicences();
}

export function nextLicenceId(): string {
  const d = licencesDb();
  d.seq += 1;
  return U(910_000 + d.seq);
}

const today = () => now().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

export function licenceView(l: MockLicence): NetworkLicence {
  const t = today();
  const daysLeft = l.endsOn >= t ? daysBetween(t, l.endsOn) : null;
  const catalog = stationById(U(111))?.ident ?? null;
  const series = settingsDb().series;
  return {
    id: l.id,
    licensor: l.licensor,
    name: l.name,
    outlets: outletsWithOpencast(l.outlets),
    worldwide: l.worldwide,
    countries: l.countries,
    startsOn: l.startsOn,
    endsOn: l.endsOn,
    deal: l.deal,
    notes: l.notes,
    covers: [
      ...l.programIds.map((id) => ({ kind: "program" as const, id, title: series.find((s) => s.programId === id)?.title ?? "A program", station: catalog })),
      ...l.itemIds.map((id) => ({ kind: "item" as const, id, title: "An item", station: catalog }))
    ],
    state: t < l.startsOn ? "upcoming" : daysLeft === null ? "ended" : daysLeft < WARN_DAYS ? "ending" : "active",
    daysLeft,
    updatedAt: l.updatedAt
  };
}

export function licencesView(): NetworkLicence[] {
  const rank = { ending: 0, active: 1, upcoming: 2, ended: 3 } as const;
  return licencesDb()
    .licences.map(licenceView)
    .sort((a, b) => rank[a.state] - rank[b.state] || a.endsOn.localeCompare(b.endsOn));
}

/** What's wrong with an input, as the API says it; null when it's fine. */
export function checkInput(input: Pick<NetworkLicenceInput, "startsOn" | "endsOn" | "worldwide" | "countries">): { message: string; fields: Record<string, string> } | null {
  if (input.endsOn < input.startsOn) return { message: "It has to end on or after the day it starts.", fields: { endsOn: "Before the start" } };
  if (!input.worldwide && !input.countries.length) return { message: "Choose the countries it covers, or worldwide.", fields: { countries: "Required" } };
  return null;
}

/** The reference's month: three stations' airings, Opencast and relays. Nothing outside its dates. */
export function minutesView(l: MockLicence, month: string): LicensorMinutes {
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const from = first > l.startsOn ? first : l.startsOn;
  const to = last < l.endsOn ? last : l.endsOn;
  const inForce = from <= to && l.programIds.length + l.itemIds.length > 0;
  const days = inForce ? daysBetween(from, to) + 1 : 0;
  const share = days / (daysBetween(first, last) + 1);
  const idents = ["BEAT", "REEL", "CRAT"].map((c) => stationById({ BEAT: U(106), REEL: U(108), CRAT: U(115) }[c]!)?.ident).filter((s): s is StationIdent => Boolean(s));
  const base = [
    { airings: 31, minutes: 2790, viewers: 412.5, relays: 1395, relayViewers: 96.4 },
    { airings: 18, minutes: 1620, viewers: 188.2, relays: 0, relayViewers: 0 },
    { airings: 9, minutes: 810, viewers: null, relays: 0, relayViewers: 0 }
  ];
  const rows: LicensorMinutes["rows"] = [];
  const stations: LicensorMinutes["stations"] = [];
  if (inForce) {
    idents.forEach((station, i) => {
      const b = base[i];
      const minutes = Math.round(b.minutes * share * 10) / 10;
      const airings = Math.round(b.airings * share);
      if (!airings) return;
      const viewerHours = b.viewers === null ? null : Math.round(b.viewers * share * 10) / 10;
      rows.push({ station, outlet: "opencast", airings, minutesAired: minutes, viewerHours });
      const relayHours = l.outlets.includes("relays") && b.relays ? Math.round(b.relayViewers * share * 10) / 10 : null;
      if (relayHours !== null) rows.push({ station, outlet: "relays", airings: Math.round(airings / 2), minutesAired: Math.round(b.relays * share * 10) / 10, viewerHours: relayHours });
      const counted = [viewerHours, relayHours].filter((v): v is number => v !== null);
      stations.push({ station, airings, minutesAired: minutes, viewerHours: counted.length ? Math.round(counted.reduce((a, v) => a + v, 0) * 10) / 10 : null });
    });
  }
  const outlets = (["opencast", "relays"] as const).flatMap((outlet) => {
    const mine = rows.filter((r) => r.outlet === outlet);
    if (!mine.length) return [];
    const hours = mine.filter((r) => r.viewerHours !== null);
    return [{ outlet, minutesAired: Math.round(mine.reduce((a, r) => a + r.minutesAired, 0) * 10) / 10, viewerHours: hours.length ? Math.round(hours.reduce((a, r) => a + r.viewerHours!, 0) * 10) / 10 : null }];
  });
  const counted = stations.filter((s) => s.viewerHours !== null);
  return {
    licenceId: l.id,
    licensor: l.licensor,
    name: l.name,
    month,
    from: inForce ? from : first,
    to: inForce ? to : last,
    minutesAired: Math.round(stations.reduce((a, s) => a + s.minutesAired, 0) * 10) / 10,
    airings: stations.reduce((a, s) => a + s.airings, 0),
    viewerHours: counted.length ? Math.round(counted.reduce((a, s) => a + s.viewerHours!, 0) * 10) / 10 : null,
    stations,
    outlets,
    rows
  };
}

const cell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The same report as the API's CSV. */
export function minutesCsv(r: LicensorMinutes): { filename: string; csv: string } {
  const name = (s: StationIdent) => [s.callSign ?? s.name, s.channel].filter(Boolean).join(" ");
  const lines = [
    ["Month", "Licensor", "Licence", "Station", "Outlet", "Airings", "Minutes aired", "Viewer hours"],
    ...r.rows.map((x) => [r.month, r.licensor, r.name, name(x.station), x.outlet, x.airings, x.minutesAired, x.viewerHours]),
    [r.month, r.licensor, r.name, "All stations", "all", r.airings, r.minutesAired, r.viewerHours]
  ];
  const slug = r.licensor.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "licence";
  return { filename: `minutes-${slug}-${r.month}.csv`, csv: lines.map((l) => l.map(cell).join(",")).join("\n") + "\n" };
}

if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (e.key === KEY || e.key === null) db = null;
  });
