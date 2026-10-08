// The desk's analytics in the mocks (A251): Ref. 12d's week (13 stations, 76,783 hours), scaled to
// the span asked for, with a shape through the day (evenings busiest, Friday and Saturday most). A
// market lead gets their market only, fixed; a rights reviewer is refused, as the API does.
import { http } from "msw";
import { analyticsApi, type AnalyticsGrowth, type AnalyticsHealth, type AnalyticsMoney, type AnalyticsAudience, type AnalyticsProgram, type AnalyticsProgramDetail, type AnalyticsPrograms, type AnalyticsAiring, type AnalyticsFlow, type AnalyticsMarket, type AnalyticsOverview, type AnalyticsStation, type AnalyticsStationFile, type AnalyticsStationPage, type AnalyticsStationRow, type AnalyticsStations } from "@opencast/contracts";
import { fail, path, personOf, reply } from "../respond";
import { HD, IE, LA } from "../fixtures/markets";
import { isAdminNow, onTeam, rolesOf } from "../settingsDb";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const m = (x: { id: string; slug: string; name: string }): AnalyticsMarket => ({ id: x.id, slug: x.slug, name: x.name });

type Fixture = { station: AnalyticsStation; hours: number; was: number; avg: number; peak: number; stayed: number | null; nfm: number | null; presets: number; dead: number | null; down: number | null; earned: number | null; sessions: number };
const st = (n: number, channel: string, callSign: string, name: string, kind: AnalyticsStation["kind"], band: "tv" | "radio", colour: string, market = IE): AnalyticsStation => ({ id: U(97000 + n), callSign, channel, name, kind, band, colour, market: m(market) });

/** Ref. 12d's week, Sept 29 to Oct 5 (and the week before, `was`). */
const WEEK: Fixture[] = [
  { station: st(1, "12.1", "BEAT", "Beat Tape TV", "independent", "tv", "#8C3B7A"), hours: 16078, was: 14103, avg: 96, peak: 318, stayed: 64, nfm: 3.2, presets: 412, dead: 0, down: null, earned: 553_420_000, sessions: 41_210 },
  { station: st(2, "24.1", "REEL", "Saturday Reel", "independent", "tv", "#B04A2E"), hours: 11895, was: 11117, avg: 71, peak: 340, stayed: 58, nfm: 4.1, presets: 288, dead: 0, down: null, earned: 402_100_000, sessions: 31_008 },
  { station: st(3, "18.1", "SAZN", "Sazón", "independent", "tv", "#9C3D26"), hours: 8710, was: 9266, avg: 52, peak: 138, stayed: 61, nfm: 2.4, presets: 236, dead: 12, down: null, earned: 318_750_000, sessions: 22_310 },
  { station: st(4, "60.1", "OCAT", "Opencast Classics", "catalog", "tv", "#3F5A8C"), hours: 6849, was: 7209, avg: 41, peak: 170, stayed: 49, nfm: 6.8, presets: 150, dead: 0, down: null, earned: 96_000_000, sessions: 18_904 },
  { station: st(5, "88.4", "NITE", "Night Shift Radio", "independent", "radio", "#2E5E8C"), hours: 6377, was: 5694, avg: 38, peak: 132, stayed: 70, nfm: 1.9, presets: 201, dead: 0, down: null, earned: 241_300_000, sessions: 14_512 },
  { station: st(6, "9.1", "RDLS", "Redlands Community TV", "external", "tv", "#3D6B4F"), hours: 5688, was: 5864, avg: 34, peak: 95, stayed: 52, nfm: 5.0, presets: 96, dead: null, down: 14, earned: null, sessions: 15_870 },
  { station: st(7, "33.1", "LUPE", "Tía Lupe’s Kitchen", "claimable", "tv", "#A3532B"), hours: 5234, was: 3686, avg: 31, peak: 89, stayed: 55, nfm: 2.9, presets: 133, dead: 0, down: null, earned: 118_400_000, sessions: 13_002 },
  { station: st(8, "104.2", "VOZE", "La Voz del Valle", "independent", "radio", "#7A3F8C"), hours: 4365, was: 4197, avg: 26, peak: 61, stayed: 66, nfm: 2.2, presets: 141, dead: 3, down: null, earned: 156_900_000, sessions: 10_284 },
  { station: st(9, "7.1", "CIVC", "Civic Channel", "independent", "tv", "#2F6A7A"), hours: 3682, was: 3317, avg: 22, peak: 220, stayed: 47, nfm: 8.9, presets: 88, dead: 0, down: null, earned: 61_000_000, sessions: 9_950 },
  { station: st(10, "90.6", "HALL", "Hall Radio", "independent", "radio", "#5B6B2E", HD), hours: 2854, was: 3036, avg: 17, peak: 40, stayed: 59, nfm: 3.6, presets: 74, dead: 0, down: null, earned: 72_150_000, sessions: 7_016 },
  { station: st(11, "101.8", "CRAT", "Crate Radio", "claimable", "radio", "#8C5B2E"), hours: 2360, was: 1829, avg: 14, peak: 49, stayed: 62, nfm: 2.5, presets: 61, dead: 0, down: null, earned: 81_200_000, sessions: 5_532 },
  { station: st(12, "31.1", "PREP", "Prep Sports", "independent", "tv", "#2E4F8C", LA), hours: 2018, was: 2347, avg: 12, peak: 34, stayed: 38, nfm: 11.4, presets: 40, dead: 47, down: null, earned: 18_300_000, sessions: 4_610 },
  { station: st(13, "92.0", "FLDR", "Mojave Field Recordings", "claimable", "radio", "#6B5B3E", HD), hours: 671, was: 839, avg: 4, peak: 5, stayed: null, nfm: null, presets: 22, dead: 0, down: null, earned: 27_400_000, sessions: 1_496 }
];
const WEEK_HOURS = WEEK.reduce((s, f) => s + f.hours, 0);
const DAY = 86_400_000;

/** How busy an hour is, 0 to 1: mornings light, evenings full, Friday and Saturday nights most. */
function shape(at: Date): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(at);
  const hour = Number(p.find((x) => x.type === "hour")!.value);
  const day = p.find((x) => x.type === "weekday")!.value;
  const base = [0.18, 0.12, 0.08, 0.06, 0.05, 0.07, 0.14, 0.24, 0.3, 0.32, 0.33, 0.36, 0.4, 0.38, 0.36, 0.4, 0.48, 0.58, 0.72, 0.86, 0.96, 1, 0.82, 0.42][hour]!;
  return base * (day === "Fri" || day === "Sat" ? 1.22 : day === "Sun" ? 1.05 : 1);
}

