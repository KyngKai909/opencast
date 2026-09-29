// A business's own settings beyond the profile (added 2026-09-29, the business app's requests):
// editing a location in place (P26), the logo (P11), closing the account (P21), what it's
// connected to for counting code uses (P20), how far a category reaches in a market (P9), and
// turning a typed address into coordinates (P10).

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { and, desc, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { Business, CategoryReach, Connections, Place } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { UploadedFile } from "../../http.js";
import { badRequest, conflict, HttpError, notFound, refused } from "../../errors.js";
import { publicUrl } from "../../lib/url.js";

type Provider = "shopify" | "stripe" | "square";

export interface LocationPatch {
  kind?: "location" | "service_area";
  label?: string | null;
  streetAddress?: string | null;
  city?: string;
  latitude?: number;
  longitude?: number;
  radiusMiles?: number | null;
}

export interface BusinessPart {
  updateLocation(businessId: string, locationId: string, patch: LocationPatch): Promise<Business>;
  uploadLogo(businessId: string, file: UploadedFile | null): Promise<Business>;
  closeBusiness(businessId: string, confirmName: string): Promise<{ closedAt: string; returnedMicros: number; heldMicros: number }>;
  /** Businesses closed with money still to send back once their held airings have aired. */
  closedBusinessIds(): Promise<string[]>;
  connections(businessId: string, owner: boolean): Promise<Connections>;
  connect(businessId: string, userId: string, kind: "clear_pay" | "checkout", input: { token: string; provider?: Provider }): Promise<Connections>;
  disconnect(businessId: string, kind: "clear_pay" | "checkout"): Promise<Connections>;
  /** A connected checkout's order webhook: each promotion code used counts as a use. Null: not a connection (404). */
  checkoutWebhook(hookToken: string, raw: Buffer, headers: Record<string, string | undefined>, url: string): Promise<{ counted: number } | null>;
  categoryReach(marketId: string, category: string): Promise<CategoryReach>;
  lookupPlace(q: string): Promise<Place>;
}

const AD = schema.advertisers;
const LOC = schema.advertiserLocations;
const CX = schema.connections;
const STRIPE_TOLERANCE_MS = 5 * 60_000;

export function createBusinessPart({ deps, services }: ModuleContext): BusinessPart {
  const { db } = deps;

  async function open(businessId: string) {
    const [row] = await db.select().from(AD).where(and(eq(AD.id, businessId), isNull(AD.closedAt)));
    if (!row) throw notFound("That business");
    return row;
  }

  async function view(businessId: string, owner: boolean): Promise<Connections> {
    const rows = await db.select().from(CX).where(and(eq(CX.advertiserId, businessId), isNull(CX.disconnectedAt))).orderBy(desc(CX.connectedAt));
    const clearPay = rows.find((r) => r.kind === "clear_pay");
    const checkout = rows.find((r) => r.kind === "checkout");
    return {
      clearPay: { connected: Boolean(clearPay), connectedAt: clearPay?.connectedAt.toISOString() ?? null },
      checkout: {
        connected: Boolean(checkout),
        provider: (checkout?.provider as Provider | undefined) ?? null,
        connectedAt: checkout?.connectedAt.toISOString() ?? null,
        webhookUrl: checkout && owner ? publicUrl(deps, `/v1/webhooks/checkout/${checkout.hookToken}`) : null
      }
    };
  }

  const part: BusinessPart = {
    async updateLocation(businessId, locationId, patch) {
      await open(businessId);
      const [current] = await db.select().from(LOC).where(and(eq(LOC.id, locationId), eq(LOC.advertiserId, businessId)));
      if (!current) throw notFound("That location");
      const kind = patch.kind ?? current.kind;
      const radiusMiles = kind === "location" ? null : patch.radiusMiles !== undefined ? patch.radiusMiles : current.radiusMiles;
      if (kind === "service_area" && !radiusMiles) throw badRequest("A service area needs a radius.", { radiusMiles: "Required" });
      // Changed where it is: it keeps its place in the list (the first place stays first).
      await db
        .update(LOC)
        .set({
          kind,
          label: patch.label !== undefined ? patch.label : current.label,
          streetAddress: kind === "service_area" ? null : patch.streetAddress !== undefined ? patch.streetAddress : current.streetAddress,
          city: patch.city ?? current.city,
          latitude: patch.latitude ?? current.latitude,
          longitude: patch.longitude ?? current.longitude,
          radiusMiles
        })
        .where(eq(LOC.id, locationId));
      return services.spots.business(businessId);
    },

    async uploadLogo(businessId, file) {
      await open(businessId);
      if (!file) throw badRequest("Choose the logo.", { file: "Required" });
      const meta = await sharp(file.path)
        .metadata()
        .catch(() => null);
      if (!meta || !meta.width || !meta.height || !["png", "jpeg", "webp"].includes(meta.format ?? "")) throw refused("not_an_image", "Choose a PNG or JPEG image.");
      if (meta.width !== meta.height || meta.width < 256) throw refused("logo_size", "The logo has to be square, at least 256 pixels.");
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-logo-"));
      try {
        const out = path.join(dir, "logo.png");
        await sharp(file.path).resize(512, 512).png().toFile(out);
        const content = services.library.content;
        const stored = await content.store(out, { storageClass: "standard", contentType: "image/png" });
        await content.addRef(db, stored.cid, "business_logo", businessId);
        await db.update(AD).set({ logoUrl: await content.url(stored.cid) }).where(eq(AD.id, businessId));
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
      return services.spots.business(businessId);
    },

    async closeBusiness(businessId, confirmName) {
      const row = await open(businessId);
      if (confirmName.trim().toLowerCase() !== row.name.trim().toLowerCase()) throw badRequest(`Type ${row.name} to close it.`, { confirmName: `Type ${row.name}` });
      // An order being made or reviewed has money held for the maker: finish or settle it first.
      const orders = await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.advertiserId, businessId));
      if (orders.some((o) => ["accepted", "delivered", "changes_requested", "disputed"].includes(o.status))) {
        throw conflict("order_in_progress", "A production order is being made for you. Approve it, or cancel it once its delivery date passes, then close the account.");
      }
      const balance = await services.ledger.balance(businessId);
      // The available balance goes back now, to the default bank or Clear account.
      const source = [...balance.fundingSources].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)).find((f) => f.kind !== "card");
      if (balance.availableMicros > 0 && !source) {
        throw conflict("no_source", "Add a bank or Clear account to send your money back to, then close the account. Money can't go back to a card.");
      }
      // Deposits still on their way are undone (a Clear transfer already sent lands, and follows).
      for (const pending of balance.pendingDeposits) await services.ledger.cancelDeposit(businessId, pending.id).catch(() => undefined);
      const returned = balance.availableMicros;
      if (returned > 0) await services.ledger.withdraw(businessId, { amountMicros: returned, fundingSourceId: source!.id });

      // Spots come out of every rotation (held airings still air); sponsorships stop renewing; unanswered orders are cancelled.
      const spots = await db.select({ id: schema.spotsTable.id }).from(schema.spotsTable).where(and(eq(schema.spotsTable.advertiserId, businessId), notInArray(schema.spotsTable.status, ["ended"])));
      for (const spot of spots) {
        await services.spots.end(spot.id);
        // A spot in review loses its review preview.
        await services.library.content.dropPreview("review", spot.id);
      }
      await db
        .update(schema.sponsorships)
        .set({ status: "ended" })
        .where(and(eq(schema.sponsorships.advertiserId, businessId), inArray(schema.sponsorships.status, ["requested", "approved"])));
      await db
        .update(schema.productionOrders)
        .set({ status: "cancelled" })
        .where(and(eq(schema.productionOrders.advertiserId, businessId), inArray(schema.productionOrders.status, ["asked", "quoted"])));
      await db.update(CX).set({ disconnectedAt: deps.clock.now() }).where(and(eq(CX.advertiserId, businessId), isNull(CX.disconnectedAt)));
      const closedAt = deps.clock.now();
      await db.update(AD).set({ closedAt, autoTopUp: false }).where(eq(AD.id, businessId));
      await services.accounts.closeBusinessAccess(businessId);
      const after = await services.ledger.balance(businessId);
      return { closedAt: closedAt.toISOString(), returnedMicros: returned, heldMicros: after.heldMicros };
    },

    async closedBusinessIds() {
      const rows = await db.select({ id: AD.id }).from(AD).where(isNotNull(AD.closedAt));
      return rows.map((r) => r.id);
    },

    async connections(businessId, owner) {
      await open(businessId);
      return view(businessId, owner);
    },

    async connect(businessId, userId, kind, input) {
      await open(businessId);
      if (kind === "checkout" && !input.provider) throw badRequest("Choose Shopify, Stripe or Square.", { provider: "Required" });
      const provider = kind === "checkout" ? input.provider! : "clear";
      const now = deps.clock.now();
      await db.transaction(async (tx) => {
        // One of each: connecting again replaces the one before.
        await tx.update(CX).set({ disconnectedAt: now }).where(and(eq(CX.advertiserId, businessId), eq(CX.kind, kind), isNull(CX.disconnectedAt)));
        await tx.insert(CX).values({ advertiserId: businessId, kind, provider, secret: input.token.trim(), hookToken: randomBytes(18).toString("base64url"), connectedBy: userId, connectedAt: now });
      });
      return view(businessId, true);
    },

    async disconnect(businessId, kind) {
      await open(businessId);
      await db.update(CX).set({ disconnectedAt: deps.clock.now() }).where(and(eq(CX.advertiserId, businessId), eq(CX.kind, kind), isNull(CX.disconnectedAt)));
      return view(businessId, true);
    },

    async checkoutWebhook(hookToken, raw, headers, url) {
      const [connection] = await db.select().from(CX).where(and(eq(CX.hookToken, hookToken), eq(CX.kind, "checkout"), isNull(CX.disconnectedAt)));
      if (!connection) return null;
      const provider = connection.provider as Provider;
      if (!verified(provider, connection.secret, raw, headers, url, deps.clock.now())) throw new HttpError(400, "bad_signature", "That webhook couldn't be verified.");
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
      } catch {
        throw badRequest("That webhook isn't JSON.");
      }
      const order = readOrder(provider, body, headers);
      if (!order || !order.codes.length) return { counted: 0 };
      // A retried webhook counts once.
      const [fresh] = await db.insert(schema.connectionEvents).values({ connectionId: connection.id, eventRef: order.ref }).onConflictDoNothing().returning();
      if (!fresh) return { counted: 0 };
      let counted = 0;
      for (const code of order.codes) {
        if (await services.spots.countUse(connection.advertiserId, { code, source: provider, customerRef: order.customer, at: order.at ?? deps.clock.now() })) counted++;
      }
      if (counted) await db.update(CX).set({ lastEventAt: deps.clock.now() }).where(eq(CX.id, connection.id));
      return { counted };
    },

    async categoryReach(marketId, category) {
      const market = (await services.network.marketsByIds([marketId])).get(marketId);
      if (!market) throw notFound("That market");
      const stations = (await services.stations.inMarkets([marketId])).filter((s) => s.kind !== "studio" && s.kind !== "listed" && s.status !== "signed_off");
      const lower = category.trim().toLowerCase();
      const blocking = stations.filter((s) => s.blockedCategories.some((c) => c.toLowerCase() === lower));
      const counts = new Map<string, number>();
      for (const s of stations) for (const c of s.blockedCategories) if (c.toLowerCase() !== lower) counts.set(c, (counts.get(c) ?? 0) + 1);
      return {
        category,
        marketName: market.name,
        reached: stations.length - blocking.length,
        total: stations.length,
        blockedBy: blocking.map((s) => s.ident.callSign ?? s.ident.name),
        sometimesBlocked: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c.toLowerCase())
      };
    },

    async lookupPlace(q) {
      const places = deps.places;
      if (!places?.configured) throw new HttpError(503, "not_available", "Addresses can't be looked up here yet. Choose Online to go on.");
      const found = await places.lookup(q.trim());
      if (!found) throw notFound("That address");
      const near = await services.network.marketNear({ lat: found.latitude, lng: found.longitude });
      return { ...found, marketId: near.market?.id ?? null };
    }
  };
  return part;
}

