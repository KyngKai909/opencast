// The Station area's mock state: break rules, translators, team invites, notification settings,
// rights claims and the claimable station's handover (station-settings, rights, master-control
// A.5). Team members themselves live in the shared db (db.members). Saved under its own key; it
// starts again whenever the shared mock db does (a --fresh run, or "Reset mock data").

import type { BreakRule, ClaimPage, Invite, NotificationPrefs, Translator } from "@opencast/contracts";
import type { ClaimX } from "../../api/ext/station";
import { getDb, saveDb } from "../db";
import { BEAT, CRAT, HALL, stationByRef, uid } from "./stations";
import { at, MIN, SEC } from "./time";

export interface StationInvite extends Invite {
  stationId: string;
  note: string | null;
  programIds: string[];
  /** Who joined with it (the API's `accepted_by`). */
  acceptedBy?: string | null;
}

export interface Handover {
  handoverId: string;
  stationId: string;
  personId: string;
  kind: "claim" | "stop";
  status: "verifying" | "approved" | "waiting_period" | "completed" | "cancelled";
  payableAfter: string | null;
  /** Real time (ms), so the mock's desk can approve a few seconds after a start. */
  startedAtMs: number;
}

export interface ClaimToken {
  token: string;
  stationId: string;
  personEmail: string;
  page: Omit<ClaimPage, "station" | "handover">;
}

export interface StationState {
  version: number;
  breakRules: Record<string, BreakRule>;
  translators: Record<string, Translator[]>;
  invites: StationInvite[];
  /** By `${personId}:${stationId}`. */
  prefs: Record<string, NotificationPrefs>;
  claims: ClaimX[];
  handovers: Handover[];
  claimTokens: ClaimToken[];
}

export const STATION_STATE_VERSION = 1;
const KEY = "oc-mock-control-station";
const DB_KEY = "oc-mock-control-db";

let n = 0;
/** Ids for things this area makes (invites, translators, handovers). */
export const newId = () => uid(7_100_000 + Date.now() % 100_000 * 10 + (++n % 10));

/** The rule BEAT set at sign-on (station-settings 02.1): every 30 minutes, 2:00, 3:00 an hour. */
export function defaultBreakRule(o: Partial<BreakRule> = {}): BreakRule {
  return {
    mode: "after_every_program",
    everyMinutes: null,
    lengthMs: 2 * MIN,
    spotMsPerHour: 3 * MIN,
    sameSpotPerHour: 2,
    fillOrder: ["SPT", "UND", "BMP", "SID"],
    openTimeTo: "spot_market",
    blockedCategories: [],
    adsFromPartners: false,
    // Added 2026-09-29: the station ID, bumpers, credit and spots in every break (as before).
    cadence: { stationId: { every: "break" }, bumpers: { every: "break" }, underwriting: { every: "break" }, spots: { every: "break" } },
    // A242 (2026-10-02): the opener replaces the station ID at sign-on; no opener each morning.
    stationIdAfterOpener: false,
    dailyOpener: false,
    // A247 (2026-10-04): every program, no clock times, nothing more inside long programs.
    everyPrograms: null,
    clockMinutes: null,
    longPrograms: null,
    ...o
  };
}

/** A station's break rule as the mock keeps it (the default until it's set). */
export function breakRuleOf(stationId: string): BreakRule {
  const rule = stationState().breakRules[stationId];
  const cadence = rule?.cadence ? { ...rule.cadence, spots: rule.cadence.spots ?? { every: "break" as const } } : defaultBreakRule().cadence;
  const full = rule ? { ...defaultBreakRule(), ...rule, cadence } : defaultBreakRule();
  // A243: always with the bumper sequences, the defaults (from `cadence.bumpers`) filled in.
  return { ...full, bumperSequences: full.bumperSequences ?? defaultSequences(full.cadence?.bumpers) };
}

/** A243: one into the break and one out of it, as often as the bumpers' cadence; nothing between programs. */
export function defaultSequences(bumpers: NonNullable<BreakRule["cadence"]>["bumpers"] = { every: "break" }): NonNullable<BreakRule["bumperSequences"]> {
  const every = bumpers.every === "n_programs" ? { every: bumpers.every, n: bumpers.n ?? 2 } : { every: bumpers.every };
  return { open: { roles: ["into_break"], ...every }, close: { roles: ["out_of_break"], ...every }, between: { roles: [], every: "program" } };
}

