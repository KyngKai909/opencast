// Made for you: a business asks a station that takes orders, or Opencast Studio,
// to make a spot. The price is held when the quote is accepted and paid to the
// maker when the business approves, or 7 days after delivery with no answer.
// Past the rounds included, either side can ask Opencast to review; a disputed
// order stays held until then.

import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ProductionOrder } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { UploadedFile } from "../../http.js";
import { badRequest, notFound, refused } from "../../errors.js";

const AUTO_APPROVE_DAYS = 7;
const DAY = 86_400_000;

export interface OrdersPart {
  makers(): Promise<Array<{ station: import("@opencast/contracts").StationIdent; turnaround: string | null; fromMicros: number | null; samples: number }>>;
  orderSpot(businessId: string, input: { makerStationId: string; title: string; lengthSec: 15 | 30 | 60; about: string; mustSay?: string; neededBy: string }): Promise<ProductionOrder>;
  businessOrders(businessId: string): Promise<ProductionOrder[]>;
  makerOrders(stationId: string): Promise<ProductionOrder[]>;
  order(orderId: string): Promise<ProductionOrder>;
  partiesOfOrder(orderId: string): Promise<{ businessId: string; makerStationId: string }>;
  attachBriefFile(orderId: string, file: UploadedFile): Promise<ProductionOrder>;
  quote(orderId: string, input: { action: "quote"; priceMicros: number; deliverBy: string; roundsIncluded: number; voicedBy: string | null } | { action: "pass" }): Promise<ProductionOrder>;
  acceptQuote(orderId: string): Promise<ProductionOrder>;
  deliver(orderId: string, file: UploadedFile): Promise<ProductionOrder>;
  addNote(orderId: string, authorId: string, input: { timecodeMs: number | null; body: string }): Promise<ProductionOrder>;
  markOwnMistake(orderId: string, noteId: string): Promise<ProductionOrder>;
  reviewDelivery(orderId: string, decision: "approve" | "request_changes" | "dispute", tellMakerWhenListed?: boolean): Promise<ProductionOrder>;
  cancelOrder(orderId: string): Promise<ProductionOrder>;
  /** Opencast's review of a disputed order. The hold is paid to the maker, returned, or split. */
  resolveDispute(orderId: string, input: { outcome: "pay_maker" | "refund" | "split"; makerMicros?: number; note?: string }): Promise<ProductionOrder>;
  /** Approves deliveries with no answer after 7 days. Run by the scheduler. */
  autoApproveOrders(): Promise<number>;
  /** Tells the maker a spot it made is listed, if the business asked. */
  notifyMakerListed(spotId: string): Promise<void>;
}