// ---- Checkout webhooks ------------------------------------------------------------

const hmac = (secret: string, data: string | Buffer) => createHmac("sha256", secret).update(data);
const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Each provider's signature: Shopify signs the body (base64, `X-Shopify-Hmac-Sha256`); Stripe signs
 * `t.body` (hex, `Stripe-Signature: t=…,v1=…`, within 5 minutes); Square signs the notification URL
 * and the body (base64, `X-Square-Hmacsha256-Signature`).
 */
export function verified(provider: Provider, secret: string, raw: Buffer, headers: Record<string, string | undefined>, url: string, now: Date): boolean {
  const header = (name: string) => headers[name] ?? headers[name.toLowerCase()];
  if (provider === "shopify") {
    const sig = header("x-shopify-hmac-sha256");
    return Boolean(sig) && same(hmac(secret, raw).digest("base64"), sig!);
  }
  if (provider === "stripe") {
    const sig = header("stripe-signature");
    if (!sig) return false;
    const parts = Object.fromEntries(sig.split(",").map((p) => p.split("=") as [string, string]));
    const t = Number(parts.t);
    if (!Number.isFinite(t) || Math.abs(now.getTime() - t * 1000) > STRIPE_TOLERANCE_MS) return false;
    const expected = hmac(secret, `${parts.t}.${raw.toString("utf8")}`).digest("hex");
    return sig
      .split(",")
      .filter((p) => p.startsWith("v1="))
      .some((p) => same(expected, p.slice(3)));
  }
  const sig = header("x-square-hmacsha256-signature");
  return Boolean(sig) && same(hmac(secret, url + raw.toString("utf8")).digest("base64"), sig!);
}

