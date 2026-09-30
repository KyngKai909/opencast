// The Phase 1 STOP demo: a Friday evening, 7:00 to 9:00 pm in Los Angeles, with viewers tuning in
// and out (and a few bots), run through the real heartbeat, the as-run log, carriage and the job
// that works out each airing. Used by test/watch-data-evening.test.ts and scripts/demo-watch-data.ts.
//
//   BEAT 12.1  7:00 Crate Session (its own), 7:30 Night Signal (carried from MAKR), 8:00 Late Crate
//              (its own, a break 8:14 to 8:16), 8:30 Council Watch (its own, a handful watching)
//   MAKR 24.1  7:00 Night Signal (the maker's own airing)
//   HALL 30.1  8:00 Night Signal (carried from MAKR)
//   KRAD 88.x  7:00 Crate Radio, an hour (the radio band: listening time)
import { schema } from "@opencast/db";
import { AudienceReport, MakerWatchData } from "@opencast/contracts";
import { anon, itemFixture, market, radioTenths, stationFixture, type Harness, type User } from "./harness.js";
import { simulate, type SimViewer } from "./watch-sim.js";

/** 7:00 pm on Friday, October 2, 2026 in Los Angeles. */
export const EVENING = "2026-10-03T02:00:00.000Z";
const MIN = 60_000;
const t = (minutes: number, seconds = 0) => new Date(Date.parse(EVENING) + minutes * MIN + seconds * 1000).toISOString();

