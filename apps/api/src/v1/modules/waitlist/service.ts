import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { schema } from "@opencast/db";
import { formatChannelNumber, isValidCallSign, parseChannelNumber, type Band } from "@opencast/domain";
import type { Market } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import { badRequest, conflict, notFound } from "../../errors.js";

type Role = "viewer" | "station" | "producer" | "business";

export interface WaitlistService {
  heldChannels(marketId: string, band: Band): Promise<Array<{ tenths: number; callSign: string }>>;
  /** Lets a station take a call sign held for the same person; refuses one held for someone else. */
  claimCallSign(db: Executor, input: { callSign: string; stationId: string; userId: string }): Promise<void>;
  /** After signing off for good: the call sign stays held for the station for a year. */
  holdAfterSignOff(stationId: string): Promise<void>;
  isAvailable(callSign: string): Promise<boolean>;
  countInMarket(marketId: string): Promise<number>;
  join(input: { role: Role; email: string; zip: string; callSign?: string }): Promise<{ role: Role; market: Market | null; message: string; heldCallSign: string | null }>;
  reservations(marketId?: string): Promise<Array<{ id: string; callSign: string; email: string | null; market: Market | null; channel: string | null; heldUntil: string | null; createdAt: string }>>;
  holdChannel(reservationId: string, input: { marketId: string; band: Band; channel: string }): Promise<void>;
  signups(filter: { marketId?: string; role?: Role }): Promise<Array<{ id: string; role: Role; email: string; zip: string; market: Market | null; callSign: string | null; createdAt: string }>>;
}

const R = schema.callSignReservations;
const H = schema.channelHolds;
const W = schema.waitlistSignups;
const YEAR = 365 * 86_400_000;

export function createWaitlistService({ deps, services }: ModuleContext): WaitlistService {
  const { db } = deps;

  const service: WaitlistService = {
    async heldChannels(marketId, band) {
      const rows = await db
        .select({ tenths: H.tenths, callSign: R.callSign })
        .from(H)
        .innerJoin(R, eq(R.id, H.reservationId))
        .where(and(eq(H.marketId, marketId), eq(H.band, band), isNull(H.releasedAt)));
      return rows;
    },

    async claimCallSign(tx, { callSign, stationId, userId }) {
      const [reservation] = await tx
        .select({ reservation: R, email: W.email })
        .from(R)
        .leftJoin(W, eq(W.id, R.signupId))
        .where(and(eq(R.callSign, callSign), isNull(R.releasedAt)));
      if (!reservation || reservation.reservation.stationId === stationId) return;
      if (reservation.reservation.stationId) throw conflict("call_sign_held", `${callSign} is held for someone else.`);
      const emails = await services.accounts.emailsOf(userId);
      if (!reservation.email || !emails.includes(reservation.email.toLowerCase())) {
        throw conflict("call_sign_held", `${callSign} is held for someone else.`);
      }
      await tx.update(R).set({ stationId }).where(eq(R.id, reservation.reservation.id));
    },

    async holdAfterSignOff(stationId) {
      const [ident] = [...(await services.stations.idents([stationId])).values()];
      if (!ident?.callSign) return;
      await db
        .update(R)
        .set({ releasedAt: deps.clock.now() })
        .where(and(eq(R.callSign, ident.callSign), isNull(R.releasedAt)));
      await db.insert(R).values({
        callSign: ident.callSign,
        stationId,
        reason: "signed_off",
        heldUntil: new Date(deps.clock.now().getTime() + YEAR)
      });
    },

    async isAvailable(callSign) {
      if (!isValidCallSign(callSign)) return false;
      const [held] = await db.select({ id: R.id }).from(R).where(and(eq(R.callSign, callSign), isNull(R.releasedAt)));
      if (held) return false;
      return !(await services.stations.byRef(callSign));
    },

    async countInMarket(marketId) {
      const rows = await db.select({ id: W.id }).from(W).where(eq(W.marketId, marketId));
      return rows.length;
    },

    async join(input) {
      const market = await services.network.marketForZip(input.zip);
      const email = input.email.toLowerCase();
      if (input.callSign && !(await service.isAvailable(input.callSign))) {
        throw conflict("call_sign_taken", `${input.callSign} is taken. Try another.`);
      }
      await db.transaction(async (tx) => {
        const [signup] = await tx
          .insert(W)
          .values({ role: input.role, email, zip: input.zip, marketId: market?.id ?? null, requestedCallSign: input.callSign ?? null })
          .returning();
        if (input.role === "station" && input.callSign) {
          await tx.insert(R).values({ callSign: input.callSign, signupId: signup.id, marketId: market?.id ?? null, reason: "waitlist" });
        }
      });
      const message = {
        viewer: "You're on the list.",
        station: input.callSign ? `${input.callSign} is on hold for you.` : "Your station is on the list.",
        producer: "Your programs are on the list.",
        business: "Your business is on the list."
      }[input.role];
      return { role: input.role, market, message, heldCallSign: input.role === "station" ? (input.callSign ?? null) : null };
    },

    async reservations(marketId) {
      const rows = await db
        .select({ reservation: R, email: W.email })
        .from(R)
        .leftJoin(W, eq(W.id, R.signupId))
        .where(and(isNull(R.releasedAt), ...(marketId ? [eq(R.marketId, marketId)] : [])))
        .orderBy(desc(R.createdAt));
      const holds = rows.length
        ? await db.select().from(H).where(and(inArray(H.reservationId, rows.map((r) => r.reservation.id)), isNull(H.releasedAt)))
        : [];
      const markets = await services.network.marketsByIds([...rows.map((r) => r.reservation.marketId), ...holds.map((h) => h.marketId)].filter((v): v is string => Boolean(v)));
      return rows.map(({ reservation, email }) => {
        const hold = holds.find((h) => h.reservationId === reservation.id);
        return {
          id: reservation.id,
          callSign: reservation.callSign,
          email,
          market: reservation.marketId ? (markets.get(reservation.marketId) ?? null) : null,
          channel: hold ? formatChannelNumber({ band: hold.band, tenths: hold.tenths }) : null,
          heldUntil: reservation.heldUntil?.toISOString() ?? null,
          createdAt: reservation.createdAt.toISOString()
        };
      });
    },

    async holdChannel(reservationId, input) {
      const number = parseChannelNumber(input.band, input.channel);
      if (!number) throw badRequest("That channel isn't in the band.");
      const [reservation] = await db.select().from(R).where(and(eq(R.id, reservationId), isNull(R.releasedAt)));
      if (!reservation) throw notFound("That reservation");
      await db.insert(H).values({ marketId: input.marketId, band: input.band, tenths: number.tenths, reservationId });
    },

    async signups(filter) {
      const rows = await db
        .select()
        .from(W)
        .where(and(...(filter.marketId ? [eq(W.marketId, filter.marketId)] : []), ...(filter.role ? [eq(W.role, filter.role)] : [])))
        .orderBy(desc(W.createdAt));
      const markets = await services.network.marketsByIds(rows.map((r) => r.marketId).filter((v): v is string => Boolean(v)));
      return rows.map((r) => ({
        id: r.id,
        role: r.role,
        email: r.email,
        zip: r.zip,
        market: r.marketId ? (markets.get(r.marketId) ?? null) : null,
        callSign: r.requestedCallSign,
        createdAt: r.createdAt.toISOString()
      }));
    }
  };
  return service;
}