/** The codes an order used, who the customer was (the provider's id or email) and the event's id. */
export function readOrder(provider: Provider, body: Record<string, unknown>, headers: Record<string, string | undefined>): { ref: string; codes: string[]; customer: string | null; at: Date | null } | null {
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
  const when = (v: unknown) => {
    const t = typeof v === "number" ? v * 1000 : typeof v === "string" ? Date.parse(v) : NaN;
    return Number.isFinite(t) ? new Date(t) : null;
  };
  if (provider === "shopify") {
    // orders/paid (or orders/create): discount_codes[].code.
    const ref = text(headers["x-shopify-webhook-id"]) ?? text(body.id);
    if (!ref) return null;
    const customer = obj(body.customer);
    return {
      ref,
      codes: list(body.discount_codes).flatMap((d) => text(obj(d).code) ?? []),
      customer: text(customer.id) ?? text(body.email) ?? text(customer.email),
      at: when(body.processed_at ?? body.created_at)
    };
  }
  if (provider === "stripe") {
    // checkout.session.completed (and invoice.paid): the promotion codes, expanded or in metadata.
    const ref = text(body.id);
    const type = text(body.type);
    if (!ref || !type || !["checkout.session.completed", "invoice.paid", "payment_intent.succeeded", "charge.succeeded"].includes(type)) return ref ? { ref, codes: [], customer: null, at: null } : null;
    const o = obj(obj(body.data).object);
    const codes = new Set<string>();
    for (const d of list(o.discounts)) {
      const promo = obj(d).promotion_code;
      const code = text(obj(promo).code);
      if (code) codes.add(code);
    }
    for (const d of list(obj(obj(o.total_details).breakdown).discounts)) {
      const code = text(obj(obj(obj(d).discount).promotion_code).code);
      if (code) codes.add(code);
    }
    const meta = obj(o.metadata);
    for (const key of ["promotion_code", "opencast_code", "code"]) if (text(meta[key])) codes.add(text(meta[key])!);
    return { ref, codes: [...codes], customer: text(o.customer) ?? text(obj(o.customer_details).email) ?? text(o.customer_email), at: when(body.created) };
  }
  // Square: order.updated / payment events carry the order's discounts; a discount named for the code counts.
  const ref = text(body.event_id);
  if (!ref) return null;
  const data = obj(obj(body.data).object);
  const order = obj(data.order ?? data.order_updated ?? data);
  return {
    ref,
    codes: list(order.discounts).flatMap((d) => text(obj(d).name) ?? []),
    customer: text(order.customer_id),
    at: when(order.updated_at ?? order.created_at ?? body.created_at)
  };
}
