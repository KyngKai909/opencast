// Relays (follow-up Phase 3): the Translators page's one setting for every relay, as the API
// answers it (relayApi.getRelay). BEAT relays everything it airs to its YouTube and Twitch (the
// platforms mock's connections), bug on, its spots in breaks: YouTube is marked as containing paid
// promotion, and Twitch restarts tonight at 11:59 pm, during a break (it's been live since
// Thursday night). Every other station starts on "Live shows only", nothing relayed yet.
// "Relayed this month" comes from the Station account's mock (fixtures/account.ts), as the API
// takes it from pay-as-you-go billing.

import { type RelayPlatformKind, type RelayRestart, type RelaySettings, type RelayView } from "@opencast/contracts";
import { MARKET_TZ, now } from "../../../lib/clock";
import { stationAccount } from "./account";
import { BEAT, uid } from "./stations";

export interface MockPlatform {
  platformId: string;
  kind: RelayPlatformKind;
  name: string;
  connected: boolean;
}

interface MockRelay {
  settings: RelaySettings;
  /** When each platform's current broadcast began (relaying ones). */
  broadcasts: Record<string, string>;
  /** Paid promotion per platform: marked, or a reminder not dismissed. */
  paid: Record<string, "marked" | "remind">;
  restarts: RelayRestart[];
}

const DEFAULTS: RelaySettings = { mode: "live_only", breakHandling: "air_spots", bugOnRelays: true, saveYoutubeVideos: false };
const NAMES: Record<RelayPlatformKind, string> = { youtube: "YouTube", twitch: "Twitch", facebook: "Facebook", kick: "Kick", custom: "Your RTMP destination" };

/** "Saturday at 11:59 pm" (the weekday within a week either way), in the market's time zone, as the API words it. */
export function whenLabel(at: Date, from: Date): string {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: MARKET_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const days = Math.round((Date.parse(day(at)) - Date.parse(day(from))) / 86_400_000);
  const name = days > -7 && days < 7 ? new Intl.DateTimeFormat("en-US", { timeZone: MARKET_TZ, weekday: "long" }).format(at) : new Intl.DateTimeFormat("en-US", { timeZone: MARKET_TZ, month: "long", day: "numeric" }).format(at);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: MARKET_TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(at).replace(" AM", " am").replace(" PM", " pm");
  return `${name} at ${time}`;
}

export function restartLabel(r: Pick<RelayRestart, "kind" | "at" | "deadline" | "duringBreak" | "automatic" | "status">, from: Date): string {
  const who = NAMES[r.kind];
  if (!r.automatic) return `${who} needs a restart by ${whenLabel(new Date(r.deadline), from)}. Restart it there, during a break`;
  if (r.status === "done") return `${who} restarted ${whenLabel(new Date(r.at), from)}${r.duringBreak ? ", during a break" : ""}`;
  if (r.status === "failed") return `${who} couldn't restart ${whenLabel(new Date(r.at), from)}`;
  return `${who} restarts ${whenLabel(new Date(r.at), from)}${r.duringBreak ? ", during a break" : ""}`;
}

/** BEAT as the page is built against: everything relayed, Twitch due a restart tonight. */
function beatSeed(platforms: MockPlatform[]): MockRelay {
  const t = now();
  // Tonight at 11:59 pm in the market (the station ID of the last break before Twitch's limit).
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: MARKET_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  const guess = new Date(`${local}T23:59:55Z`);
  const offsetMinutes = (Date.parse(new Date(guess).toLocaleString("en-US", { timeZone: "UTC" })) - Date.parse(new Date(guess).toLocaleString("en-US", { timeZone: MARKET_TZ }))) / 60_000;
  const tonight = new Date(guess.getTime() + offsetMinutes * 60_000);
  const twitch = platforms.find((p) => p.kind === "twitch");
  const youtube = platforms.find((p) => p.kind === "youtube");
  const broadcasts: Record<string, string> = {};
  const restarts: RelayRestart[] = [];
  if (twitch) {
    // The last restart was 47 hours before tonight's: its 48-hour limit is at 12:59 am, so tonight's
    // is the station ID of the last break before it.
    const last = new Date(tonight.getTime() - 47 * 3_600_000);
    const deadline = new Date(last.getTime() + 48 * 3_600_000);
    broadcasts[twitch.platformId] = last.toISOString();
    restarts.push({ id: uid(7_100_001), platformId: twitch.platformId, kind: "twitch", reason: "limit", status: "scheduled", at: tonight.toISOString(), deadline: deadline.toISOString(), duringBreak: true, automatic: true, label: "", doneAt: null });
    restarts.push({ id: uid(7_100_002), platformId: twitch.platformId, kind: "twitch", reason: "limit", status: "done", at: last.toISOString(), deadline: new Date(last.getTime() + 60 * 60_000).toISOString(), duringBreak: true, automatic: true, label: "", doneAt: last.toISOString() });
  }
  if (youtube) broadcasts[youtube.platformId] = new Date(t.getTime() - 5.5 * 3_600_000).toISOString();
  return { settings: { mode: "everything", breakHandling: "air_spots", bugOnRelays: true, saveYoutubeVideos: false }, broadcasts, paid: youtube ? { [youtube.platformId]: "marked" } : {}, restarts };
}