function scopeOf(request: Request) {
  const u = new URL(request.url);
  const from = new Date(u.searchParams.get("from")!);
  const to = new Date(u.searchParams.get("to")!);
  const length = to.getTime() - from.getTime();
  const previousFrom = u.searchParams.get("previousFrom") ? new Date(u.searchParams.get("previousFrom")!) : new Date(from.getTime() - length);
  const p = personOf(request)!;
  const leads = isAdminNow(p) ? [] : rolesOf(p).filter((r) => r.role === "market_lead" && r.market).map((r) => r.market!.id);
  const markets = [IE, HD, LA].filter((x) => isAdminNow(p) || leads.includes(x.id)).map(m);
  const fixed = isAdminNow(p) ? null : (leads[0] ?? null);
  const market = fixed ?? (markets.some((x) => x.id === u.searchParams.get("market")) ? u.searchParams.get("market") : null);
  const band = (u.searchParams.get("band") as "tv" | "radio" | null) ?? "all";
  const elapsed = Math.max(0, Math.min(to.getTime(), Date.now()) - from.getTime());
  const scale = elapsed / (7 * DAY);
  const rows = WEEK.filter((f) => (!market || f.station.market?.id === market) && (band === "all" || f.station.band === band));
  const updated = new Date();
  updated.setUTCHours(13, 0, 0, 0); // 6:00 am Pacific
  return {
    scope: {
      from: from.toISOString(),
      to: to.toISOString(),
      previousFrom: previousFrom.toISOString(),
      previousTo: new Date(previousFrom.getTime() + length).toISOString(),
      markets,
      fixedMarket: fixed,
      market,
      band,
      updatedAt: (updated > new Date() ? new Date(updated.getTime() - DAY) : updated).toISOString()
    } as AnalyticsOverview["scope"],
    from,
    to,
    length,
    scale,
    rows
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const days = (from: Date, to: Date) => Math.max(1, Math.ceil((Math.min(to.getTime(), Date.now()) - from.getTime()) / DAY));
/** Spreads a span's total over its days by their busyness. */
function byDay(total: number, from: Date, to: Date): number[] {
  const n = days(from, to);
  const weights = Array.from({ length: n }, (_, i) => shape(new Date(from.getTime() + i * DAY + 21 * 3_600_000)));
  const sum = weights.reduce((s, w) => s + w, 0) || 1;
  return weights.map((w) => r1((total * w) / sum));
}

function denied(request: Request): Response | null {
  const p = personOf(request);
  if (!p) return fail(401, "unauthorized", "Sign in to do that.");
  if (!onTeam(p)) return fail(403, "forbidden", "Network desk is for the Opencast team.");
  if (!isAdminNow(p) && !rolesOf(p).some((r) => r.role === "market_lead")) return fail(403, "forbidden", "Analytics are for admins and market leads.");
  return null;
}

/** Midnight Pacific at the start of the day an instant falls on. */
function pacificMidnight(at: Date): Date {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(at);
  const guess = Date.parse(`${date}T00:00:00Z`);
  const offset = (t: number) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - t;
  };
  return new Date(guess - offset(guess - offset(guess)));
}

/** A station's page: Ref. 12d's BEAT, scaled for any other station. */
/** What the desk did to stations in this session (added 2026-10-07): holds, and uploads it archived. */
const holds = new Map<string, NonNullable<AnalyticsStationFile["station"]["held"]>>();
const archivedByDesk = new Map<string, { at: string; reason: string }>();

/** The station file (added 2026-10-07): a made-up owner, a few uploads, and the next two days of log. */
function stationFile(request: Request, id: string): AnalyticsStationFile | Response {
  const f = WEEK.find((x) => x.station.id === id);
  if (!f) return fail(404, "not_found", "No such station.");
  const p = personOf(request)!;
  const leads = isAdminNow(p) ? null : rolesOf(p).filter((r) => r.role === "market_lead" && r.market).map((r) => r.market!.id);
  if (leads && !leads.includes(f.station.market?.id ?? "")) return fail(403, "forbidden", "That station isn't in your market.");
  const now = Date.now();
  const iso = (t: number) => new Date(t).toISOString();
  const made = now - 40 * DAY;
  const call = f.station.callSign ?? f.station.name;
  const entries: AnalyticsStationFile["schedule"]["entries"] = [];
  const start = Math.floor(now / 1_800_000) * 1_800_000;
  for (let i = 0; i < 40; i++) {
    const at = start + i * 3_600_000;
    if (new Date(at).getUTCHours() % 6 === 5) continue;
    entries.push({ startsAt: iso(at), endsAt: iso(at + 3_600_000), kind: i === 6 ? "live" : "program", code: "PGM", title: i === 6 ? `${call} Live` : ["Night Tape", "Desert Drive", "Record Club"][i % 3]! });
  }
  const upload = (n: number, title: string, minutes: number, extra: Partial<AnalyticsStationFile["uploads"]["items"][number]> = {}) => ({
    id: `5e5e5e5e-0000-4000-8000-00000000000${n}`,
    title,
    program: n < 3 ? "Night Tape" : null,
    code: "PGM",
    source: "upload" as const,
    sourceUrl: null,
    originalFilename: `${title.toLowerCase().replace(/\W+/g, "-")}.mp4`,
    mediaKind: "video" as const,
    durationMs: minutes * 60_000,
    status: "ready" as const,
    addedAt: iso(made + n * DAY),
    archivedAt: null,
    rights: { basis: "made_it", note: "Filmed it at the station", confirmedAt: iso(made + n * DAY) },
    preview: { status: "ready" as const, url: "/mock-hls/preview.m3u8" },
    ...extra
  });
  const held = holds.get(id) ?? null;
  const items = [
    upload(3, "Unconfirmed clip", 30, { rights: null, preview: null, status: "preparing" }),
    upload(2, "Night Tape 2", 60),
    upload(1, "Night Tape 1", 60),
    upload(4, "Old promo", 1, { archivedAt: iso(now - 5 * DAY), preview: null })
  ].map((u) => {
    const a = archivedByDesk.get(`${id}:${u.id}`);
    return a ? { ...u, archivedAt: a.at, archivedByOpencast: { by: "Dee A.", reason: a.reason }, preview: null } : u;
  });
  const live = items.filter((u) => !u.archivedAt);
  return {
    station: { id, callSign: f.station.callSign, name: f.station.name, kind: f.station.kind === "external" ? "listed" : "station", status: held ? "off_air" : "on_air", handle: null, homeCity: null, description: null, createdAt: iso(made), firstSignedOnAt: iso(made + 3 * DAY), signedOffAt: null, onAir: !held, held },
    started: { how: "signed_up", creator: null },
    people: [
      { userId: "6f6f6f6f-0000-4000-8000-000000000001", name: "Kai Morgan", email: "kai@station.example", role: "owner", joinedAt: iso(made), lastInAt: iso(now - 2 * 3_600_000), lastSeenAt: iso(now - 3_600_000), accountCreatedAt: iso(made - DAY), madeIt: true },
      { userId: "6f6f6f6f-0000-4000-8000-000000000002", name: null, email: "host@station.example", role: "host", joinedAt: iso(made + 5 * DAY), lastInAt: null, lastSeenAt: iso(now - 4 * DAY), accountCreatedAt: iso(made + 5 * DAY), madeIt: false }
    ],
    uploads: {
      total: live.length,
      hours: Math.round(live.reduce((t, u) => t + (u.durationMs ?? 0), 0) / 360_000) / 10,
      rightsToConfirm: live.filter((u) => !u.rights).length,
      archived: items.length - live.length,
      items
    },
    schedule: { now: entries[0] ?? null, week: { program: 6200, live: 60, offAir: 0, empty: 3820 }, entries, lastScheduledAt: iso(now + 5 * DAY), liveSources: 1 }
  };
}

function stationPage(request: Request, id: string): AnalyticsStationPage | Response {
  const f = WEEK.find((x) => x.station.id === id);
  if (!f) return fail(404, "not_found", "No such station.");
  const { scope, from, to, length, scale } = scopeOf(request);
  if (scope.fixedMarket && f.station.market?.id !== scope.fixedMarket) return fail(403, "forbidden", "That station isn't in your market.");
  const k = f.hours / 16078;
  const external = f.station.kind === "external";
  // Its busiest night: the span's last Saturday, 6 pm to 2 am.
  let sat = new Date(Math.min(to.getTime(), Date.now()) - 3_600_000);
  for (let i = 0; i < 7 && new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short" }).format(sat) !== "Sat"; i++) sat = new Date(sat.getTime() - DAY);
  const nightFrom = new Date(pacificMidnight(sat).getTime() + 18 * 3_600_000);
  const nightTo = new Date(nightFrom.getTime() + 8 * 3_600_000);
  const minutes: NonNullable<AnalyticsStationPage["night"]>["minutes"] = [];
  const BREAKS = [[38, 41], [58, 62], [118, 122], [178, 183], [238, 241], [298, 302], [358, 361], [418, 421]];
  const inBreak = (i: number) => BREAKS.some(([a, b]) => i >= a! && i < b!);
  for (let i = 0; i < 480; i++) {
    const rise = i < 156 ? 120 + i * 1.25 : 318 - (i - 156) * 0.72;
    const wobble = Math.sin(i / 7) * 9 + Math.sin(i / 2.3) * 4;
    const v = Math.max(4, rise + wobble - (inBreak(i) ? 34 : 0));
    minutes.push({ at: new Date(nightFrom.getTime() + i * 60_000).toISOString(), value: Math.round(v * k), previous: Math.round((v * 0.9 + Math.cos(i / 9) * 8) * k) });
  }
  const at = (h: number, m = 0) => new Date(nightFrom.getTime() + ((h - 18) * 60 + m) * 60_000).toISOString();
  const REEL = WEEK[1]!.station;
  const CRAT = WEEK[10]!.station;
  const air = (title: string, source: AnalyticsAiring["source"], s: [number, number], e: [number, number], avg: number, peak: number, stayed: number, nfm: number, hours: number, fromStation: AnalyticsStation | null = null): AnalyticsAiring => ({
    key: `mock:${title}`,
    title,
    source,
    from: fromStation,
    startedAt: at(...s),
    endedAt: at(...e),
    averageTunedIn: Math.round(avg * k),
    peakTunedIn: Math.round(peak * k),
    stayedToTheEnd: stayed,
    notForMePer1000Hours: nfm,
    hours: Math.round(hours * k)
  });
  const airings = external
    ? [air("Planning Commission", "guide", [18, 0], [21, 0], 34, 95, 52, 5.0, 102), air("Redlands Community TV, nothing listed", "nothing_listed", [21, 0], [26, 0], 21, 48, 44, 6.1, 105)]
    : [
        air("Crate Session 02", "library", [18, 0], [20, 0], 184, 221, 61, 2.9, 368),
        air("Late Crate, ep. 14", "library", [20, 0], [21, 0], 262, 318, 66, 2.1, 262),
        air("Saturday Reel", "carried", [21, 0], [23, 0], 241, 296, 59, 3.4, 482, REEL),
        air("Beat Tape Live", "live", [23, 0], [24, 30], 148, 205, 70, 1.8, 222),
        air("Overnight Crates", "library", [24, 30], [26, 0], 71, 104, 48, 4.6, 107)
      ];
  const flow = (station: AnalyticsStation | null, share: number): AnalyticsFlow => ({ station, changes: Math.round(share * 120 * k), share });
  const hours = Math.round(f.hours * scale * 10) / 10;
  const earnedScale = (n: number) => Math.round(n * k * scale);
  return {
    scope,
    station: { ...f.station, onDialSince: "2026-06-14T19:00:00.000Z" },
    hoursWatched: { value: hours, previous: Math.round(f.was * (length / (7 * DAY)) * 10) / 10, byDay: byDay(hours, from, to), shareOfNetwork: Math.round((f.hours / WEEK_HOURS) * 1000) / 10 },
    averageTunedIn: { value: f.avg, previous: Math.round(f.avg * (f.was / f.hours)), byDay: byDay(f.avg * days(from, to), from, to) },
    peakTunedIn: { value: f.peak, previous: Math.round(f.peak * 0.88), at: minutes.reduce((p, m) => (m.value > p.value ? m : p), minutes[0]!).at, byDay: byDay(f.peak * days(from, to), from, to) },
    stayedToTheEnd: { value: f.stayed, previous: f.stayed == null ? null : f.stayed - 2, network: 62, byDay: [] },
    notForMePer1000Hours: { value: f.nfm, previous: f.nfm == null ? null : Math.round((f.nfm + 0.4) * 10) / 10, network: 4.0, byDay: [] },
    underMinimum: f.peak < 20,
    night: { from: nightFrom.toISOString(), to: nightTo.toISOString(), minutes: minutes.filter((m) => Date.parse(m.at) < Date.now()), breaks: external ? [] : BREAKS.map(([a, b]) => ({ start: new Date(nightFrom.getTime() + a! * 60_000).toISOString(), end: new Date(nightFrom.getTime() + b! * 60_000).toISOString() })), airings },
    airingsInSpan: Math.round(214 * k * scale),
    platforms: [
      { platform: "phone", hours: Math.round(hours * 0.38) },
      { platform: "tv_app", hours: Math.round(hours * 0.22) },
      { platform: "web", hours: Math.round(hours * 0.2) },
      { platform: "cast", hours: Math.round(hours * 0.15) },
      { platform: "mirror", hours: Math.round(hours * 0.05) }
    ],
    places: [
      { market: f.station.market, own: true, hours: Math.round(hours * 0.81) },
      { market: m(LA), own: false, hours: Math.round(hours * 0.09) },
      { market: null, own: false, hours: Math.round(hours * 0.1) }
    ],
    cameFrom: [flow(null, 58), flow(REEL, 12), flow(WEEK[2]!.station, 8), flow(WEEK[4]!.station, 6), flow(WEEK[3]!.station, 5), flow(WEEK[8]!.station, 6), flow(WEEK[11]!.station, 5)].filter((x) => x.station?.id !== id),
    wentTo: [flow(null, 61), flow(REEL, 14), flow(WEEK[2]!.station, 7), flow(CRAT, 5), flow(WEEK[4]!.station, 4), flow(WEEK[9]!.station, 9)].filter((x) => x.station?.id !== id),
    airtime: external ? null : { programs: Math.round(8222 * scale), breaks: Math.round(1318 * scale), live: Math.round(540 * scale), deadAir: f.dead ?? 0 },
    earned: external
      ? null
      : { spotsMicros: earnedScale(134_830_000), sponsorsMicros: earnedScale(46_150_000), pledgesMicros: earnedScale(374_000_000), pledgeMembers: Math.round(61 * k), carriageInMicros: earnedScale(11_100_000), cardFeesMicros: -earnedScale(12_660_000), totalMicros: earnedScale(553_420_000), held: f.station.kind === "claimable" },
    adMicrosPer1000Hours: external ? null : 11_260_000,
    timeDownMinutes: external ? (f.down ?? 0) : null,
    cost: external ? null : { storageGb: Math.round(412 * k), storageMicros: earnedScale(4_590_000), relayHours: Math.round(168 * k), relayMicros: earnedScale(8_400_000), liveHours: Math.round(9 * k), liveMicros: earnedScale(5_400_000), totalMicros: earnedScale(18_390_000), chargedMicros: earnedScale(14_820_000), breaksWithSpots: 72 }
  };
}

/** The Audience tab: Ref. 12d 04's week, narrowed to a station by its share. */
function audience(request: Request): AnalyticsAudience | Response {
  const { scope, from, to, length, scale, rows } = scopeOf(request);
  const stationId = new URL(request.url).searchParams.get("station");
  const pick = stationId ? WEEK.find((f) => f.station.id === stationId) : null;
  if (stationId && (!pick || !rows.includes(pick))) return fail(404, "not_found", "That station isn't in this view.");
  const view = pick ? [pick] : rows;
  const share = view.reduce((t, f) => t + f.hours, 0) / WEEK_HOURS;
  const sessions = Math.round(200_304 * share * scale);
  const grid: AnalyticsAudience["grid"] = [];
  const monday = new Date("2026-09-28T07:00:00.000Z");
  for (let wd = 0; wd < 7; wd++)
    for (let h = 0; h < 24; h++) {
      const at = new Date(monday.getTime() + (wd * 24 + h) * 3_600_000);
      grid.push({ weekday: wd, hour: h, value: r1(1500 * share * shape(at)), previous: r1(1420 * share * shape(at)) });
    }
  const lengthShares: Array<[string, number]> = [["1_2", 18], ["2_5", 22], ["5_15", 21], ["15_30", 14], ["30_60", 12], ["60_120", 8], ["120_plus", 5]];
  const dayList = Array.from({ length: days(from, to) }, (_, i) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(from.getTime() + i * DAY + 12 * 3_600_000)));
  const hoursByDay = byDay(76_783 * share * scale, from, to);
  const moves = (
    [
      [1, 0, 1412, 31],
      [0, 1, 1288, 24],
      [2, 6, 904, 29],
      [4, 10, 611, 38],
      [6, 2, 588, 22],
      [3, 1, 502, 19],
      [0, 2, 437, 8]
    ] as const
  )
    .map(([a, b, n, pct]) => ({ from: WEEK[a]!.station, to: WEEK[b]!.station, changes: Math.round(n * scale), shareOfFrom: pct }))
    .filter((mv) => rows.some((f) => f.station.id === mv.from.id) && rows.some((f) => f.station.id === mv.to.id) && (!pick || mv.from.id === pick.station.id || mv.to.id === pick.station.id));
  const viaShares: Array<[string, number]> = [["swipe", 24], ["channel", 19], ["guide", 14], ["preset", 12], ["resume", 9], ["search", 7], ["keypad", 5], ["link", 4], ["remote", 3], ["reminder", 2], ["unknown", 1]];
  return {
    scope,
    station: pick?.station ?? null,
    stations: rows.map((f) => f.station),
    grid,
    lengths: lengthShares.map(([band, pct]) => ({ band, sessions: Math.round((sessions * pct) / 100), share: pct })),
    sessions: { value: sessions, previous: Math.round(194_470 * share * (length / (7 * DAY))), byDay: byDay(sessions, from, to) },
    medianMinutes: 9,
    averageMinutes: 23,
    stationsPerVisit: 1.6,
    cameFromAnotherStation: 37,
    bots: { sessions: Math.round(13_012 * share * scale), share: 6.1, reasons: [{ reason: "beats too close together", sessions: Math.round(9_870 * share * scale) }, { reason: "media time moving faster than the clock", sessions: Math.round(3_142 * share * scale) }] },
    presets: {
      total: view.reduce((t, f) => t + f.presets, 0),
      added: Math.round(129 * share * scale),
      stations: [...view].sort((a, b) => b.presets - a.presets).slice(0, 5).map((f) => ({ station: f.station, total: f.presets, added: Math.round(f.presets * 0.09 * scale) }))
    },
    platformsByDay: dayList.map((day, i) => {
      const h = hoursByDay[i] ?? 0;
      return { day, phone: r1(h * 0.41), web: r1(h * 0.22), tv_app: r1(h * 0.19), cast: r1(h * 0.13), mirror: r1(h * 0.05) };
    }),
    relays: {
      byDay: dayList.map((day, i) => ({ day, youtube: r1(60 + 30 * Math.sin(i) * share + 40 * share), twitch: r1(18 + 8 * Math.cos(i)) })),
      youtubeStations: pick ? 1 : 5,
      twitchStations: pick ? 0 : 2,
      hours: Math.round(14_112 * share * scale),
      shareOfOwn: 18
    },
    moves,
    devices: { value: length <= 31 * DAY ? Math.round(61_420 * share) : null, previous: length <= 31 * DAY ? Math.round(58_900 * share) : null, returningShare: 64, byDay: byDay(18_200 * share * days(from, to), from, to) },
    via: viaShares.map(([v, pct]) => ({ via: v, sessions: Math.round((sessions * pct) / 100), share: pct }))
  };
}

/** Ref. 12d 05's programs (title, maker index or "catalog", stations by index, airings, hours, avg, stayed, not for me, live). */
const PROGRAMS: Array<[string, number | "catalog", number[], number, number, number, number, number, boolean]> = [
  ["Late Crate", 0, [0, 2, 9], 11, 2541, 231, 64, 2.8, false],
  ["Crate Session", 0, [0], 7, 2128, 152, 60, 3.1, false],
  ["Night Shift", 4, [4], 7, 2016, 96, 71, 1.6, false],
  ["Saturday Reel", 1, [1, 0], 4, 1952, 244, 58, 3.9, false],
  ["Classic Matinee", "catalog", [3, 8, 11], 21, 1638, 52, 49, 6.9, false],
  ["Tamales for forty", 2, [2], 14, 616, 88, 62, 2.1, false],
  ["Council Watch", 8, [8], 2, 590, 118, 44, 9.8, true],
  ["Beat Tape Live", 0, [0, 10], 2, 492, 164, 66, 2.0, true],
  ["Tía Lupe’s Kitchen", 6, [6], 14, 427, 61, 57, 2.6, false],
  ["Prep Football Live", 11, [11], 1, 183, 61, 41, 7.5, true],
  ["Field Notes", 12, [12], 7, 61, 3, 0, 0, false]
];

function programsOf(request: Request): { list: AnalyticsProgram[]; scope: AnalyticsOverview["scope"]; scale: number } {
  const { scope, scale, rows } = scopeOf(request);
  const inView = new Set(rows.map((f) => f.station.id));
  const list = PROGRAMS.map(([title, maker, on, airings, hours, avg, stayed, nfm, live], i): AnalyticsProgram => {
    const stations = on.map((j) => WEEK[j]!.station).filter((s) => inView.has(s.id));
    const under = title === "Field Notes";
    return {
      programId: U(98000 + i),
      title,
      maker: maker === "catalog" ? null : WEEK[maker]!.station,
      catalog: maker === "catalog",
      live,
      stations,
      airings: Math.max(1, Math.round(airings * scale)),
      hours: Math.round(hours * scale),
      averageTunedIn: avg,
      stayedToTheEnd: under ? null : stayed,
      notForMePer1000Hours: under ? null : nfm,
      underMinimum: under
    };
  }).filter((p) => p.stations.length);
  return { list, scope, scale };
}

/** Ref. 12d 06's week. */
function moneyOf(request: Request): AnalyticsMoney {
  const { scope, to, scale, rows } = scopeOf(request);
  const share = rows.reduce((t, f) => t + f.hours, 0) / WEEK_HOURS;
  const k = (n: number) => Math.round(n * scale * share);
  const kindTotal = (kind: string) => rows.filter((f) => f.station.kind === kind).reduce((t, f) => t + (f.earned ?? 0), 0);
  const measure = (value: number, was: number) => ({ value: Math.round(value * scale), previous: Math.round(was * scale), byDay: byDay(value * scale, new Date(to.getTime() - 7 * DAY), to) });
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const grow = 0.55 + i * 0.07;
    return { from: new Date(to.getTime() - (8 - i) * 7 * DAY).toISOString(), spots: Math.round(620_000_000 * grow * share), sponsors: Math.round(260_000_000 * grow * share), pledges: Math.round(880_000_000 * grow * share), catalogSponsors: Math.round(90_000_000 * grow * share) };
  });
  const per = [[2, 32_260_000], [7, 27_100_000], [10, 24_870_000], [1, 24_750_000], [4, 22_150_000], [9, 18_270_000], [6, 17_690_000], [0, 11_260_000], [8, 11_130_000], [11, 6_100_000]] as const;
  return {
    scope,
    shareSet: false,
    earnedByStations: measure(kindTotal("independent"), kindTotal("independent") / 1.11),
    heldForClaimable: { ...measure(kindTotal("claimable"), kindTotal("claimable") / 1.19), stations: rows.filter((f) => f.station.kind === "claimable").length },
    catalogSponsors: measure(kindTotal("catalog"), kindTotal("catalog") / 1.33),
    payAsYouGo: { value: k(150_100_000), previous: k(131_700_000), byDay: [] },
    costToRun: { value: k(173_100_000), previous: k(168_000_000), byDay: [], complete: true },
    weeks,
    spotMarket: { breaksAired: k(4212), breaksWithSpots: k(2569), spotsAired: k(3906), spotsAiredBefore: k(3426), perThousandMicros: 6_800_000, businesses: 23, businessesBefore: 19, heldNextWeekMicros: k(412_000_000) },
    per1000Hours: per.filter(([i]) => rows.includes(WEEK[i]!)).map(([i, micros]) => ({ station: WEEK[i]!.station, micros, held: WEEK[i]!.station.kind === "claimable" })),
    opencast: {
      in: { storage: k(41_200_000), relays: k(86_400_000), live: k(22_500_000), share: null },
      out: { storage: k(37_400_000), preparing: k(24_100_000), relays: k(52_000_000), live: k(18_600_000), platform: Math.round(41_000_000 * scale) },
      net: k(150_100_000) - k(37_400_000) - k(24_100_000) - k(52_000_000) - k(18_600_000) - Math.round(41_000_000 * scale),
      measured: { storageGb: Math.round(2140 * share), prepareMinutes: k(1446), relayHours: k(1728), liveHours: k(31) }
    },
    held: rows
      .filter((f) => f.station.kind === "claimable")
      .map((f) => ({ station: f.station, since: { LUPE: "2026-08-03T19:00:00.000Z", CRAT: "2026-09-20T19:00:00.000Z", FLDR: "2026-09-01T19:00:00.000Z" }[f.station.callSign ?? ""] ?? null, balanceMicros: { LUPE: 1_104_600_000, CRAT: 388_100_000, FLDR: 96_750_000 }[f.station.callSign ?? ""] ?? 0, addedMicros: Math.round((f.earned ?? 0) * scale) })),
    carriage: { agreements: Math.round(14 * Math.min(1, scale)), cashMicros: k(58_300_000), barterMicros: k(38_100_000), barterMinutes: k(161), programsCarried: 9 }
  };
}