/**
 * Which of a station's breaks (in order) air a part, by the rule's cadence (added 2026-09-29), as
 * the API decides it for breaks nothing has aired in yet: every break; the break after a program
 * (one "After …"); the first after-program break, then every Nth; or the first break in each hour.
 */
export function breaksAiring<B extends { startsAt: string; context: string }>(breaks: B[], part: "stationId" | "bumpers" | "underwriting" | "spots", rule: Pick<BreakRule, "cadence">): B[] {
  const c = rule.cadence?.[part] ?? { every: "break" as const };
  const after = (b: B) => b.context.startsWith("After");
  if (c.every === "break") return breaks;
  if (c.every === "never") return [];
  if (c.every === "program") return breaks.filter(after);
  if (c.every === "n_programs") return breaks.filter(after).filter((_, i) => i % (c.n ?? 2) === 0);
  const hours = new Set<number>();
  return breaks.filter((b) => {
    const h = Math.floor(Date.parse(b.startsAt) / 3_600_000);
    if (hours.has(h)) return false;
    hours.add(h);
    return true;
  });
}

/** Everything is on except "Signed on, signed off" (station-settings 05.1). */
export function defaultPrefs(): NotificationPrefs {
  const on = { push: true, email: false };
  return {
    dead_air_warning: on,
    signal_lost: on,
    signed_on_off: { push: false, email: false },
    spot_paused: on,
    weekly_summary: { push: true, email: true },
    carriage_request: on,
    carried_program_changed: on
  };
}

/** Kinds that can't be turned off: dead air coming, and rights claims (rights 06). */
export const ALWAYS_ON = ["dead_air_warning", "rights_claim"] as const;

/** When dead air starts on stations whose log the mock doesn't keep (HALL: "Dead air in 40 min"). */
export const DEAD_AIR_AT: Record<string, string> = {
  [HALL.id]: at("21:22:12")
};

function itemByTitle(title: string) {
  return getDb().library.items.find((i) => i.title === title);
}

function seedClaims(): ClaimX[] {
  const crate03 = itemByTitle("Crate Session 03");
  const late12 = itemByTitle("Late Crate, ep. 12");
  const SAZN = stationByRef("SAZN")!;
  return [
    {
      id: uid(7_000_001),
      kind: "copyright",
      item: { id: crate03?.id ?? uid(7_000_901), title: "Crate Session 03" },
      station: BEAT,
      claimantName: "Westside Tapes LLC",
      claimantRole: "Says they own the master recording",
      workKind: "A master recording",
      workNoun: "recording",
      claimText: "Crate Session 03 contains our 1994 master recording of 'Night Shift Sessions' in full between 12:40 and 31:05. It was not licensed to Inland Beat.",
      rangeStartMs: 12 * MIN + 40 * SEC,
      rangeEndMs: 31 * MIN + 5 * SEC,
      swornStatement: true,
      state: "open",
      receivedAt: at("15:12"),
      answerDueAt: at("+9 15:12"),
      daysToAnswer: 9,
      answer: null,
      takedowns: [
        {
          station: BEAT,
          pulledAt: at("15:12"),
          airingsReplaced: 1,
          replacedWith: "Late Crate, ep. 13",
          restoredAt: null,
          airings: [{ startsAt: at("+2 20:00"), replacedWith: "Late Crate, ep. 13" }],
          term: null
        }
      ],
      carrierNotice: null
    },
    {
      id: uid(7_000_002),
      kind: "copyright",
      item: { id: late12?.id ?? uid(7_000_902), title: "Late Crate, ep. 12" },
      station: BEAT,
      claimantName: "R. Delgado",
      claimantRole: "Composer",
      workKind: "A sample in the second segment",
      workNoun: "sample",
      claimText: "Late Crate, ep. 12 uses a sample of my composition in its second segment without a licence.",
      rangeStartMs: null,
      rangeEndMs: null,
      swornStatement: true,
      state: "restored",
      receivedAt: at("-38 11:02"),
      answerDueAt: at("-28 11:02"),
      daysToAnswer: null,
      answer: { basis: "made_it", note: null, attachmentUrl: null, answeredAt: at("-37 10:15"), claimantReplyDueAt: at("-23 10:15") },
      takedowns: [
        { station: BEAT, pulledAt: at("-38 11:02"), airingsReplaced: 2, replacedWith: "ep. 13", restoredAt: at("-27 9:00"), airings: [{ startsAt: at("-37 3:00"), replacedWith: "Late Crate, ep. 13" }], term: null },
        { station: HALL, pulledAt: at("-38 11:02"), airingsReplaced: 3, replacedWith: "the next episode", restoredAt: at("-27 9:00"), term: "barter" },
        { station: SAZN, pulledAt: at("-38 11:02"), airingsReplaced: 1, replacedWith: "ep. 11", restoredAt: at("-27 9:00"), term: "barter" }
      ],
      carrierNotice: "Late Crate, ep. 12 from BEAT is off air while a rights claim is resolved. We replaced your 3:00 am airing with ep. 13. You don't need to do anything."
    },
    {
      id: uid(7_000_003),
      kind: "copyright",
      item: { id: uid(7_000_903), title: "BEAT station ID, v1" },
      station: BEAT,
      claimantName: "Loopdeck",
      claimantRole: "Sample library",
      workKind: "Background track",
      workNoun: "track",
      claimText: "The background track in BEAT station ID, v1 is from our library and wasn't licensed for broadcast.",
      rangeStartMs: null,
      rangeEndMs: null,
      swornStatement: true,
      state: "removed",
      receivedAt: at("-86 14:20"),
      answerDueAt: at("-76 14:20"),
      daysToAnswer: null,
      answer: null,
      takedowns: [{ station: BEAT, pulledAt: at("-86 14:20"), airingsReplaced: 4, replacedWith: "BEAT station ID, night", restoredAt: null, term: null }],
      carrierNotice: null
    }
  ];
}