let relays = new Map<string, MockRelay>();

export function resetRelays() {
  relays = new Map();
}

export function mockRelay(stationId: string, platforms: MockPlatform[]): MockRelay {
  let r = relays.get(stationId);
  if (!r) {
    r = stationId === BEAT.id ? beatSeed(platforms) : { settings: { ...DEFAULTS }, broadcasts: {}, paid: {}, restarts: [] };
    relays.set(stationId, r);
  }
  return r;
}

/** What `getRelay` answers. */
export function relayView(stationId: string, platforms: MockPlatform[], account: ReturnType<typeof stationAccount>): RelayView {
  const r = mockRelay(stationId, platforms);
  const t = now();
  const everything = account.usage.find((u) => u.type === "relay_everything");
  const liveOnly = account.usage.find((u) => u.type === "relay_live_only");
  const pausedBecause = r.settings.mode === "everything" ? (everything?.paused ?? null) : null;
  const relaying = platforms.length > 0 && (r.settings.mode === "everything" ? !pausedBecause : false);
  const labelled = (x: RelayRestart): RelayRestart => ({ ...x, label: restartLabel(x, t) });
  const planned = r.restarts.filter((x) => x.status === "scheduled" || x.status === "due").sort((a, b) => a.at.localeCompare(b.at)).map(labelled);
  const next = new Map<string, RelayRestart>();
  for (const p of planned) if (!next.has(p.platformId) && platforms.some((x) => x.platformId === p.platformId)) next.set(p.platformId, p);
  return {
    stationId,
    ...r.settings,
    status: pausedBecause ? "paused" : relaying ? "relaying" : "off",
    pausedBecause,
    month: {
      month: account.month,
      hours: everything?.quantity ?? 0,
      soFarMicros: everything?.soFarMicros ?? 0,
      estimateMicros: everything?.estimate.micros ?? 0,
      priceMicros: everything?.priceMicros ?? null,
      capMicros: everything?.cap.micros ?? null,
      liveOnlyHours: liveOnly?.quantity ?? 0
    },
    platforms: platforms.map((p) => ({
      platformId: p.platformId,
      kind: p.kind,
      name: p.name,
      connected: p.connected,
      status: relaying ? "relaying" : "idle",
      broadcastStartedAt: relaying ? (r.broadcasts[p.platformId] ?? t.toISOString()) : null,
      nextRestart: relaying ? (next.get(p.platformId) ?? null) : null,
      paidPromotion: r.paid[p.platformId] ?? null
    })),
    nextRestarts: relaying ? [...next.values()] : [],
    recentRestarts: r.restarts.filter((x) => x.status === "done" || x.status === "failed").sort((a, b) => b.at.localeCompare(a.at)).map(labelled),
    canManage: true
  };
}

/** The restart log (`listRelayRestarts`), latest first. */
export function relayRestarts(stationId: string, platforms: MockPlatform[], limit: number): RelayRestart[] {
  const t = now();
  return mockRelay(stationId, platforms)
    .restarts.filter((x) => x.status !== "cancelled")
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
    .map((x) => ({ ...x, label: restartLabel(x, t) }));
}