/** Ref. 12d 07's week. */
function healthOf(request: Request): AnalyticsHealth {
  const { scope, from, scale, rows } = scopeOf(request);
  const st = (cs: string) => WEEK.find((f) => f.station.callSign === cs)!.station;
  const inView = (cs: string) => rows.some((f) => f.station.callSign === cs);
  const at = (days: number, h: number, m: number) => new Date(from.getTime() + days * DAY + (h * 60 + m) * 60_000 + 7 * 3_600_000).toISOString();
  const minutesOfWeek = 7 * 24 * 60 * Math.min(1, scale);
  const air = rows
    .filter((f) => f.station.kind !== "external")
    .map((f) => {
      const dead = Math.round((f.dead ?? 0) * scale);
      const slate = f.station.callSign === "PREP" ? Math.round(9 * scale) : 0;
      const off = f.station.band === "radio" ? 0 : Math.round(minutesOfWeek * 0.08);
      const live = ["BEAT", "CIVC", "PREP"].includes(f.station.callSign ?? "") ? Math.round(minutesOfWeek * 0.05) : 0;
      const rest = minutesOfWeek - dead - slate - off - live;
      return { station: f.station, programs: Math.round(rest * 0.86), breaks: Math.round(rest * 0.14), live, offAir: off, deadAirFill: dead, slate };
    })
    .sort((a, b) => b.deadAirFill + b.slate - (a.deadAirFill + a.slate));
  const incidents: AnalyticsHealth["incidents"] = [
    { at: at(1, 2, 10), station: st("PREP"), kind: "dead_air" as const, minutes: 47, tunedIn: 3, detail: null },
    { at: at(2, 16, 5), station: st("VOZE"), kind: "dead_air" as const, minutes: 3, tunedIn: 12, detail: null },
    { at: at(3, 19, 30), station: st("SAZN"), kind: "dead_air" as const, minutes: 12, tunedIn: 41, detail: null },
    { at: at(4, 21, 12), station: st("PREP"), kind: "slate" as const, minutes: 9, tunedIn: 58, detail: null },
    { at: at(5, 15, 40), station: st("BEAT"), kind: "relay" as const, minutes: null, tunedIn: null, detail: "YouTube relay dropped outside a break; reconnected in 40 s" },
    { at: at(6, 11, 0), station: st("RDLS"), kind: "external" as const, minutes: 14, tunedIn: 9, detail: null }
  ].filter((i) => inView(i.station.callSign!) && Date.parse(i.at) < Date.now());
  return {
    scope,
    deadAirFill: { minutes: Math.round(62 * scale), previous: Math.round(18 * scale), stations: 3 },
    slate: { minutes: Math.round(9 * scale), previous: 0, stations: 1 },
    relayDrops: { drops: 1, previous: 2 },
    bots: { sessions: Math.round(13_012 * scale), share: 6.1, previousShare: 5.8 },
    pressToPicture: { medianMs: 840, p90Ms: 2_100, previousMedianMs: 910 },
    airtime: air,
    externalDown: rows.filter((f) => f.station.kind === "external").map((f) => ({ station: f.station, minutes: Math.round((f.down ?? 0) * scale) })),
    incidents,
    relays: { stations: 7, sessions: 62, hours: Math.round(14_112 * scale), drops: 1 },
    botReasons: [
      { reason: "beats too close together", sessions: Math.round(9_870 * scale), share: 75.9 },
      { reason: "media time moving faster than the clock", sessions: Math.round(3_142 * scale), share: 24.1 }
    ],
    slowest: [
      { station: st("PREP"), medianMs: 1_640, p90Ms: 3_900 },
      { station: st("OCAT"), medianMs: 1_210, p90Ms: 2_800 },
      { station: st("RDLS"), medianMs: 1_180, p90Ms: 3_400 }
    ].filter((s) => inView(s.station.callSign!))
  };
}

