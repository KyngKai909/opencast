// Underwriting: a business sponsors a whole station or one program for a flat
// monthly amount, credited on air. The station approves each one. Each month's
// amount is held at the start of the month and paid to the station at its end.

import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { checkCreditText } from "@opencast/domain";
import type { Sponsorship, SponsorshipSetting } from "@opencast/contracts";
import { miles } from "../network/service.js";
import type { ModuleContext } from "../../context.js";
import { badRequest, notFound, refused } from "../../errors.js";

export interface SponsorshipsPart {
  offerSponsorship(businessId: string, input: { stationId: string; programId: string | null; monthlyMicros: number; creditText: string; startsOn: string }): Promise<Sponsorship>;
  businessSponsorships(businessId: string): Promise<Sponsorship[]>;
  stationSponsorships(stationId: string): Promise<{ sponsorships: Sponsorship[]; settings: SponsorshipSetting[]; members: { creditName: string; members: number; named: number } | null }>;
  stationOfSponsorship(sponsorshipId: string): Promise<{ stationId: string; businessId: string }>;
  decideSponsorship(sponsorshipId: string, userId: string, decision: { decision: "approve" } | { decision: "decline"; reason: "not_right_fit" | "full" | "amount" }): Promise<Sponsorship>;
  endSponsorship(sponsorshipId: string): Promise<Sponsorship>;
  setSponsorshipSettings(stationId: string, settings: Array<{ programId: string | null; minMonthlyMicros: number; maxSponsors: number; closed: boolean }>): Promise<SponsorshipSetting[]>;
  activeSponsorCount(stationId: string): Promise<number>;
  /** E2: the approved sponsors by name, with their monthly amounts. */
  activeSponsors(stationId: string): Promise<Array<{ name: string; monthlyMicros: number }>>;
  /** Credits for the current month, for the underwriting slate. */
  creditsFor(stationId: string): Promise<Array<{ business: string; creditText: string; programId: string | null }>>;
  /** Holds each approved sponsorship's month at its start, pays last month to the station, lapses the unfunded. */
  rollSponsorships(): Promise<{ held: number; paid: number; lapsed: number }>;
}

const SS = schema.sponsorships;
const SM = schema.sponsorshipMonths;
const SET = schema.sponsorshipSettings;

const monthOf = (date: string | Date) => (typeof date === "string" ? date : date.toISOString()).slice(0, 7) + "-01";
const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};

