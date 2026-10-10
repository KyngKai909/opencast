// Network licences and where things can air (programming Phase 6). The Network desk keeps what
// Opencast licenses from distributors and other licensors: who, what it covers (programs, or single
// items), outlets, territories, dates and the deal. `clearance` puts every source of an answer
// together (the station's rights, the carriage agreement, the licences) for `@opencast/domain`'s
// `clearance`, which decides: relays (the sender's slate), the log's quiet notes, and (Phase 5,
// added by the lead) the other-apps playlists read it. And the licensor's monthly minutes, from the
// as-run log.

import { eq, inArray, or } from "drizzle-orm";
import { schema } from "@opencast/db";
import { outletsWithOpencast, type LicensorMinutes, type NetworkLicence, type NetworkLicenceInput, type Outlet, type StationIdent } from "@opencast/contracts";
import { clearance as decide, dateIn, type Clearance, type ClearanceLicence } from "@opencast/domain";
import type { ModuleContext } from "../../context.js";
import type { CurrentUser } from "../../http.js";
import { badRequest, notFound } from "../../errors.js";

const L = schema.networkLicences;
const C = schema.networkLicenceCovers;
const DAY = 86_400_000;
/** The log warns this far ahead of a licence's last day. */
export const LICENCE_WARNING_DAYS = 14;

/** Something that airs, as clearance reads it: the item, and the agreement it's carried under. */
export interface ClearanceRow {
  assetId: string;
  agreementId?: string | null;
  /** When it airs, if not `options.at`. */
  at?: Date;
}

export interface LicencesService {
  list(user: CurrentUser): Promise<NetworkLicence[]>;
  get(user: CurrentUser, licenceId: string): Promise<NetworkLicence>;
  create(user: CurrentUser, input: NetworkLicenceInput): Promise<NetworkLicence>;
  update(user: CurrentUser, licenceId: string, input: Partial<NetworkLicenceInput>): Promise<NetworkLicence>;
  /** The network licences covering each item (its own, or its program's), by item id; items no licence covers are left out. */
  covering(items: Array<{ id: string; programId: string | null }>): Promise<Map<string, ClearanceLicence[]>>;
  /**
   * Items off the air at `at` because no licence covering them is in force then (it ended, or
   * hasn't started), read in `timeZone` (the station's). Items no licence covers air as before.
   */
  offAirItems(items: Array<{ id: string; programId: string | null }>, at: Date, timeZone?: string): Promise<Set<string>>;
  /**
   * May each row air on `outlet` for a viewer in `country` (null: unknown, as on a relay) at
   * `options.at`? One answer per row, in order: the station's rights to the item, the agreement
   * it's carried under, and the licences covering it, decided by `@opencast/domain`'s `clearance`.
   */
  clearance(rows: ClearanceRow[], outlet: Outlet, country: string | null, options: { at: Date; timeZone?: string }): Promise<Clearance[]>;
  /** The licensor's monthly report (`month` "2026-10"; this month by default). */
  minutes(user: CurrentUser, licenceId: string, month?: string): Promise<LicensorMinutes>;
  minutesCsv(user: CurrentUser, licenceId: string, month?: string): Promise<{ filename: string; csv: string }>;
}

/** The deal as columns. */
function dealColumns(deal: NetworkLicenceInput["deal"]) {
  return {
    dealKind: deal.kind,
    revShareBasisPoints: deal.kind === "rev_share" ? Math.round(deal.percent * 100) : null,
    flatFeeMicros: deal.kind === "flat_fee" ? deal.feeMicros : null,
    flatFeePer: deal.kind === "flat_fee" ? deal.per : null
  };
}

function dealOf(r: typeof L.$inferSelect): NetworkLicence["deal"] {
  if (r.dealKind === "rev_share") return { kind: "rev_share", percent: (r.revShareBasisPoints ?? 0) / 100 };
  if (r.dealKind === "flat_fee") return { kind: "flat_fee", feeMicros: r.flatFeeMicros ?? 0, per: r.flatFeePer ?? "term" };
  return { kind: "none" };
}