function growthOf(request: Request): AnalyticsGrowth {
  const { scope, from, to, scale } = scopeOf(request);
  return {
    scope,
    accounts: { new: Math.round(412 * scale), previous: Math.round(366 * scale), active: Math.round(5_870 * Math.min(1, scale + 0.3)), byDay: byDay(412 * scale, from, to) },
    stations: { started: { station: Math.round(6 * scale), studio: Math.round(2 * scale), claimable: 1, listed: Math.round(3 * scale) }, previousStarted: Math.round(9 * scale), signedOn: Math.round(4 * scale) },
    pipeline: { byStage: [{ stage: "found", creators: 31 }, { stage: "asked", creators: 12 }, { stage: "said_yes", creators: 4 }, { stage: "setting_up", creators: 2 }, { stage: "on_air", creators: 9 }, { stage: "claimed", creators: 3 }, { stage: "declined", creators: 5 }], added: Math.round(7 * scale) },
    markets: { open: 3, opened: 0 },
    tvs: { new: [{ platform: "android_tv", tvs: Math.round(64 * scale) }, { platform: "fire_tv", tvs: Math.round(41 * scale) }, { platform: "tv_browser", tvs: Math.round(18 * scale) }, { platform: "google_tv", tvs: Math.round(12 * scale) }], active: Math.round(1_210 * Math.min(1, scale + 0.3)), phonesPaired: Math.round(88 * scale) },
    uploads: { items: Math.round(146 * scale), programItems: Math.round(118 * scale), hours: Math.round(102 * scale), previousItems: Math.round(131 * scale) },
    searches: {
      total: Math.round(3_904 * scale),
      noResults: Math.round(611 * scale),
      top: [["late crate", 214, 3], ["anime", 188, 24], ["naruto", 161, 2], ["cooking", 140, 9], ["news", 133, 6], ["dragon ball", 97, 4], ["football", 91, 2], ["spongebob", 77, 1], ["horror", 64, 0], ["la liga", 51, 0]].map(([term, n, results]) => ({ term: term as string, searches: Math.round((n as number) * scale), results: results as number })),
      nothingFound: [["horror", 64], ["la liga", 51], ["k-drama", 38], ["golf", 22], ["telenovelas", 19]].map(([term, n]) => ({ term: term as string, searches: Math.round((n as number) * scale) }))
    }
  };
}