export function createSponsorships({ deps, services }: ModuleContext): SponsorshipsPart {
  const { db } = deps;

  async function views(rows: Array<typeof SS.$inferSelect>): Promise<Sponsorship[]> {
    if (!rows.length) return [];
    const [names, idents, titles, months] = await Promise.all([
      services.spots.businessNames(rows.map((r) => r.advertiserId)),
      services.stations.idents(rows.map((r) => r.stationId)),
      services.library.titles({ itemIds: [], programIds: rows.map((r) => r.programId).filter((v): v is string => Boolean(v)) }),
      db.select().from(SM).where(inArray(SM.sponsorshipId, rows.map((r) => r.id)))
    ]);
    const thisMonth = monthOf(deps.clock.now());
    return rows.flatMap((r) => {
      const station = idents.get(r.stationId);
      if (!station) return [];
      const funded = months.some((m) => m.sponsorshipId === r.id && m.month === thisMonth);
      const state: Sponsorship["state"] =
        r.status === "requested" ? "requested" : r.status === "approved" ? (funded ? "credited" : "approved") : r.status === "lapsed" ? "lapsed" : r.status === "declined" ? "declined" : "ended";
      return [
        {
          id: r.id,
          business: { id: r.advertiserId, name: names.get(r.advertiserId) ?? "" },
          station,
          program: r.programId ? { id: r.programId, title: titles.programs.get(r.programId) ?? "" } : null,
          monthlyMicros: r.monthlyMicros,
          creditText: r.creditText,
          state,
          declineReason: r.declineReason,
          startsOn: r.startsOn,
          renewsOn: r.status === "approved" ? nextMonth(thisMonth) : null,
          createdAt: r.createdAt.toISOString()
        }
      ];
    });
  }

  async function settingFor(stationId: string, programId: string | null) {
    const rows = await db.select().from(SET).where(eq(SET.stationId, stationId));
    return rows.find((r) => r.programId === programId) ?? null;
  }

  async function activeCount(stationId: string, programId: string | null) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(SS)
      .where(and(eq(SS.stationId, stationId), inArray(SS.status, ["requested", "approved"]), programId ? eq(SS.programId, programId) : sql`${SS.programId} is null`));
    return row.n;
  }

  async function holdMonth(sponsorship: typeof SS.$inferSelect, month: string) {
    try {
      await db.transaction(async (tx) => {
        const holdId = await services.ledger.hold(tx, {
          businessId: sponsorship.advertiserId,
          purpose: "sponsorship_month",
          sponsorshipId: sponsorship.id,
          amountMicros: sponsorship.monthlyMicros,
          memo: "Held for a month of sponsorship"
        });
        await tx.insert(SM).values({ sponsorshipId: sponsorship.id, month, holdId });
      });
      return true;
    } catch {
      return false;
    }
  }

  /** P22: each sponsor as the station sees it: category, city, miles from the studio, what else it sponsors. */
  async function sponsorProfiles(stationId: string, rows: Array<typeof SS.$inferSelect>) {
    const result = new Map<string, { category: string; city: string | null; miles: number | null; elsewhere: string[] }>();
    if (!rows.length) return result;
    const businessIds = [...new Set(rows.map((r) => r.advertiserId))];
    const [businesses, locations, others, profile] = await Promise.all([
      db.select().from(schema.advertisers).where(inArray(schema.advertisers.id, businessIds)),
      db.select().from(schema.advertiserLocations).where(inArray(schema.advertiserLocations.advertiserId, businessIds)).orderBy(asc(schema.advertiserLocations.createdAt)),
      db.select().from(SS).where(and(inArray(SS.advertiserId, businessIds), eq(SS.status, "approved"))),
      services.stations.profiles([stationId]).then((m) => m.get(stationId))
    ]);
    const elsewhereRows = others.filter((o) => o.stationId !== stationId);
    const [idents, titles] = await Promise.all([
      services.stations.idents(elsewhereRows.map((o) => o.stationId)),
      services.library.titles({ itemIds: [], programIds: elsewhereRows.map((o) => o.programId).filter((v): v is string => Boolean(v)) })
    ]);
    for (const r of rows) {
      const business = businesses.find((b) => b.id === r.advertiserId);
      if (!business) continue;
      const places = locations.filter((l) => l.advertiserId === business.id);
      const online = business.customersWhere === "online";
      const distances = profile?.location && !online ? places.map((l) => miles(profile.location!, { lat: l.latitude, lng: l.longitude })) : [];
      result.set(r.id, {
        category: business.category,
        city: online ? null : (places[0]?.city ?? null),
        miles: distances.length ? Math.round(Math.min(...distances) * 10) / 10 : null,
        elsewhere: elsewhereRows
          .filter((o) => o.advertiserId === business.id)
          .flatMap((o) => {
            const where = idents.get(o.stationId);
            if (!where) return [];
            const name = where.callSign ?? where.name;
            return [o.programId ? `${titles.programs.get(o.programId) ?? "A program"} on ${name}` : name];
          })
      });
    }
    return result;
  }

  const part: SponsorshipsPart = {
    async offerSponsorship(businessId, input) {
      const check = checkCreditText(input.creditText);
      if (!check.passes) {
        throw refused("credit_text", `The credit can't be sent yet: ${check.flags.map((f) => `"${f.text}"`).join(", ")}. ${check.flags[0]?.suggestion ?? ""}`.trim());
      }
      const profile = (await services.stations.profiles([input.stationId])).get(input.stationId);
      if (!profile?.public) throw notFound("That station");
      if (input.programId) {
        const program = (await services.library.programsByIds([input.programId])).get(input.programId);
        if (!program) throw notFound("That program");
        // A carried program is sponsored through the station that makes it.
        if (program.stationId !== input.stationId) {
          const maker = (await services.stations.idents([program.stationId])).get(program.stationId);
          throw refused("sponsor_through_maker", `${maker?.callSign ?? "Its maker"} sponsors this program. Offer it to them.`);
        }
      }
      const setting = await settingFor(input.stationId, input.programId);
      const stationSetting = await settingFor(input.stationId, null);
      if (setting?.closed) throw refused("closed", "This program can't be sponsored.");
      const min = (setting ?? stationSetting)?.minMonthlyMicros ?? 0;
      if (input.monthlyMicros < min) throw refused("below_minimum", `The minimum is $${(min / 1_000_000).toFixed(2)} a month.`);
      const max = (setting ?? (input.programId ? null : stationSetting))?.maxSponsors;
      if (max !== undefined && max !== null && (await activeCount(input.stationId, input.programId)) >= max) {
        throw refused("full", "There's no room for another sponsor right now.");
      }
      const [row] = await db
        .insert(SS)
        .values({
          advertiserId: businessId,
          stationId: input.stationId,
          programId: input.programId,
          monthlyMicros: input.monthlyMicros,
          creditText: input.creditText.trim(),
          creditCheckedAt: deps.clock.now(),
          startsOn: input.startsOn
        })
        .returning();
      deps.bus.emit("sponsorship.requested", { sponsorshipId: row.id, stationId: input.stationId, businessId });
      return (await views([row]))[0];
    },

    async businessSponsorships(businessId) {
      return views(await db.select().from(SS).where(eq(SS.advertiserId, businessId)).orderBy(desc(SS.createdAt)));
    },

    async stationSponsorships(stationId) {
      const [rows, settings, programs] = await Promise.all([
        db.select().from(SS).where(eq(SS.stationId, stationId)).orderBy(desc(SS.createdAt)),
        db.select().from(SET).where(eq(SET.stationId, stationId)),
        services.library.programsForStation(stationId)
      ]);
      const counts = new Map<string, number>();
      for (const r of rows) if (r.status === "approved") counts.set(r.programId ?? "station", (counts.get(r.programId ?? "station") ?? 0) + 1);
      const station = settings.find((s) => s.programId === null);
      // L1: each program's format in words ("Weekly, live").
      const formats = new Map(await Promise.all(programs.map(async (p) => [p.id, formatWords(await services.library.format(p.id), p.live)] as const)));
      const settingViews: SponsorshipSetting[] = [
        { programId: null, title: "The whole station", minMonthlyMicros: station?.minMonthlyMicros ?? 0, maxSponsors: station?.maxSponsors ?? 0, closed: station?.closed ?? false, sponsors: counts.get("station") ?? 0, sponsoredThrough: null, format: null },
        ...programs.map((p) => {
          const s = settings.find((x) => x.programId === p.id);
          return { programId: p.id, title: p.title, minMonthlyMicros: s?.minMonthlyMicros ?? 0, maxSponsors: s?.maxSponsors ?? 0, closed: s?.closed ?? false, sponsors: counts.get(p.id) ?? 0, sponsoredThrough: null, format: formats.get(p.id) ?? null };
        })
      ];
      const [list, credits, profiles] = await Promise.all([views(rows), services.ledger.memberCredits(stationId), sponsorProfiles(stationId, rows)]);
      const ident = (await services.stations.idents([stationId])).get(stationId);
      return {
        sponsorships: list.map((v) => ({ ...v, ...(profiles.has(v.id) ? { profile: profiles.get(v.id) } : {}) })),
        settings: settingViews,
        // P17: the name read in the members' credit, how many members, how many asked to be named.
        members: ident ? { creditName: `members of ${ident.name}`, members: credits.members, named: credits.named.length } : null
      };
    },

    async stationOfSponsorship(sponsorshipId) {
      const [row] = await db.select().from(SS).where(eq(SS.id, sponsorshipId));
      if (!row) throw notFound("That sponsorship");
      return { stationId: row.stationId, businessId: row.advertiserId };
    },

    async decideSponsorship(sponsorshipId, userId, decision) {
      const [row] = await db.select().from(SS).where(eq(SS.id, sponsorshipId));
      if (!row) throw notFound("That sponsorship");
      if (row.status !== "requested") throw refused("already_decided", "That request has been answered.");
      const [updated] = await db
        .update(SS)
        .set({
          status: decision.decision === "approve" ? "approved" : "declined",
          declineReason: decision.decision === "decline" ? decision.reason : null,
          decidedAt: deps.clock.now(),
          decidedBy: userId
        })
        .where(eq(SS.id, sponsorshipId))
        .returning();
      if (decision.decision === "approve") {
        // Held now if its first month has started; otherwise on the 1st.
        const month = monthOf(row.startsOn);
        if (month <= monthOf(deps.clock.now())) await holdMonth(updated, monthOf(deps.clock.now()));
      }
      deps.bus.emit("sponsorship.decided", { sponsorshipId, stationId: row.stationId, businessId: row.advertiserId, approved: decision.decision === "approve" });
      return (await views([updated]))[0];
    },

    async endSponsorship(sponsorshipId) {
      const [row] = await db.update(SS).set({ status: "ended" }).where(eq(SS.id, sponsorshipId)).returning();
      if (!row) throw notFound("That sponsorship");
      return (await views([row]))[0];
    },

    async setSponsorshipSettings(stationId, settings) {
      const programs = new Set((await services.library.programsForStation(stationId)).map((p) => p.id));
      if (settings.some((s) => s.programId && !programs.has(s.programId))) throw badRequest("One of those programs isn't this station's.");
      await db.transaction(async (tx) => {
        await tx.delete(SET).where(eq(SET.stationId, stationId));
        if (settings.length) await tx.insert(SET).values(settings.map((s) => ({ stationId, ...s })));
      });
      return (await part.stationSponsorships(stationId)).settings;
    },

    async activeSponsors(stationId) {
      const rows = await db.select().from(SS).where(and(eq(SS.stationId, stationId), eq(SS.status, "approved"))).orderBy(asc(SS.createdAt));
      const names = await services.spots.businessNames(rows.map((r) => r.advertiserId));
      return rows.map((r) => ({ name: names.get(r.advertiserId) ?? "", monthlyMicros: r.monthlyMicros }));
    },

    async activeSponsorCount(stationId) {
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(SS).where(and(eq(SS.stationId, stationId), eq(SS.status, "approved")));
      return row.n;
    },

    async creditsFor(stationId) {
      const month = monthOf(deps.clock.now());
      const rows = await db
        .select({ sponsorship: SS })
        .from(SS)
        .innerJoin(SM, and(eq(SM.sponsorshipId, SS.id), eq(SM.month, month)))
        .where(and(eq(SS.stationId, stationId), eq(SS.status, "approved")))
        .orderBy(asc(SS.createdAt));
      const names = await services.spots.businessNames(rows.map((r) => r.sponsorship.advertiserId));
      return rows.map((r) => ({ business: names.get(r.sponsorship.advertiserId) ?? "", creditText: r.sponsorship.creditText, programId: r.sponsorship.programId }));
    },

    async rollSponsorships() {
      const month = monthOf(deps.clock.now());
      let paid = 0;
      let held = 0;
      let lapsed = 0;
      // Pay out months that have ended.
      const due = await db.select({ month: SM, sponsorship: SS }).from(SM).innerJoin(SS, eq(SS.id, SM.sponsorshipId)).where(lte(SM.month, month));
      for (const { month: m, sponsorship } of due) {
        if (m.month >= month) continue;
        const open = (await services.ledger.openAmount([m.holdId])).get(m.holdId) ?? 0;
        if (open <= 0) continue;
        await db.transaction((tx) =>
          services.ledger.settle(tx, {
            holdId: m.holdId,
            stationId: sponsorship.stationId,
            costMicros: open,
            kind: "sponsorship",
            source: { sourceType: "sponsorship_month", sourceId: sponsorship.id, memo: `Sponsorship, ${m.month.slice(0, 7)}`, idempotencyKey: `sponsorship:${sponsorship.id}:${m.month}` }
          })
        );
        paid++;
      }
      // Hold this month for approved sponsorships that have started; lapse the unfunded.
      const approved = await db.select().from(SS).where(and(eq(SS.status, "approved"), lte(SS.startsOn, nextMonth(month))));
      for (const s of approved) {
        if (monthOf(s.startsOn) > month) continue;
        const [existing] = await db.select().from(SM).where(and(eq(SM.sponsorshipId, s.id), eq(SM.month, month)));
        if (existing) continue;
        if (await holdMonth(s, month)) held++;
        else {
          await db.update(SS).set({ status: "lapsed" }).where(eq(SS.id, s.id));
          lapsed++;
        }
      }
      return { held, paid, lapsed };
    }
  };
  return part;
}

/** L1: a program's format in words: "Weekly, live", "Nightly", "Series", "One-off". */
function formatWords(format: { kind: "series" | "one_off"; cadence: "weekly" | "nightly" | "weeknights" | null }, live: boolean): string {
  const parts = [format.cadence ? { weekly: "Weekly", nightly: "Nightly", weeknights: "Weeknights" }[format.cadence] : null, live ? "live" : null].filter((v): v is string => Boolean(v));
  if (!parts.length) return format.kind === "series" ? "Series" : "One-off";
  const words = parts.join(", ");
  return words[0].toUpperCase() + words.slice(1);
}