/** Seeded, so every run is the same evening. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Evening {
  people: { kai: User; maya: User; hal: User; rae: User };
  stations: { beat: string; makr: string; hall: string; krad: string };
  programs: { crateSession: string; nightSignal: string; lateCrate: string; councilWatch: string; crateRadio: string };
  entries: { beat: Record<"crate" | "night" | "late" | "council", string>; makr: string; hall: string; krad: string };
  viewers: SimViewer[];
  beats: number;
  votes: number;
  aggregated: { computed: number; finalized: number; votesDeleted: number };
}

export async function runEvening(h: Harness): Promise<Evening> {
  h.clock.set("2026-10-02T20:00:00.000Z");
  const m = await market(h);
  const kai = await h.signIn("Kai");
  const maya = await h.signIn("Maya");
  const hal = await h.signIn("Hal");
  const rae = await h.signIn("Rae");
  const beat = (await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true, colour: "#8C3B7A" })).id;
  const makr = (await stationFixture(h, { callSign: "MAKR", name: "Maker Television", ownerId: maya.id, marketId: m.id, tenths: 241, signedOn: true })).id;
  const hall = (await stationFixture(h, { callSign: "HALL", name: "Hall Street", ownerId: hal.id, marketId: m.id, tenths: 301, signedOn: true })).id;
  const krad = (await stationFixture(h, { callSign: "KRAD", name: "Crate Radio", ownerId: rae.id, marketId: m.id, tenths: await radioTenths(h, 4), band: "radio", signedOn: true })).id;

  const program = async (as: User, stationId: string, title: string) => (await as.post(`/v1/stations/${stationId}/programs`, { title }).expect(201)).body.id as string;
  const crateSession = await program(kai, beat, "Crate Session");
  const lateCrate = await program(kai, beat, "Late Crate");
  const councilWatch = await program(kai, beat, "Council Watch");
  const nightSignal = await program(maya, makr, "Night Signal");
  const crateRadio = await program(rae, krad, "Crate Radio");
  const item = (stationId: string, programId: string, title: string, minutes = 30) => itemFixture(h, stationId, { title, programId, episodeNumber: 1, durationMs: minutes * MIN });
  const place = async (as: User, stationId: string, itemId: string, startsAt: string, carriageAgreementId?: string) =>
    (await as.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt, itemId, ...(carriageAgreementId ? { carriageAgreementId } : {}) }).expect(201)).body.id as string;

  // Night Signal is offered on the market; BEAT and HALL each carry it (barter).
  const nightEp = await item(makr, nightSignal, "Night Signal, ep. 1");
  const offer = await maya
    .post(`/v1/programs/${nightSignal}/offer`, { termsOffered: ["barter"], cashPriceMicros: null, cashPriceUnit: null, barterMakerMsPerHour: 120_000, airingsPerEpisode: 2, windowDays: 7, liveOnly: false, noticeDays: 7, approval: "i_approve", radioBandAllowed: true })
    .expect(201);
  const carry = async (as: User, carrierStationId: string) => {
    const request = await as.post(`/v1/catalog/offers/${offer.body.id}/requests`, { carrierStationId, term: "barter", slots: [{ weekday: 5, time: "19:30" }], startsOn: "2026-10-02" }).expect(201);
    await maya.post(`/v1/carriage/requests/${request.body.id}/decision`, { decision: "approve" }).expect(200);
    const agreements = await as.get(`/v1/stations/${carrierStationId}/carriage/agreements`).expect(200);
    return agreements.body.carrying[0].id as string;
  };
  const beatAgreement = await carry(kai, beat);
  const hallAgreement = await carry(hal, hall);

  const entries = {
    beat: {
      crate: await place(kai, beat, (await item(beat, crateSession, "Crate Session 02")).id, t(0)),
      night: await place(kai, beat, nightEp.id, t(30), beatAgreement),
      late: await place(kai, beat, (await item(beat, lateCrate, "Late Crate, ep. 14")).id, t(60)),
      council: await place(kai, beat, (await item(beat, councilWatch, "Council Watch")).id, t(90))
    },
    makr: await place(maya, makr, nightEp.id, t(0)),
    hall: await place(hal, hall, nightEp.id, t(60), hallAgreement),
    krad: await place(rae, krad, (await item(krad, crateRadio, "Crate Radio, hour one", 60)).id, t(0))
  };

  // The as-run log, as the playout engine writes it: each program's rows, outside its breaks.
  const programOf: Record<string, string> = { [entries.beat.crate]: crateSession, [entries.beat.night]: nightSignal, [entries.beat.late]: lateCrate, [entries.beat.council]: councilWatch, [entries.makr]: nightSignal, [entries.hall]: nightSignal, [entries.krad]: crateRadio };
  const rows: Array<[string, string, number, number, string | null]> = [
    [beat, entries.beat.crate, 0, 30, null],
    [beat, entries.beat.night, 30, 60, beatAgreement],
    [beat, entries.beat.late, 60, 74, null],
    [beat, entries.beat.late, 76, 90, null],
    [beat, entries.beat.council, 90, 120, null],
    [makr, entries.makr, 0, 30, null],
    [hall, entries.hall, 60, 90, hallAgreement],
    [krad, entries.krad, 0, 60, null]
  ];
  for (const [stationId, logEntryId, from, to, agreementId] of rows) {
    await h.db.insert(schema.asRun).values({ stationId, code: "PGM", startedAt: new Date(t(from)), endedAt: new Date(t(to)), logEntryId, programId: programOf[logEntryId], carriageAgreementId: agreementId, reason: "planned" });
  }

  // Viewers. BEAT's regulars come and go through the evening; twelve who watched Crate Session
  // give Night Signal three minutes; a handful stay up for Council Watch; five bots.
  const random = rng(20261002);
  const viewers: SimViewer[] = [];
  const crowd = (stationId: string, n: number, window: [number, number], meanStay: number, until: number) => {
    for (let i = 0; i < n; i++) {
      const arrive = window[0] + random() * (window[1] - window[0]);
      const stay = 6 + -Math.log(1 - random()) * meanStay;
      const leave = Math.min(arrive + stay, until);
      if (leave - arrive < 1.5) continue;
      viewers.push({ stationId, from: t(Math.floor(arrive), 10), to: t(Math.floor(leave), 5) });
    }
  };
  crowd(beat, 70, [-2, 75], 35, 90);
  const skippers: SimViewer[] = Array.from({ length: 12 }, () => ({ stationId: beat, from: t(0, 10), to: t(33, 5) }));
  const council: SimViewer[] = Array.from({ length: 9 }, (_, i) => ({ stationId: beat, from: t(90, 10), to: t(100 + i * 2, 5) }));
  const bots: SimViewer[] = [
    ...[5, 35, 65].map((minute): SimViewer => ({ stationId: beat, from: t(minute), to: t(minute, 25), bot: "fast" })),
    ...[0, 40].map((minute): SimViewer => ({ stationId: beat, from: t(minute, 10), to: t(minute + 25), bot: "jump", jumpAt: t(minute + 8, 30) }))
  ];
  viewers.push(...skippers, ...council, ...bots);
  crowd(makr, 40, [-2, 8], 25, 31);
  crowd(hall, 30, [58, 70], 20, 91);
  crowd(krad, 30, [-2, 20], 40, 61);

  // "Not for me": five of those who gave up on Night Signal, two on Late Crate, a bot (never
  // counted), one on Council Watch; one of them twice (the second changes nothing).
  let votes = 0;
  const vote = (stationId: string, v: SimViewer) => async () => {
    const res = await anon(h).post(`/v1/stations/${stationId}/not-for-me`).send({ sessionId: v.sessionId });
    if (res.status !== 200) throw new Error(`vote refused: ${JSON.stringify(res.body)}`);
    if (res.body.status === "recorded") votes++;
  };
  const beatViewers = viewers.filter((v) => v.stationId === beat && !v.bot && v !== skippers[0]);
  const lateVoters = beatViewers.filter((v) => Date.parse(v.from) < Date.parse(t(62)) && Date.parse(v.to) > Date.parse(t(72))).slice(0, 2);
  const events = [
    ...skippers.slice(0, 5).map((v) => ({ at: t(32, 30), run: vote(beat, v) })),
    { at: t(32, 40), run: vote(beat, skippers[0]) },
    ...lateVoters.map((v) => ({ at: t(70), run: vote(beat, v) })),
    { at: t(12), run: vote(beat, bots[3]) },
    { at: t(95), run: vote(beat, council[0]) }
  ];
  const { beats } = await simulate(h, viewers, events);

  // The job, an hour and ten minutes after the last program ends (every airing final).
  h.clock.set(t(190));
  const aggregated = await h.services.audience.watch.aggregate();
  return {
    people: { kai, maya, hal, rae },
    stations: { beat, makr, hall, krad },
    programs: { crateSession, nightSignal, lateCrate, councilWatch, crateRadio },
    entries,
    viewers,
    beats,
    votes,
    aggregated
  };
}

// ---------------------------------------------------------------- the report

const local = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).toLowerCase();
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const spark = (series: number[]) => {
  const bars = "▁▂▃▄▅▆▇█";
  const max = Math.max(1, ...series);
  return series.map((v) => (v === 0 ? "·" : bars[Math.min(7, Math.floor((v / max) * 7.999))])).join("");
};

export async function eveningReport(h: Harness, ev: Evening): Promise<{ text: string; beat: AudienceReport; krad: AudienceReport; maker: MakerWatchData }> {
  const window = `from=${t(0)}&to=${t(120)}`;
  const beat = AudienceReport.parse((await ev.people.kai.get(`/v1/stations/${ev.stations.beat}/audience?${window}`).expect(200)).body);
  const krad = AudienceReport.parse((await ev.people.rae.get(`/v1/stations/${ev.stations.krad}/audience?${window}`).expect(200)).body);
  const maker = MakerWatchData.parse((await ev.people.maya.get(`/v1/stations/${ev.stations.makr}/programs/watch-data?from=2026-10-02T00:00:00.000Z&to=2026-10-04T00:00:00.000Z`).expect(200)).body);
  const lines: string[] = [];
  const stationBlock = (name: string, r: AudienceReport) => {
    lines.push(name, `  ${pad("Aired", 8)}${pad("Program", 16)}${pad("Source", 9)}${lpad("Time", 9)}${lpad("Start", 7)}${lpad("Peak", 6)}${lpad("End", 5)}${lpad("Stayed", 8)}${lpad("NfM", 5)}  Tune-aways by minute`);
    for (const p of [...(r.byProgram ?? [])].reverse()) {
      const w = p.watch;
      const aired = p.airedAt ? local(p.airedAt) : "";
      if (!w) continue;
      if (w.status !== "shown") {
        lines.push(`  ${pad(aired, 8)}${pad(p.title, 16)}${pad(p.source, 9)}  ${w.note ?? w.status}`);
        continue;
      }
      const label = w.timeLabel === "listening_time" ? " (listening)" : "";
      lines.push(
        `  ${pad(aired, 8)}${pad(p.title, 16)}${pad(p.source, 9)}${lpad(num(w.watchMinutes!), 9)}${lpad(w.audienceAtStart!, 7)}${lpad(w.peakAudience!, 6)}${lpad(w.audienceAtEnd!, 5)}${lpad(`${w.stayedToTheEnd ?? "-"}%`, 8)}${lpad(w.notForMe!, 5)}  ${spark(w.tuneAways!)}  [${w.tuneAways!.join(" ")}]${label}`
      );
    }
    lines.push("");
  };
  lines.push(`Watch data, Friday evening (${ev.viewers.length} viewers incl. 5 bots, ${ev.beats} heartbeats, ${ev.votes} "Not for me" votes recorded)`, "");
  stationBlock("BEAT 12.1, master control, Audience (its own airings; Time = watch time in minutes)", beat);
  stationBlock("KRAD, master control, Audience (radio: Time = listening time in minutes)", krad);
  lines.push("MAKR, Offering your programs (every station that aired it, added up; never a station's airing)");
  for (const p of maker.programs) {
    if (!p.totals) {
      lines.push(`  ${pad(p.title, 14)} ${pad(p.band, 6)} ${p.note}; other stations' airings not counted: ${p.notCounted.airings}`);
      continue;
    }
    lines.push(
      `  ${pad(p.title, 14)} ${pad(p.band, 6)} ${p.stations} stations, ${p.airings} airings: ${p.timeLabel === "listening_time" ? "listening" : "watch"} time ${num(p.totals.watchMinutes)} min, audience at start ${p.totals.audienceAtStart}, combined peak ${p.totals.combinedPeak}, at end ${p.totals.audienceAtEnd}, stayed ${p.totals.stayedToTheEnd}%, Not for me ${p.totals.notForMe}`,
      `  ${pad("", 21)} tune-aways ${spark(p.totals.tuneAways)}  [${p.totals.tuneAways.join(" ")}]  not counted: ${p.notCounted.airings}`
    );
  }
  lines.push("", "Stored aggregates (audience.airing_stats; no session, no person)");
  const stats = await h.db.select().from(schema.airingStats);
  const callSign = new Map([
    [ev.stations.beat, "BEAT"],
    [ev.stations.makr, "MAKR"],
    [ev.stations.hall, "HALL"],
    [ev.stations.krad, "KRAD"]
  ]);
  lines.push(`  ${pad("Station", 8)}${pad("Started", 9)}${pad("Band", 6)}${pad("Carried", 8)}${lpad("Min", 4)}${lpad("Watch s", 9)}${lpad("Start", 6)}${lpad("Peak", 6)}${lpad("End", 5)}${lpad("Stayed", 7)}${lpad("NfM", 5)}  Final`);
  for (const s of stats.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || (callSign.get(a.stationId) ?? "").localeCompare(callSign.get(b.stationId) ?? ""))) {
    lines.push(
      `  ${pad(callSign.get(s.stationId) ?? s.stationId, 8)}${pad(local(s.startedAt.toISOString()), 9)}${pad(s.band, 6)}${pad(s.carried ? "yes" : "no", 8)}${lpad(s.minutes, 4)}${lpad(s.watchSeconds, 9)}${lpad(s.audienceAtStart, 6)}${lpad(s.peakAudience, 6)}${lpad(s.audienceAtEnd, 5)}${lpad(s.stayedToEnd, 7)}${lpad(s.notForMe, 5)}  ${s.final}`
    );
  }
  const [sessions, minutes, votes] = await Promise.all([h.db.select({ id: schema.sessions.id }).from(schema.sessions), h.db.select({ id: schema.sessionMinutes.sessionId }).from(schema.sessionMinutes), h.db.select({ id: schema.notForMeVotes.sessionId }).from(schema.notForMeVotes)]);
  lines.push(`  (per-session rows now: ${sessions.length} sessions, ${minutes.length} session minutes, ${votes.length} votes; purged after 30 days, votes once final)`);
  return { text: lines.join("\n"), beat, krad, maker };
}

/** 30 days on: the daily purge, and what's left. */
export async function thirtyDaysOn(h: Harness) {
  h.clock.set("2026-11-02T08:00:00.000Z");
  const purged = await h.services.audience.watch.purge();
  const left = {
    sessions: (await h.db.select().from(schema.sessions)).length,
    sessionMinutes: (await h.db.select().from(schema.sessionMinutes)).length,
    votes: (await h.db.select().from(schema.notForMeVotes)).length,
    airingStats: (await h.db.select().from(schema.airingStats)).length,
    minuteSamples: (await h.db.select().from(schema.minuteSamples)).length
  };
  return { purged, left };
}
