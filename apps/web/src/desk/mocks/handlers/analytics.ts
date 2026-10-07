// The desk's analytics in the mocks (A251): Ref. 12d's week (13 stations, 76,783 hours), scaled to
// the span asked for, with a shape through the day (evenings busiest, Friday and Saturday most). A
// market lead gets their market only, fixed; a rights reviewer is refused, as the API does.
import { http } from "msw";
import { analyticsApi, type AnalyticsMarket, type AnalyticsOverview, type AnalyticsStation, type AnalyticsStationRow, type AnalyticsStations } from "@opencast/contracts";
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

export const analyticsHandlers = [
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
