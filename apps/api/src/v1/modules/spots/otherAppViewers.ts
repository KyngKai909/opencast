// Other apps viewers on per-thousand spots (programming Phase 5, P5.1, the user's decision): viewers
// tuned from Opencast's channel list in TiviMate, Jellyfin, Channels DVR, Kodi or VLC. Those apps
// send no heartbeats, so a session is a run of playlist polls (`audience/otherApps.ts`), and it's
// billed for a spot only when it can be attributed to it:
//
// - It watched through the spot: its polls ran from the spot's start (or before) to its end (or
//   after), with no gap of two minutes between them (the session's own rule), and it counts (its
//   polls span a minute). Tuning in or leaving partway isn't billed.
// - Evidence: its polls average at least one every 30 seconds. A player reloads a live playlist
//   every few seconds; a run that polls less than that isn't playing.
// - One per connection: a session is one hashed address, app and station, so a household with two
//   of the same app on one channel is one viewer, and one address can't count twice on a station.
// - Online businesses: every such session. Local businesses: only those placed in a market inside
//   the spot's area (the rule Opencast's own viewers follow); a session that couldn't be placed
//   isn't billed to a local business.
//
// Money: the polls after a spot are only in once the session's next row is written, so the part
// can't settle as the spot airs. The airing settles for Opencast's viewers and keeps what's left of
// its hold (after the relay estimate, up to the per-airing maximum) held for the Other apps part,
// which settles two minutes after the spot ends (the session gap, by when a run still going has
// polled since). The hold at placement adds the station's usual Other apps sessions at the hour.
// Opened only when a session in another app was watching from the spot's start to its end; otherwise
// there's nothing to show.

import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@opencast/db";
import { OTHER_APPS_LABEL, type OtherAppsLine, type OtherAppsPart, type OtherAppsPartStatus } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import { OTHER_APPS_GAP_MS } from "../audience/otherApps.js";
import type { RelayViewers } from "./relayViewers.js";

const SP = schema.spotsTable;
const AD = schema.advertisers;
const AI = schema.airings;
const RC = schema.relayCharges;
const OC = schema.otherAppCharges;

type SpotRow = typeof SP.$inferSelect;
type AiringRow = typeof AI.$inferSelect;
type ChargeRow = typeof OC.$inferSelect;

const fmt = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

const REASONS: Record<string, string> = {
  no_sessions: "Nobody watched through the spot in another app",
  none_in_area: "Nobody watching in another app was placed inside your area"
};

export interface OtherAppViewers {
  /** The Other apps part of a per-thousand spot's hold: the station's usual sessions at this hour. */
  holdEstimate(spot: SpotRow, stationId: string, at: Date): Promise<number>;
  /**
   * Opens the Other apps part of an airing that just aired, when a session in another app was
   * watching through it, and answers how much of its hold stays held for it.
   */
  open(input: { airing: AiringRow; spot: SpotRow; startedAt: Date; endedAt: Date; fraction: number; opencastCostMicros: number; spareMicros: number }): Promise<number>;
  /** Settles each Other apps part whose polls are in (run every minute). */
  settleDue(): Promise<{ settled: number; notBilled: number }>;
  /** Each airing's Other apps part, as results show it. */
  parts(airingIds: string[]): Promise<Map<string, OtherAppsPart>>;
  /** A period's Other apps viewers, added up; null with none. */
  line(parts: OtherAppsPart[]): OtherAppsLine | null;
  /** Airings whose Other apps part is still counting (their holds aren't "unaired"). */
  openAirings(airingIds: string[]): Promise<Set<string>>;
}