const asClearance = (r: typeof L.$inferSelect): ClearanceLicence => ({
  id: r.id,
  licensor: r.licensor,
  outlets: outletsWithOpencast(r.outlets as Outlet[]),
  worldwide: r.worldwide,
  countries: r.countries,
  startsOn: r.startsOn,
  endsOn: r.endsOn
});

/** "1,234.5": minutes and hours, one decimal place. */
const round1 = (n: number) => Math.round(n * 10) / 10;

/** A CSV cell. */
const cell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function createLicencesService(ctx: ModuleContext): LicencesService {
  const { deps, services } = ctx;
  const { db } = deps;

  async function row(licenceId: string) {
    const [r] = await db.select().from(L).where(eq(L.id, licenceId));
    if (!r) throw notFound("That licence");
    return r;
  }

  async function views(rows: Array<typeof L.$inferSelect>): Promise<NetworkLicence[]> {
    if (!rows.length) return [];
    const covers = await db.select().from(C).where(inArray(C.licenceId, rows.map((r) => r.id)));
    const { items, programs } = await services.library.titles({ itemIds: covers.flatMap((c) => (c.assetId ? [c.assetId] : [])), programIds: covers.flatMap((c) => (c.programId ? [c.programId] : [])) });
    const [refs, programRefs] = await Promise.all([
      services.library.itemsByIds(covers.flatMap((c) => (c.assetId ? [c.assetId] : []))),
      services.library.programsByIds(covers.flatMap((c) => (c.programId ? [c.programId] : [])))
    ]);
    const idents = await services.stations.idents([...[...refs.values()].map((i) => i.stationId), ...[...programRefs.values()].map((p) => p.stationId)]);
    // Days are counted on the Network desk's own calendar (UTC): a station's own time zone applies on its log.
    const today = dateIn(deps.clock.now());
    return rows.map((r) => {
      const daysLeft = r.endsOn >= today ? Math.round((Date.parse(`${r.endsOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY) : null;
      const state = today < r.startsOn ? "upcoming" : daysLeft === null ? "ended" : daysLeft < LICENCE_WARNING_DAYS ? "ending" : "active";
      return {
        id: r.id,
        licensor: r.licensor,
        name: r.name,
        outlets: outletsWithOpencast(r.outlets as Outlet[]),
        worldwide: r.worldwide,
        countries: r.countries,
        startsOn: r.startsOn,
        endsOn: r.endsOn,
        deal: dealOf(r),
        notes: r.notes,
        covers: covers
          .filter((c) => c.licenceId === r.id)
          .map((c) =>
            c.programId
              ? { kind: "program" as const, id: c.programId, title: programs.get(c.programId) ?? "A program", station: idents.get(programRefs.get(c.programId)?.stationId ?? "") ?? null }
              : { kind: "item" as const, id: c.assetId!, title: items.get(c.assetId!) ?? "An item", station: idents.get(refs.get(c.assetId!)?.stationId ?? "") ?? null }
          ),
        state,
        daysLeft,
        updatedAt: r.updatedAt.toISOString()
      };
    });
  }

  function check(input: Pick<NetworkLicenceInput, "startsOn" | "endsOn" | "worldwide" | "countries">) {
    if (input.endsOn < input.startsOn) throw badRequest("It has to end on or after the day it starts.", { endsOn: "Before the start" });
    if (!input.worldwide && !input.countries.length) throw badRequest("Choose the countries it covers, or worldwide.", { countries: "Required" });
  }

  async function setCovers(licenceId: string, input: { programIds?: string[]; itemIds?: string[] }) {
    if (input.programIds === undefined && input.itemIds === undefined) return;
    const programIds = [...new Set(input.programIds ?? [])];
    const itemIds = [...new Set(input.itemIds ?? [])];
    const [programs, items] = await Promise.all([services.library.programsByIds(programIds), services.library.itemsByIds(itemIds)]);
    const missing = [...programIds.filter((id) => !programs.has(id)), ...itemIds.filter((id) => !items.has(id))];
    if (missing.length) throw notFound("A program or item it covers");
    await db.transaction(async (tx) => {
      await tx.delete(C).where(eq(C.licenceId, licenceId));
      const values = [...programIds.map((programId) => ({ licenceId, programId })), ...itemIds.map((assetId) => ({ licenceId, assetId }))];
      if (values.length) await tx.insert(C).values(values);
    });
  }

  async function forLicence(user: CurrentUser, licenceId: string) {
    const r = await row(licenceId);
    return (await views([r]))[0];
  }

  /** The month asked for ("2026-10"), or this one. */
  function monthOf(month: string | undefined) {
    const m = month ?? deps.clock.now().toISOString().slice(0, 7);
    const [y, mo] = m.split("-").map(Number);
    if (!y || !mo || mo < 1 || mo > 12) throw badRequest("Ask for a month as YYYY-MM.", { month: "YYYY-MM" });
    const from = new Date(Date.UTC(y, mo - 1, 1));
    const to = new Date(Date.UTC(y, mo, 1));
    return { month: m, from, to };
  }

  const service: LicencesService = {
    async list() {
      const rows = await db.select().from(L);
      const all = await views(rows);
      const rank = { ending: 0, active: 1, upcoming: 2, ended: 3 } as const;
      return all.sort((a, b) => rank[a.state] - rank[b.state] || a.endsOn.localeCompare(b.endsOn) || a.licensor.localeCompare(b.licensor));
    },

    get: forLicence,

    async create(user, input) {
      await services.settings.requireDesk(user, "rights");
      check(input);
      const [r] = await db
        .insert(L)
        .values({
          licensor: input.licensor,
          name: input.name?.trim() || null,
          outlets: outletsWithOpencast(input.outlets),
          worldwide: input.worldwide,
          countries: input.worldwide ? [] : [...new Set(input.countries)],
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          ...dealColumns(input.deal),
          notes: input.notes?.trim() || null,
          createdBy: user.id,
          createdAt: deps.clock.now(),
          updatedAt: deps.clock.now()
        })
        .returning();
      try {
        await setCovers(r.id, input);
      } catch (error) {
        await db.delete(L).where(eq(L.id, r.id));
        throw error;
      }
      return forLicence(user, r.id);
    },

    async update(user, licenceId, input) {
      await services.settings.requireDesk(user, "rights");
      const current = await row(licenceId);
      const merged = {
        startsOn: input.startsOn ?? current.startsOn,
        endsOn: input.endsOn ?? current.endsOn,
        worldwide: input.worldwide ?? current.worldwide,
        countries: input.countries ?? current.countries
      };
      check(merged);
      await setCovers(licenceId, input);
      await db
        .update(L)
        .set({
          ...(input.licensor !== undefined ? { licensor: input.licensor } : {}),
          ...(input.name !== undefined ? { name: input.name?.trim() || null } : {}),
          ...(input.outlets !== undefined ? { outlets: outletsWithOpencast(input.outlets) } : {}),
          worldwide: merged.worldwide,
          countries: merged.worldwide ? [] : [...new Set(merged.countries)],
          startsOn: merged.startsOn,
          endsOn: merged.endsOn,
          ...(input.deal ? dealColumns(input.deal) : {}),
          ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
          updatedAt: deps.clock.now()
        })
        .where(eq(L.id, licenceId));
      return forLicence(user, licenceId);
    },

    async covering(items) {
      const result = new Map<string, ClearanceLicence[]>();
      if (!items.length) return result;
      const itemIds = [...new Set(items.map((i) => i.id))];
      const programIds = [...new Set(items.flatMap((i) => (i.programId ? [i.programId] : [])))];
      const rows = await db
        .select({ cover: C, licence: L })
        .from(C)
        .innerJoin(L, eq(L.id, C.licenceId))
        .where(or(inArray(C.assetId, itemIds), ...(programIds.length ? [inArray(C.programId, programIds)] : [])));
      if (!rows.length) return result;
      for (const item of items) {
        const found = rows.filter((r) => r.cover.assetId === item.id || (item.programId && r.cover.programId === item.programId));
        if (!found.length) continue;
        const unique = new Map(found.map((r) => [r.licence.id, asClearance(r.licence)]));
        result.set(item.id, [...unique.values()]);
      }
      return result;
    },

    async offAirItems(items, at, timeZone) {
      const covering = await service.covering(items);
      const off = new Set<string>();
      for (const [id, licences] of covering) {
        // Opencast's own apps: only a licence's dates take it off.
        if (!decide({ rights: { basis: "made_it" }, licences }, "opencast", null, { at, timeZone }).cleared) off.add(id);
      }
      return off;
    },

    async clearance(rows, outlet, country, options) {
      if (!rows.length) return [];
      const assetIds = [...new Set(rows.map((r) => r.assetId))];
      const agreementIds = [...new Set(rows.flatMap((r) => (r.agreementId ? [r.agreementId] : [])))];
      const [rights, agreements] = await Promise.all([services.library.rightsOf(assetIds), services.catalog.agreementsByIds(agreementIds)]);
      const [licenceKinds, covering] = await Promise.all([
        services.network.licencesOfRecords([...rights.values()].flatMap((r) => (r.licenceRecordId ? [r.licenceRecordId] : []))),
        service.covering([...rights].map(([id, r]) => ({ id, programId: r.programId })))
      ]);
      return rows.map((r) => {
        const right = rights.get(r.assetId);
        const agreement = r.agreementId ? agreements.get(r.agreementId) : undefined;
        return decide(
          {
            rights: right ? { basis: right.basis, outlets: right.outlets, licence: right.licenceRecordId ? (licenceKinds.get(right.licenceRecordId) ?? null) : null } : null,
            carriage: r.agreementId ? { outlets: agreement?.outlets ?? null } : null,
            licences: covering.get(r.assetId) ?? []
          },
          outlet,
          country,
          { at: r.at ?? options.at, timeZone: options.timeZone }
        );
      });
    },

    async minutes(user, licenceId, month) {
      const licence = await forLicence(user, licenceId);
      const span = monthOf(month);
      // The month's days it was in force.
      const first = [span.from.toISOString().slice(0, 10), licence.startsOn].sort()[1];
      const last = [new Date(span.to.getTime() - DAY).toISOString().slice(0, 10), licence.endsOn].sort()[0];
      const programIds = licence.covers.filter((c) => c.kind === "program").map((c) => c.id);
      const itemIds = licence.covers.filter((c) => c.kind === "item").map((c) => c.id);
      const aired = first <= last ? await services.playout.airedOf({ itemIds, programIds, from: span.from, to: span.to }) : [];
      const stationIds = [...new Set(aired.map((a) => a.stationId))];
      const idents = await services.stations.idents(stationIds);
      const relaySessions = stationIds.length ? (await services.playout.relaySessions(span.from, span.to)).filter((s) => stationIds.includes(s.stationId) && s.relayMode !== "live_only") : [];
      // What the relay sent: the airing's time inside a relay session, when it was cleared for relays then.
      const relayed = new Map<string, Array<{ from: Date; to: Date }>>();
      const zones = new Map(await Promise.all(stationIds.map(async (id) => [id, await services.stations.timezoneOf(id)] as const)));
      const relayClear = new Map<string, boolean>();
      for (const stationId of stationIds) {
        const mine = aired.filter((a) => a.stationId === stationId && a.assetId);
        const answers = await service.clearance(mine.map((a) => ({ assetId: a.assetId!, agreementId: a.agreementId, at: a.startedAt })), "relays", null, { at: span.from, timeZone: zones.get(stationId) });
        mine.forEach((a, i) => relayClear.set(a.id, answers[i].cleared));
      }
      aired.forEach((a) => {
        if (!relayClear.get(a.id)) return;
        for (const s of relaySessions.filter((x) => x.stationId === a.stationId)) {
          const from = new Date(Math.max(a.startedAt.getTime(), s.startedAt.getTime()));
          const to = new Date(Math.min(a.endedAt.getTime(), s.endedAt.getTime()));
          if (to > from) relayed.set(a.stationId, [...(relayed.get(a.stationId) ?? []), { from, to }]);
        }
      });
      const minutesOf = (spans: Array<{ from: Date; to: Date }>) => spans.reduce((t, s) => t + (s.to.getTime() - s.from.getTime()) / 60_000, 0);
      const rows: LicensorMinutes["rows"] = [];
      const stations: LicensorMinutes["stations"] = [];
      for (const stationId of stationIds) {
        const station = idents.get(stationId);
        if (!station) continue;
        const mine = aired.filter((a) => a.stationId === stationId);
        const spans = mine.map((a) => ({ from: a.startedAt, to: a.endedAt }));
        const airings = new Set(mine.map((a) => a.logEntryId ?? a.id)).size;
        // Each outlet it went out on. Programming Phase 5 adds `other_apps` here: the minutes a
        // station's channel list carried it (cleared for other apps) and the "Other apps" viewers.
        const outlets: Array<{ outlet: Outlet; spans: Array<{ from: Date; to: Date }>; viewerSeconds: number | null }> = [
          { outlet: "opencast", spans, viewerSeconds: await services.audience.viewerSeconds(stationId, spans) },
          ...(relayed.get(stationId)?.length ? [{ outlet: "relays" as const, spans: relayed.get(stationId)!, viewerSeconds: await services.platforms.viewerSeconds(stationId, relayed.get(stationId)!) }] : [])
        ];
        for (const o of outlets) {
          rows.push({ station, outlet: o.outlet, airings: o.outlet === "opencast" ? airings : new Set(mine.filter((a) => o.spans.some((s) => s.from < a.endedAt && s.to > a.startedAt)).map((a) => a.logEntryId ?? a.id)).size, minutesAired: round1(minutesOf(o.spans)), viewerHours: o.viewerSeconds === null ? null : round1(o.viewerSeconds / 3600) });
        }
        const counted = rows.filter((r) => r.station.id === stationId && r.viewerHours !== null);
        stations.push({ station, airings, minutesAired: round1(minutesOf(spans)), viewerHours: counted.length ? round1(counted.reduce((t, r) => t + r.viewerHours!, 0)) : null });
      }
      stations.sort((a, b) => b.minutesAired - a.minutesAired);
      const outletTotals = new Map<Outlet, { minutesAired: number; viewerHours: number | null }>();
      for (const r of rows) {
        const t = outletTotals.get(r.outlet) ?? { minutesAired: 0, viewerHours: null };
        t.minutesAired = round1(t.minutesAired + r.minutesAired);
        if (r.viewerHours !== null) t.viewerHours = round1((t.viewerHours ?? 0) + r.viewerHours);
        outletTotals.set(r.outlet, t);
      }
      const counted = stations.filter((s) => s.viewerHours !== null);
      return {
        licenceId: licence.id,
        licensor: licence.licensor,
        name: licence.name,
        month: span.month,
        from: first,
        to: last,
        minutesAired: round1(stations.reduce((t, s) => t + s.minutesAired, 0)),
        airings: stations.reduce((t, s) => t + s.airings, 0),
        viewerHours: counted.length ? round1(counted.reduce((t, s) => t + s.viewerHours!, 0)) : null,
        stations,
        outlets: [...outletTotals].map(([outlet, t]) => ({ outlet, ...t })),
        rows
      };
    },

    async minutesCsv(user, licenceId, month) {
      const report = await service.minutes(user, licenceId, month);
      const name = (s: StationIdent) => [s.callSign ?? s.name, s.channel].filter(Boolean).join(" ");
      const lines = [
        ["Month", "Licensor", "Licence", "Station", "Outlet", "Airings", "Minutes aired", "Viewer hours"],
        ...report.rows.map((r) => [report.month, report.licensor, report.name, name(r.station), r.outlet, r.airings, r.minutesAired, r.viewerHours]),
        [report.month, report.licensor, report.name, "All stations", "all", report.airings, report.minutesAired, report.viewerHours]
      ];
      const slug = report.licensor.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "licence";
      return { filename: `minutes-${slug}-${report.month}.csv`, csv: lines.map((l) => l.map(cell).join(",")).join("\n") + "\n" };
    }
  };
  return service;
}