export function createOrders(
  { deps, services }: ModuleContext,
  hooks: { createSpotFromOrder(input: { businessId: string; orderId: string; title: string; lengthSec: number; category: string; file: { contentId: string; durationMs: number; filename: string | null } | null }): Promise<string> }
): OrdersPart {
  const { db } = deps;
  const O = schema.productionOrders;
  const F = schema.orderFiles;
  const N = schema.orderNotes;

  async function row(orderId: string) {
    const [found] = await db.select().from(O).where(eq(O.id, orderId));
    if (!found) throw notFound("That order");
    return found;
  }

  /** Rounds used: change requests, less notes the maker marked as its own mistake. */
  async function roundsUsed(orderId: string) {
    const notes = await db.select().from(N).where(eq(N.orderId, orderId));
    const rounds = new Set(notes.filter((n) => !n.makersMistake).map((n) => n.round));
    return rounds.size;
  }

  async function views(rows: Array<typeof O.$inferSelect>): Promise<ProductionOrder[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [names, idents, files, notes] = await Promise.all([
      services.spots.businessNames(rows.map((r) => r.advertiserId)),
      services.stations.idents(rows.map((r) => r.makerStationId)),
      db.select().from(F).where(inArray(F.orderId, ids)).orderBy(asc(F.createdAt)),
      db.select().from(N).where(inArray(N.orderId, ids)).orderBy(asc(N.createdAt))
    ]);
    const authors = await services.accounts.displayNames(notes.map((n) => n.authorId));
    const content = services.library.content;
    const urls = new Map(await Promise.all(files.map(async (f) => [f.id, { url: f.contentId ? await content.url(f.contentId) : (f.location ?? ""), previewUrl: f.role === "delivery" ? await content.previewUrl(f.contentId) : null }] as const)));
    return rows.flatMap((r) => {
      const maker = idents.get(r.makerStationId);
      if (!maker) return [];
      const mine = notes.filter((n) => n.orderId === r.id);
      return [
        {
          id: r.id,
          business: { id: r.advertiserId, name: names.get(r.advertiserId) ?? "" },
          maker,
          title: r.title,
          lengthSec: r.lengthSec as 15 | 30 | 60,
          about: r.about,
          mustSay: r.mustSay,
          neededBy: r.neededBy,
          state: r.status,
          quote: r.quoteMicros !== null && r.deliverBy ? { priceMicros: r.quoteMicros, deliverBy: r.deliverBy, roundsIncluded: r.roundsIncluded ?? 0, voicedBy: r.voicedBy } : null,
          roundsUsed: new Set(mine.filter((n) => !n.makersMistake).map((n) => n.round)).size,
          briefFiles: files.filter((f) => f.orderId === r.id && f.role === "brief").map((f) => ({ id: f.id, url: urls.get(f.id)?.url ?? "", filename: f.filename })),
          deliveries: files.filter((f) => f.orderId === r.id && f.role === "delivery").map((f) => ({ id: f.id, version: f.version ?? 1, url: urls.get(f.id)?.url ?? "", previewUrl: urls.get(f.id)?.previewUrl ?? null, createdAt: f.createdAt.toISOString() })),
          notes: mine.map((n) => ({ id: n.id, timecodeMs: n.timecodeMs, author: authors.get(n.authorId) ?? null, body: n.body, makersMistake: n.makersMistake, round: n.round, createdAt: n.createdAt.toISOString() })),
          deliveredAt: r.deliveredAt?.toISOString() ?? null,
          autoApproveAt: r.autoApproveAt?.toISOString() ?? null,
          spotId: r.spotId,
          tellMakerWhenListed: r.tellMakerWhenListed,
          createdAt: r.createdAt.toISOString()
        }
      ];
    });
  }

  const emit = (r: typeof O.$inferSelect) => deps.bus.emit("order.updated", { orderId: r.id, businessId: r.advertiserId, makerStationId: r.makerStationId, state: r.status });

  /** Stores an order's file by content ID and records it on the order. */
  async function keep(orderId: string, file: UploadedFile, role: "brief" | "delivery", version: number | null) {
    const content = services.library.content;
    // Briefs are read once or twice: Infrequent Access. A delivery may become the spot that airs.
    const stored = await content.store(file.path, { storageClass: role === "brief" ? "infrequent" : "standard", contentType: file.mimeType || undefined });
    return db.transaction(async (tx) => {
      const [saved] = await tx.insert(F).values({ orderId, role, version, contentId: stored.cid, filename: file.originalName }).returning();
      await content.addRef(tx, stored.cid, "order_file", saved.id);
      return saved;
    });
  }

  /** Reads a stored file's length from a local copy. */
  async function probeContent(cid: string) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-order-"));
    try {
      const file = path.join(dir, "delivery");
      await services.library.content.fetch(cid, file);
      return await deps.media.probe(file);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  async function approve(order: typeof O.$inferSelect, makerMicros?: number) {
    const [delivery] = await db.select().from(F).where(and(eq(F.orderId, order.id), eq(F.role, "delivery"))).orderBy(desc(F.createdAt)).limit(1);
    const probe = delivery?.contentId ? await probeContent(delivery.contentId).catch(() => null) : delivery?.location ? await deps.media.probe(delivery.location).catch(() => null) : null;
    await db.transaction(async (tx) => {
      if (order.holdId) {
        await services.ledger.settle(tx, {
          holdId: order.holdId,
          stationId: order.makerStationId,
          costMicros: makerMicros ?? order.quoteMicros ?? 0,
          kind: "production",
          source: { sourceType: "production_order", sourceId: order.id, memo: `Made for you: ${order.title}`, idempotencyKey: `order:${order.id}` }
        });
      }
    });
    const [business] = await db.select().from(schema.advertisers).where(eq(schema.advertisers.id, order.advertiserId));
    // It becomes a spot in the business's Spots, waiting for a rate and a budget.
    const spotId = await hooks.createSpotFromOrder({
      businessId: order.advertiserId,
      orderId: order.id,
      title: order.title,
      lengthSec: order.lengthSec,
      category: business?.category ?? "Services",
      file: delivery?.contentId && probe?.durationMs ? { contentId: delivery.contentId, durationMs: probe.durationMs, filename: delivery.filename } : null
    });
    await services.library.content.dropPreview("order", order.id);
    const [updated] = await db.update(O).set({ status: "approved", approvedAt: deps.clock.now(), spotId }).where(eq(O.id, order.id)).returning();
    emit(updated);
  }

  const part: OrdersPart = {
    async makers() {
      const makers = await services.stations.makers();
      const counts = makers.length
        ? await db.select({ makerStationId: O.makerStationId, id: O.id }).from(O).where(and(inArray(O.makerStationId, makers.map((m) => m.profile.id)), eq(O.status, "approved")))
        : [];
      return makers.map((m) => ({
        station: m.profile.ident,
        turnaround: m.turnaround,
        fromMicros: m.fromMicros,
        samples: counts.filter((c) => c.makerStationId === m.profile.id).length
      }));
    },

    async orderSpot(businessId, input) {
      const maker = (await services.stations.makers()).find((m) => m.profile.id === input.makerStationId);
      if (!maker) throw refused("not_a_maker", "That station doesn't take orders.");
      const [created] = await db
        .insert(O)
        .values({ advertiserId: businessId, makerStationId: input.makerStationId, title: input.title, lengthSec: input.lengthSec, about: input.about, mustSay: input.mustSay ?? null, neededBy: input.neededBy })
        .returning();
      emit(created);
      return (await views([created]))[0];
    },

    async businessOrders(businessId) {
      return views(await db.select().from(O).where(eq(O.advertiserId, businessId)).orderBy(desc(O.createdAt)));
    },

    async makerOrders(stationId) {
      return views(await db.select().from(O).where(eq(O.makerStationId, stationId)).orderBy(desc(O.createdAt)));
    },

    async order(orderId) {
      return (await views([await row(orderId)]))[0];
    },

    async partiesOfOrder(orderId) {
      const found = await row(orderId);
      return { businessId: found.advertiserId, makerStationId: found.makerStationId };
    },

    async attachBriefFile(orderId, file) {
      if (!file) throw badRequest("Choose a file.", { file: "Required" });
      const found = await row(orderId);
      if (!["asked", "quoted"].includes(found.status)) throw refused("brief_closed", "The brief can't change once the quote is accepted.");
      await keep(orderId, file, "brief", null);
      return part.order(orderId);
    },

    async quote(orderId, input) {
      const found = await row(orderId);
      if (!["asked", "quoted"].includes(found.status)) throw refused("not_quotable", "That order can't be quoted now.");
      const [updated] = await db
        .update(O)
        .set(
          input.action === "pass"
            ? { status: "passed" }
            : { status: "quoted", quoteMicros: input.priceMicros, deliverBy: input.deliverBy, roundsIncluded: input.roundsIncluded, voicedBy: input.voicedBy }
        )
        .where(eq(O.id, orderId))
        .returning();
      emit(updated);
      return (await views([updated]))[0];
    },

    async acceptQuote(orderId) {
      const found = await row(orderId);
      if (found.status !== "quoted" || !found.quoteMicros) throw refused("no_quote", "There's no quote to accept.");
      const updated = await db.transaction(async (tx) => {
        const holdId = await services.ledger.hold(tx, {
          businessId: found.advertiserId,
          purpose: "production_order",
          productionOrderId: orderId,
          amountMicros: found.quoteMicros!,
          memo: `Held for a production order: ${found.title}`
        });
        const [u] = await tx.update(O).set({ status: "accepted", holdId }).where(eq(O.id, orderId)).returning();
        return u;
      });
      await services.ledger.checkRunway(found.advertiserId);
      emit(updated);
      return (await views([updated]))[0];
    },

    async deliver(orderId, file) {
      if (!file) throw badRequest("Choose the file to deliver.", { file: "Required" });
      const found = await row(orderId);
      if (!["accepted", "changes_requested"].includes(found.status)) throw refused("not_in_the_making", "That order isn't waiting for a delivery.");
      const versions = await db.select().from(F).where(and(eq(F.orderId, orderId), eq(F.role, "delivery")));
      const now = deps.clock.now();
      const saved = await keep(orderId, file, "delivery", versions.length + 1);
      await services.library.content.needPreview([saved.contentId!], "order", orderId);
      const [updated] = await db
        .update(O)
        .set({ status: "delivered", deliveredAt: now, autoApproveAt: new Date(now.getTime() + AUTO_APPROVE_DAYS * DAY) })
        .where(eq(O.id, orderId))
        .returning();
      emit(updated);
      return (await views([updated]))[0];
    },

    async addNote(orderId, authorId, input) {
      const found = await row(orderId);
      const [latest] = await db.select().from(F).where(and(eq(F.orderId, orderId), eq(F.role, "delivery"))).orderBy(desc(F.createdAt)).limit(1);
      // Notes on a delivery belong to the next round of changes.
      const round = (await roundsUsed(orderId)) + (found.status === "delivered" ? 1 : 0);
      await db.insert(N).values({ orderId, deliveryFileId: latest?.id ?? null, timecodeMs: input.timecodeMs, authorId, body: input.body, round: Math.max(1, round) });
      return part.order(orderId);
    },

    async markOwnMistake(orderId, noteId) {
      const updated = await db.update(N).set({ makersMistake: true }).where(and(eq(N.id, noteId), eq(N.orderId, orderId))).returning();
      if (!updated.length) throw notFound("That note");
      return part.order(orderId);
    },

    async reviewDelivery(orderId, decision, tellMakerWhenListed) {
      const found = await row(orderId);
      if (found.status !== "delivered" && !(decision === "dispute" && found.status === "changes_requested")) {
        throw refused("not_delivered", "There's no delivery to review.");
      }
      if (tellMakerWhenListed !== undefined) await db.update(O).set({ tellMakerWhenListed }).where(eq(O.id, orderId));
      if (decision === "approve") {
        await approve({ ...found, tellMakerWhenListed: tellMakerWhenListed ?? found.tellMakerWhenListed });
      } else if (decision === "request_changes") {
        const used = await roundsUsed(orderId);
        if (used > (found.roundsIncluded ?? 0)) {
          throw refused("rounds_used", "The included rounds of changes are used. Approve it, or ask Opencast to review.");
        }
        const [u] = await db.update(O).set({ status: "changes_requested", autoApproveAt: null }).where(eq(O.id, orderId)).returning();
        emit(u);
      } else {
        const [u] = await db.update(O).set({ status: "disputed", autoApproveAt: null }).where(eq(O.id, orderId)).returning();
        emit(u);
      }
      return part.order(orderId);
    },

    async resolveDispute(orderId, input) {
      const found = await row(orderId);
      if (found.status !== "disputed") throw refused("not_disputed", "That order isn't waiting for a review.");
      const price = found.quoteMicros ?? 0;
      if (input.outcome === "refund") {
        await db.transaction(async (tx) => {
          if (found.holdId) await services.ledger.release(tx, found.holdId, undefined, { sourceType: "production_order", sourceId: orderId, memo: `Returned after review${input.note ? `: ${input.note}` : ""}` });
          await tx.update(O).set({ status: "cancelled" }).where(eq(O.id, orderId));
        });
        await services.library.content.dropPreview("order", orderId);
        const updated = await row(orderId);
        emit(updated);
        return (await views([updated]))[0];
      }
      if (input.outcome === "split" && (!input.makerMicros || input.makerMicros >= price)) throw badRequest("A split pays the maker part of the price.", { makerMicros: `Less than ${price}` });
      // The maker is paid (all, or their part; the rest goes back) and the business keeps what was delivered.
      await approve(found, input.outcome === "split" ? input.makerMicros : undefined);
      const updated = await row(orderId);
      return (await views([updated]))[0];
    },

    async cancelOrder(orderId) {
      const found = await row(orderId);
      if (["asked", "quoted"].includes(found.status)) {
        const [u] = await db.update(O).set({ status: "cancelled" }).where(eq(O.id, orderId)).returning();
        await services.library.content.dropPreview("order", orderId);
        emit(u);
        return (await views([u]))[0];
      }
      const today = deps.clock.now().toISOString().slice(0, 10);
      if (found.status === "accepted" && found.deliverBy && found.deliverBy < today) {
        // The delivery date passed with nothing delivered: the hold returns in full.
        await db.transaction(async (tx) => {
          if (found.holdId) await services.ledger.release(tx, found.holdId, undefined, { sourceType: "production_order", sourceId: orderId, memo: "Returned: order cancelled" });
          await tx.update(O).set({ status: "cancelled" }).where(eq(O.id, orderId));
        });
        await services.library.content.dropPreview("order", orderId);
        const updated = await row(orderId);
        emit(updated);
        return (await views([updated]))[0];
      }
      throw refused("cannot_cancel", "It can be cancelled before you accept the quote, or if the delivery date passes with nothing delivered.");
    },

    async autoApproveOrders() {
      const due = await db.select().from(O).where(and(eq(O.status, "delivered"), lt(O.autoApproveAt, deps.clock.now())));
      for (const order of due) await approve(order);
      return due.length;
    },

    async notifyMakerListed(spotId) {
      const [order] = await db.select().from(O).where(and(eq(O.spotId, spotId), eq(O.tellMakerWhenListed, true)));
      if (!order) return;
      const team = await services.accounts.stationMemberIds(order.makerStationId, ["owner", "operator"]);
      await services.notifications.notify(team, {
        kind: "order_update",
        title: `${order.title} is listed`,
        body: "The spot you made is in the market. Add it to your rotation first if you like.",
        link: `/stations/${order.makerStationId}/spot-market`,
        scope: { kind: "station", id: order.makerStationId }
      });
    }
  };
  return part;
}