function seed(): StationState {
  return {
    version: STATION_STATE_VERSION,
    breakRules: {
      [BEAT.id]: defaultBreakRule({ mode: "every_n_minutes", everyMinutes: 30, blockedCategories: ["Alcohol", "Gambling", "Political"] })
    },
    translators: {
      [BEAT.id]: [
        {
          id: uid(7_000_101),
          service: "youtube",
          name: "Inland Beat channel",
          rtmpUrl: "rtmps://a.rtmp.youtube.com/live2",
          hasStreamKey: true,
          breakHandling: "air_spots",
          prerecordedLabel: false,
          enabled: true,
          status: "connected"
        }
      ]
    },
    invites: [
      {
        id: uid(7_000_201),
        stationId: BEAT.id,
        email: "dee@example.com",
        phone: null,
        role: "operator",
        note: null,
        programIds: [],
        createdAt: at("-2 10:00"),
        expiresAt: at("+5 10:00"),
        acceptedAt: null
      }
    ],
    prefs: {},
    claims: seedClaims(),
    handovers: [],
    claimTokens: [
      {
        token: "crat-101-9-ready",
        stationId: CRAT.id,
        personEmail: "marcus@example.com",
        page: {
          personName: "Marcus Reyes",
          saidYesAt: at("-45 14:00"),
          works: "a radio station of your mixes and producer interviews",
          worksShort: "your mixes",
          sourcePlatform: "soundcloud",
          onAirSince: at("-45 18:00"),
          presetCount: 88,
          heldMicros: 214_600_000,
          escrowContract: "0x5ee2b8f04c1d3a97e6b2f0d4c8a1e3b5f7d9a41d",
          escrowStationId: 101
        }
      }
    ]
  };
}

let state: StationState | null = null;

export function stationState(): StationState {
  if (state) return state;
  try {
    // A fresh shared db means a fresh evening: start this area's state again too.
    const fresh = localStorage.getItem(DB_KEY) === null;
    const raw = fresh ? null : localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as StationState) : null;
    state = saved && saved.version === STATION_STATE_VERSION ? saved : seed();
  } catch {
    state = seed();
  }
  return state;
}

export function saveStationState() {
  try {
    // Keep the shared db saved too, so a reload doesn't take it (and this) back to the seed.
    if (localStorage.getItem(DB_KEY) === null) saveDb();
    localStorage.setItem(KEY, JSON.stringify(stationState()));
  } catch {
    // Private windows: this visit only.
  }
}

/** For tests. */
export function resetStationState() {
  state = seed();
}