export const analyticsHandlers = [
  http.get(path(analyticsApi.health), ({ request }) => {
    const no = denied(request);
    if (no) return no;
    return reply(analyticsApi.health.response, healthOf(request));
  }),
  http.get(path(analyticsApi.growth), ({ request }) => {
    const no = denied(request);
    if (no) return no;
    return reply(analyticsApi.growth.response, growthOf(request));
  }),
  http.get(path(analyticsApi.money), ({ request }) => {
    const no = denied(request);
    if (no) return no;
    return reply(analyticsApi.money.response, moneyOf(request));
  }),
  http.get(path(analyticsApi.programs), ({ request }) => {
    const no = denied(request);
    if (no) return no;
    const { list, scope, scale } = programsOf(request);
    const hold = (breaks: number, held: number) => ({ breaks: Math.round(breaks * scale), tunedAtStart: Math.round(breaks * 180 * scale), held });
    const body: AnalyticsPrograms = {
      scope,
      programs: list,
      breaks: {
        all: hold(4212, 92.4),
        byLength: [
          { band: "30", ...hold(612, 97.1) },
          { band: "60", ...hold(1408, 95.0) },
          { band: "90", ...hold(1102, 92.2) },
          { band: "120", ...hold(744, 88.4) },
          { band: "150_plus", ...hold(346, 83.1) }
        ],
        byPosition: [
          { position: "opening", ...hold(812, 95.6) },
          { position: "inside", ...hold(2377, 91.4) },
          { position: "between", ...hold(1023, 89.2) }
        ],
        byFirst: [
          { first: "bumper", ...hold(2569, 93.9) },
          { first: "spot", ...hold(1643, 89.8) }
        ],
        bumperShare: 61
      }
    };
    return reply(analyticsApi.programs.response, body);
  }),
  http.get(path(analyticsApi.program), ({ request, params }) => {
    const no = denied(request);
    if (no) return no;
    const { list, scope } = programsOf(request);
    const program = list.find((p) => p.programId === params.programId);
    if (!program) return fail(404, "not_found", "That program didn't air in this view.");
    const minutes = 60;
    const still: number[] = [];
    const away: number[] = [];
    const breaks = [{ from: 14, to: 16 }, { from: 29, to: 32 }, { from: 44, to: 46 }];
    let v = 100;
    for (let i = 0; i <= minutes; i++) {
      const drop = i === 0 ? 0 : 0.42 + (breaks.some((b) => i >= b.from && i <= b.to) ? 1.6 : 0) + (i === 30 ? 2.4 : 0);
      v = Math.max(0, v - drop);
      still.push(Math.round(v * 10) / 10);
      away.push(Math.round(drop * 22.8));
    }
    const atStart = Math.round(2286 * (program.hours / 2541 || 0.1));
    const body: AnalyticsProgramDetail = {
      scope,
      program,
      stillWatching: still,
      tuneAways: away,
      breaks,
      atStart,
      stillAtEnd: Math.round((atStart * (program.stayedToTheEnd ?? still[minutes]!)) / 100),
      biggestDrop: { minute: 30, points: 4.4, inBreak: true }
    };
    return reply(analyticsApi.program.response, body);
  }),
  http.get(path(analyticsApi.audience), ({ request }) => {
    const no = denied(request);
    if (no) return no;
    const body = audience(request);
    return body instanceof Response ? body : reply(analyticsApi.audience.response, body);
  }),
  // Acting from the desk (added 2026-10-07): admins only, with a reason.
  http.post(path(analyticsApi.takeOffAir), async ({ request, params }) => {
    const no = denied(request);
    if (no) return no;
    if (!isAdminNow(personOf(request)!)) return fail(403, "forbidden", "Only admins can act on a station from the desk.");
    const { reason } = (await request.json()) as { reason: string };
    holds.set(String(params.stationId), { at: new Date().toISOString(), reason, by: "Dee A." });
    const body = stationFile(request, String(params.stationId));
    return body instanceof Response ? body : reply(analyticsApi.takeOffAir.response, body);
  }),
  http.delete(path(analyticsApi.liftHold), ({ request, params }) => {
    const no = denied(request);
    if (no) return no;
    if (!isAdminNow(personOf(request)!)) return fail(403, "forbidden", "Only admins can act on a station from the desk.");
    if (!holds.delete(String(params.stationId))) return fail(404, "not_found", "That station isn't held.");
    const body = stationFile(request, String(params.stationId));
    return body instanceof Response ? body : reply(analyticsApi.liftHold.response, body);
  }),
  http.post(path(analyticsApi.archiveUpload), async ({ request, params }) => {
    const no = denied(request);
    if (no) return no;
    if (!isAdminNow(personOf(request)!)) return fail(403, "forbidden", "Only admins can act on a station from the desk.");
    const { reason } = (await request.json()) as { reason: string };
    archivedByDesk.set(`${String(params.stationId)}:${String(params.itemId)}`, { at: new Date().toISOString(), reason });
    const body = stationFile(request, String(params.stationId));
    return body instanceof Response ? body : reply(analyticsApi.archiveUpload.response, body);
  }),
  http.get(path(analyticsApi.stationFile), ({ request, params }) => {
    const no = denied(request);
    if (no) return no;
    const body = stationFile(request, String(params.stationId));
    return body instanceof Response ? body : reply(analyticsApi.stationFile.response, body);
  }),
  http.get(path(analyticsApi.station), ({ request, params }) => {
    const no = denied(request);
    if (no) return no;
    const body = stationPage(request, String(params.stationId));
    return body instanceof Response ? body : reply(analyticsApi.station.response, body);
  }),
  http.get(path(analyticsApi.overview), ({ request }) => {
    const no = denied(request);
    if (no) return no;
    const { scope, from, to, length, scale, rows } = scopeOf(request);
    const share = rows.reduce((s, f) => s + f.hours, 0) / WEEK_HOURS;
    const hours = r1(76_783 * share * scale);
    const before = r1(72_523 * share * (length / (7 * DAY)));
    const series: AnalyticsOverview["tunedIn"] = [];
    const avg = 457 * share;
    for (let t = Math.floor(from.getTime() / 3_600_000) * 3_600_000; t < Math.min(to.getTime(), Date.now()); t += 3_600_000) {
      const at = new Date(t);
      series.push({ at: at.toISOString(), value: r1(avg * 1.9 * shape(at)), previous: r1(avg * 1.8 * shape(new Date(t - 7 * DAY))) });
    }
    const body: AnalyticsOverview = {
      scope,
      hoursWatched: { value: hours, previous: before, byDay: byDay(hours, from, to) },
      averageTunedIn: { value: r1(457 * share), previous: r1(432 * share), byDay: byDay(457 * share * days(from, to), from, to) },
      peakTunedIn: { value: Math.round(1238 * share), previous: Math.round(1146 * share), at: series.reduce((p, s) => (s.value > p.value ? s : p), series[0] ?? { at: from.toISOString(), value: 0 }).at, byDay: byDay(1238 * share * days(from, to), from, to) },
      sessions: { value: Math.round(200_304 * share * scale), previous: Math.round(194_470 * share * (length / (7 * DAY))), botsFiltered: Math.round(13_040 * share * scale), byDay: byDay(200_304 * share * scale, from, to) },
      medianSessionMinutes: { value: 9, previous: 9, byDay: byDay(9 * days(from, to), from, to) },
      devices: { value: length <= 31 * DAY ? Math.round(61_420 * share * Math.min(1, scale * 0.6 + 0.4)) : null, previous: length <= 31 * DAY ? Math.round(58_900 * share * Math.min(1, scale * 0.6 + 0.4)) : null, byDay: byDay(18_200 * share * days(from, to), from, to) },
      tunedIn: series,
      platforms: [
        { platform: "phone", hours: r1(hours * 0.41) },
        { platform: "web", hours: r1(hours * 0.22) },
        { platform: "tv_app", hours: r1(hours * 0.19) },
        { platform: "cast", hours: r1(hours * 0.13) },
        { platform: "mirror", hours: r1(hours * 0.05) }
      ],
      places: [
        { market: m(IE), hours: r1(hours * 0.71) },
        { market: m(LA), hours: r1(hours * 0.13) },
        { market: m(HD), hours: r1(hours * 0.03) },
        { market: null, hours: r1(hours * 0.13) }
      ],
      stations: rows.map((f) => ({ station: f.station, hours: r1(f.hours * scale), previousHours: r1(f.was * (length / (7 * DAY))) })),
      relays: rows.some((f) => f.station.callSign === "BEAT") ? [{ station: rows.find((f) => f.station.callSign === "BEAT")!.station, platform: "youtube", averageViewers: 41, peakViewers: 133 }] : []
    };
    return reply(analyticsApi.overview.response, body);
  }),

  http.get(path(analyticsApi.stations), ({ request }) => {
    const no = denied(request);
    if (no) return no;
    const { scope, from, to, length, scale, rows } = scopeOf(request);
    const out: AnalyticsStationRow[] = rows.map((f) => ({
      station: f.station,
      hours: r1(f.hours * scale),
      previousHours: r1(f.was * (length / (7 * DAY))),
      averageTunedIn: f.avg,
      peakTunedIn: f.peak,
      sessions: Math.round(f.sessions * scale),
      stayedToTheEnd: f.stayed,
      notForMePer1000Hours: f.nfm,
      presets: f.presets,
      deadAirMinutes: f.dead == null ? null : Math.round(f.dead * scale),
      timeDownMinutes: f.down == null ? null : Math.round(f.down * scale),
      earnedMicros: f.earned == null ? null : Math.round(f.earned * scale),
      held: f.station.kind === "claimable",
      underMinimum: f.peak < 20,
      byDay: byDay(f.hours * scale, from, to)
    }));
    const sum = (k: (r: AnalyticsStationRow) => number) => out.reduce((s, r) => s + k(r), 0);
    const hours = sum((r) => r.hours);
    const weighted = (k: (r: AnalyticsStationRow) => number | null) => {
      const c = out.filter((r) => k(r) != null);
      const h = c.reduce((s, r) => s + r.hours, 0);
      return h ? r1(c.reduce((s, r) => s + k(r)! * r.hours, 0) / h) : null;
    };
    const body: AnalyticsStations = {
      scope,
      rows: out,
      total: {
        hours: r1(hours),
        previousHours: r1(sum((r) => r.previousHours ?? 0)),
        averageTunedIn: sum((r) => r.averageTunedIn),
        peakTunedIn: Math.round(1238 * (rows.reduce((s, f) => s + f.hours, 0) / WEEK_HOURS)),
        sessions: sum((r) => r.sessions),
        stayedToTheEnd: weighted((r) => r.stayedToTheEnd),
        notForMePer1000Hours: weighted((r) => r.notForMePer1000Hours),
        presets: sum((r) => r.presets),
        deadAirMinutes: sum((r) => r.deadAirMinutes ?? 0),
        earnedMicros: sum((r) => r.earnedMicros ?? 0),
        byDay: byDay(hours, from, to)
      }
    };
    return reply(analyticsApi.stations.response, body);
  })
];