export function createOtherAppViewers({ deps, services }: ModuleContext, relay: RelayViewers): OtherAppViewers {
  const { db } = deps;

  async function settleCharge(charge: ChargeRow, airing: AiringRow, spot: SpotRow, outcome: { status: "settled" | "not_billed"; reason?: string; sessions: number; billedSessions: number; costMicros?: number; working?: string | null }) {
    const now = deps.clock.now();
    await db.transaction(async (tx) => {
      // Still held for the airing's relay parts: kept.
      const relays = await tx
        .select({ held: RC.heldMicros })
        .from(RC)
        .where(and(eq(RC.airingId, charge.airingId), inArray(RC.status, ["counting", "waiting_location"])));
      const keep = relays.reduce((s, r) => s + r.held, 0);
      const source = { sourceType: "other_app_viewers", sourceId: charge.id };
      if (outcome.status === "settled" && (outcome.costMicros ?? 0) > 0) {
        let barter: { producerStationId: string; producerShare: number; agreementId: string } | undefined;
        if (airing.carriageAgreementId) {
          const agreement = (await services.catalog.agreementsByIds([airing.carriageAgreementId])).get(airing.carriageAgreementId);
          if (agreement) barter = { producerStationId: agreement.makerStationId, producerShare: 1, agreementId: agreement.id };
        }
        await services.ledger.settle(tx, {
          holdId: airing.holdId,
          stationId: airing.stationId,
          costMicros: outcome.costMicros!,
          kind: "airing",
          source: { ...source, memo: OTHER_APPS_LABEL, idempotencyKey: `other-apps:${charge.id}` },
          barter,
          keepHeldMicros: keep
        });
      } else {
        const openNow = (await services.ledger.openAmount([airing.holdId])).get(airing.holdId) ?? 0;
        const release = openNow - keep;
        if (release > 0) await services.ledger.release(tx, airing.holdId, release, { ...source, memo: "Returned: what Other apps viewers didn't use" });
      }
      await tx
        .update(OC)
        .set({
          status: outcome.status,
          reason: outcome.reason ?? null,
          sessions: outcome.sessions,
          billedSessions: outcome.billedSessions,
          costMicros: outcome.status === "settled" ? (outcome.costMicros ?? 0) : 0,
          working: outcome.working ?? null,
          heldMicros: 0,
          resolvedAt: now
        })
        .where(eq(OC.id, charge.id));
    });
    await services.ledger.checkRunway(spot.advertiserId);
  }

  const part: OtherAppViewers = {
    async holdEstimate(spot, stationId, at) {
      const sessions = await services.audience.otherApps.typical(stationId, at);
      return Math.round((sessions * spot.rateMicros) / 1000);
    },

    async open({ airing, spot, startedAt, endedAt, fraction, opencastCostMicros, spareMicros }) {
      // Nobody in another app was watching from its start to its end: nothing to count.
      if (!(await services.audience.otherApps.watchingThrough(airing.stationId, startedAt, endedAt))) return 0;
      const [business] = await db.select({ where: AD.customersWhere }).from(AD).where(eq(AD.id, spot.advertiserId));
      const capMicros = spot.perAiringMaxMicros ? Math.max(0, Math.round(spot.perAiringMaxMicros * fraction) - opencastCostMicros) : null;
      // What's left of the hold once Opencast's viewers and the relay parts have theirs, up to the most it can cost.
      const heldMicros = Math.max(0, capMicros === null ? spareMicros : Math.min(spareMicros, capMicros));
      await db
        .insert(OC)
        .values({ airingId: airing.id, audience: business?.where === "online" ? "online" : "local", startedAt, endedAt, fraction: Math.max(0, Math.min(1, fraction)), capMicros, heldMicros, createdAt: deps.clock.now() })
        .onConflictDoNothing();
      // Settled twice (the same as-run): what's kept is what it still holds.
      const [row] = await db.select({ held: OC.heldMicros }).from(OC).where(and(eq(OC.airingId, airing.id), eq(OC.status, "counting")));
      return row?.held ?? 0;
    },

    async settleDue() {
      const now = deps.clock.now();
      const open = await db
        .select({ charge: OC, airing: AI, spot: SP })
        .from(OC)
        .innerJoin(AI, eq(AI.id, OC.airingId))
        .innerJoin(SP, eq(SP.id, AI.spotId))
        .where(eq(OC.status, "counting"));
      let settled = 0;
      let notBilled = 0;
      for (const { charge, airing, spot } of open) {
        // A run still going has polled (and been written) since the spot by then; one that hasn't has ended.
        if (now.getTime() < charge.endedAt.getTime() + OTHER_APPS_GAP_MS) continue;
        const area = charge.audience === "local" ? await relay.area(spot, airing.stationId) : null;
        const counted = await services.audience.otherApps.throughSpot(airing.stationId, charge.startedAt, charge.endedAt, area ? [...area.markets] : []);
        const billed = area ? counted.placed : counted.sessions;
        if (billed <= 0) {
          await settleCharge(charge, airing, spot, { status: "not_billed", reason: counted.sessions ? "none_in_area" : "no_sessions", sessions: counted.sessions, billedSessions: 0 });
          notBilled++;
          continue;
        }
        const full = (billed * airing.rateMicros) / 1000;
        const cost = Math.round(full * charge.fraction);
        const costMicros = charge.capMicros === null ? cost : Math.min(cost, charge.capMicros);
        const who = area ? `${billed} in your area (of ${counted.sessions})` : `${billed}`;
        const rate = `${fmt(airing.rateMicros)} ÷ 1,000${charge.fraction < 1 ? ` × ${Math.round(charge.fraction * 100)}% aired` : ""}`;
        await settleCharge(charge, airing, spot, { status: "settled", sessions: counted.sessions, billedSessions: billed, costMicros, working: `${who} × ${rate} = ${fmt(costMicros)}` });
        settled++;
      }
      return { settled, notBilled };
    },

    async parts(airingIds) {
      const result = new Map<string, OtherAppsPart>();
      if (!airingIds.length) return result;
      const rows = await db.select().from(OC).where(inArray(OC.airingId, airingIds));
      for (const r of rows) {
        result.set(r.airingId, {
          label: OTHER_APPS_LABEL,
          status: r.status as OtherAppsPartStatus,
          reason: r.reason ? (REASONS[r.reason] ?? r.reason) : null,
          sessions: r.sessions,
          billedSessions: r.billedSessions,
          costMicros: r.costMicros,
          heldMicros: r.heldMicros,
          working: r.working
        });
      }
      return result;
    },

    line(parts) {
      if (!parts.length) return null;
      const line: OtherAppsLine = { label: OTHER_APPS_LABEL, airings: 0, sessionsAddedUp: 0, billedSessionsAddedUp: 0, spentMicros: 0, waitingMicros: 0, waitingAirings: 0 };
      for (const p of parts) {
        line.airings++;
        line.sessionsAddedUp += p.sessions ?? 0;
        line.billedSessionsAddedUp += p.billedSessions ?? 0;
        line.spentMicros += p.costMicros;
        if (p.status === "counting") {
          line.waitingMicros += p.heldMicros;
          line.waitingAirings++;
        }
      }
      return line;
    },

    async openAirings(airingIds) {
      if (!airingIds.length) return new Set();
      const rows = await db
        .select({ airingId: OC.airingId })
        .from(OC)
        .where(and(inArray(OC.airingId, airingIds), eq(OC.status, "counting")));
      return new Set(rows.map((r) => r.airingId));
    }
  };
  return part;
}
