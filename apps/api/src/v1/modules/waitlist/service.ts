import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, ne } from "drizzle-orm";
import { schema } from "@opencast/db";
import { formatChannelNumber, isValidCallSign, parseChannelNumber, type Band } from "@opencast/domain";
import { callSignIdeas, callSignRefusal, type CallSignRefusal, type FlaggedStation, type Market, type Reservation, type ReservationInvite, type ReservationsOverview, type ReservationState } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import type { CurrentUser } from "../../http.js";
import { badRequest, conflict, HttpError, notFound, refused } from "../../errors.js";
import { maskEmail } from "../../email.js";

type Role = "viewer" | "station" | "producer" | "business";

export interface CallSignCheck {
  callSign: string;
  valid: boolean;
  available: boolean;
  reservable: boolean;
  heldForYou: boolean;
  refusal: CallSignRefusal | null;
  suggestions: string[];
}

export interface WaitlistService {
  heldChannels(marketId: string, band: Band): Promise<Array<{ tenths: number; callSign: string }>>;
  /** Lets a station take a call sign held for the same person; refuses one held for someone else. */
  claimCallSign(db: Executor, input: { callSign: string; stationId: string; userId: string }): Promise<void>;
  /** After signing off for good: the call sign stays held for the station for a year. */
  holdAfterSignOff(stationId: string): Promise<void>;
  /**
   * A215 (added 2026-09-30): the same hold, inside a transaction, for a call sign a station lets go
   * (an external station taken off the dial, or its call sign changed): a year, for that station.
   */
  holdCallSign(db: Executor, input: { callSign: string; stationId: string }): Promise<Date>;
  /** A215: the station has its call sign again (an external station put back, or given its old one back): its hold is done. */
  releaseHeldFor(db: Executor, input: { callSign: string; stationId: string }): Promise<void>;
  /** `forStationId` (added 2026-09-30): a name held for that station, or its own, counts as available to it. */
  isAvailable(callSign: string, forStationId?: string): Promise<boolean>;
  countInMarket(marketId: string): Promise<number>;
  join(input: { role: Role; email: string; zip: string; callSign?: string; name?: string; about?: string }): Promise<{ role: Role; market: Market | null; message: string; heldCallSign: string | null }>;
  reservations(marketId?: string): Promise<Reservation[]>;
  holdChannel(reservationId: string, input: { marketId: string; band: Band; channel: string }): Promise<void>;
  /** `stationId` and `done` (added 2026-09-29): the station set up from their invite, and so done on the waitlist. */
  signups(filter: { marketId?: string; role?: Role }): Promise<Array<{ id: string; role: Role; email: string; zip: string; market: Market | null; callSign: string | null; createdAt: string; stationId: string | null; done: boolean }>>;

  // Added 2026-09-29: reserved call signs on the desk (desk-pages 02).
  /** 422 `call_sign_refused` for a name `call_signs.refused` doesn't allow (the waitlist and station setup). */
  requireAllowed(callSign: string): Promise<void>;
  check(callSign: string, userId: string | null): Promise<CallSignCheck>;
  /** Free, allowed names to offer in place of this one. */
  suggestionsFor(callSign: string, limit?: number): Promise<string[]>;
  overview(user: CurrentUser, marketId: string): Promise<ReservationsOverview>;
  invite(user: CurrentUser, reservationId: string): Promise<Reservation>;
  inviteNext(user: CurrentUser, marketId: string, count: number): Promise<{ invited: Reservation[]; left: number }>;
  extend(user: CurrentUser, reservationId: string, note?: string): Promise<Reservation>;
  release(user: CurrentUser, reservationId: string, note?: string): Promise<{ ok: true; callSign: string; channel: string | null }>;
  decide(user: CurrentUser, reservationId: string, input: { suggestions?: Array<{ reservationId: string; callSign: string }>; note?: string }): Promise<{ kept: Reservation; told: Array<{ reservationId: string; email: string | null; suggestion: string | null }> }>;
  suggest(user: CurrentUser, reservationId: string, input: { callSign: string; alternatives?: string[]; note?: string }): Promise<Reservation>;
  // Added 2026-09-29: the invite's link opens station setup with the call sign and channel held.
  /** The invite's link (`/control/new?reservation=<id>`) as master control reads it. */
  invitePreview(reservationId: string, user: CurrentUser | null): Promise<ReservationInvite>;
  /**
   * Before a station is started from an invite: 404 unless it's a waitlist hold, 422
   * `reservation_ended` once it has ended, 409 `reservation_used` when a station has it, 403
   * `reservation_email_mismatch` unless the person has the signup's email (INVITE_EMAIL_MATCH),
   * 422 `call_sign_refused`, 409 `call_sign_undecided`. Says the call sign and any channel held.
   */
  inviteFor(user: CurrentUser, reservationId: string): Promise<{ callSign: string; channel: { marketId: string; band: Band; tenths: number } | null }>;
  /** Inside the new station's transaction: the reservation is its (signing on). 409 `reservation_used` if another got there first. */
  tieToStation(tx: Executor, reservationId: string, stationId: string): Promise<void>;
  /** A station chose another channel: the channels held with its call sign for any other number are let go. */
  releaseOtherChannels(tx: Executor, stationId: string, keep: { marketId: string; band: Band; tenths: number }): Promise<void>;
  /** The jobs' hourly pass: reminders before the end, holds that ended (and their channels), holds whose station signed on. */
  sweep(): Promise<{ reminded: number; expired: number; signedOn: number }>;
}

const R = schema.callSignReservations;
const H = schema.channelHolds;
const W = schema.waitlistSignups;
const YEAR = 365 * 86_400_000;
const DAY = 86_400_000;

type Row = { reservation: typeof R.$inferSelect; email: string | null; name: string | null; about: string | null };
type ReleaseReason = NonNullable<(typeof R.$inferSelect)["releaseReason"]>;

/** Held firmly: nobody else can ask for it (a station's, the desk's, one being set up, or kept by a decision). */
const firm = (r: typeof R.$inferSelect) => r.reason !== "waitlist" || !!r.stationId || r.decision === "kept";

const FOOTER = "You're getting this because you reserved a call sign on Opencast's waitlist.";

export function createWaitlistService({ deps, services }: ModuleContext): WaitlistService {
  const { db } = deps;

  const rowsWhere = (where: ReturnType<typeof and>) =>
    db
      .select({ reservation: R, email: W.email, name: W.name, about: W.about })
      .from(R)
      .leftJoin(W, eq(W.id, R.signupId))
      .where(where)
      .orderBy(asc(R.createdAt), asc(R.id));

  async function activeRow(reservationId: string): Promise<Row> {
    const [row] = await rowsWhere(and(eq(R.id, reservationId), isNull(R.releasedAt)));
    if (!row) throw notFound("That reservation");
    return row;
  }

  const rules = () => services.settings.valueAt("call_signs.refused");
  const hold = () => services.settings.valueAt("call_signs.hold");

  /** Only an admin, or the market's lead; a reservation with no market is admins'. */
  const need = (user: CurrentUser, marketId: string | null) => services.settings.requireDesk(user, marketId ? { market: marketId } : "admin");

  const dateWords = (d: Date, timeZone: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone }).format(d);

  async function heldNames(callSigns: string[], ex: Executor = db): Promise<Set<string>> {
    if (!callSigns.length) return new Set();
    const rows = await ex.select({ callSign: R.callSign }).from(R).where(and(inArray(R.callSign, callSigns), isNull(R.releasedAt)));
    return new Set(rows.map((r) => r.callSign));
  }

  /** The desk's view of each row: its state, the others asking for the same name, whether it's allowed now. */
  async function views(rows: Row[]): Promise<Reservation[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.reservation.id);
    const [holds, refusedRules, holdRule] = await Promise.all([db.select().from(H).where(and(inArray(H.reservationId, ids), isNull(H.releasedAt))), rules(), hold()]);
    const names = [...new Set(rows.map((r) => r.reservation.callSign))];
    const sameNames = await db
      .select({ id: R.id, callSign: R.callSign })
      .from(R)
      .where(and(inArray(R.callSign, names), isNull(R.releasedAt)));
    const markets = await services.network.marketsByIds([...rows.map((r) => r.reservation.marketId), ...holds.map((h) => h.marketId)].filter((v): v is string => Boolean(v)));
    const now = deps.clock.now().getTime();
    return rows.map(({ reservation: r, email, name, about }) => {
      const h = holds.find((x) => x.reservationId === r.id);
      const refusal = r.reason === "signed_off" ? null : callSignRefusal(r.callSign, refusedRules);
      const sameName = firm(r) ? [] : sameNames.filter((x) => x.callSign === r.callSign && x.id !== r.id).map((x) => x.id);
      const ending = !!r.heldUntil && r.heldUntil.getTime() - now <= holdRule.reminderDays * DAY;
      const state: ReservationState =
        r.reason === "signed_off" ? "held_after_sign_off" : refusal ? "not_allowed" : sameName.length ? "same_name" : ending ? "ending" : r.stationId ? "signing_on" : r.invitedAt ? "invited" : "waiting";
      return {
        id: r.id,
        callSign: r.callSign,
        email,
        market: r.marketId ? (markets.get(r.marketId) ?? null) : null,
        channel: h ? formatChannelNumber({ band: h.band, tenths: h.tenths }) : null,
        heldUntil: r.heldUntil?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        state,
        reason: r.reason,
        name,
        about,
        invitedAt: r.invitedAt?.toISOString() ?? null,
        remindedAt: r.remindedAt?.toISOString() ?? null,
        extendedAt: r.extendedAt?.toISOString() ?? null,
        stationId: r.stationId,
        sameName,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        refusal
      };
    });
  }

  const viewOf = async (reservationId: string) => (await views([await activeRow(reservationId)]))[0]!;

  async function timezoneOf(marketId: string | null): Promise<string> {
    if (!marketId) return "America/Los_Angeles";
    return (await services.network.marketsByIds([marketId])).get(marketId)?.timezone ?? "America/Los_Angeles";
  }

  /** Ends a hold: the reservation and any channel held with it. */
  async function releaseRow(ex: Executor, reservationId: string, reason: ReleaseReason, by: string | null, extra: Partial<typeof R.$inferInsert> = {}) {
    const now = deps.clock.now();
    await ex
      .update(R)
      .set({ releasedAt: now, releaseReason: reason, releasedBy: by, ...extra })
      .where(eq(R.id, reservationId));
    await ex
      .update(H)
      .set({ releasedAt: now })
      .where(and(eq(H.reservationId, reservationId), isNull(H.releasedAt)));
  }

  /** Holds `callSign` for the same person in place of `old`: the same place in line, end and channel. */
  async function holdInstead(ex: Executor, old: typeof R.$inferSelect, callSign: string, note: string | null) {
    const [row] = await ex
      .insert(R)
      .values({
        callSign,
        signupId: old.signupId,
        marketId: old.marketId,
        reason: old.reason,
        heldUntil: old.heldUntil,
        createdAt: old.createdAt,
        invitedAt: old.invitedAt,
        replaces: old.id,
        note
      })
      .returning();
    await ex
      .update(H)
      .set({ reservationId: row.id })
      .where(and(eq(H.reservationId, old.id), isNull(H.releasedAt)));
    return row;
  }

  /** 409 or 422 unless `callSign` could be held for someone now. */
  async function requireFree(callSign: string, ex: Executor = db) {
    if (!isValidCallSign(callSign)) throw badRequest("Three to five capital letters.", { callSign: "Three to five capital letters" });
    const refusal = callSignRefusal(callSign, await rules());
    if (refusal) throw refused("call_sign_refused", `${callSign} isn't allowed either. ${refusal.reason}`);
    const [station, held] = await Promise.all([services.stations.takenCallSigns([callSign]), heldNames([callSign], ex)]);
    if (station.has(callSign) || held.has(callSign)) throw conflict("call_sign_taken", `${callSign} is taken. Choose another.`);
  }

  async function tell(to: string | null, notice: { title: string; body: string; action?: string; link?: string | null; key?: string }) {
    if (!to) return;
    await deps.notifier.email(to, { title: notice.title, body: notice.body, link: notice.link ?? `${deps.config.appOrigin}/control/new`, action: notice.action ?? "Set up your station", footer: FOOTER, kind: "desk", key: notice.key });
  }

  async function sendInvite(row: Row, view: Reservation) {
    const tz = view.market?.timezone ?? "America/Los_Angeles";
    const until = row.reservation.heldUntil ? ` until ${dateWords(row.reservation.heldUntil, tz)}` : "";
    await tell(row.email, {
      title: `Sign on as ${view.callSign}`,
      body:
        `${view.market ? `The ${view.market.name} is opening on Opencast` : "Opencast is ready for you"}, and ${view.callSign} is held for you${until}.${view.channel ? ` So is channel ${view.channel}.` : ""}\n\n` +
        `Sign in with ${row.email} to set up your station. It starts with ${view.callSign} as its call sign${view.channel ? ` and ${view.channel} as its channel` : ""}: nobody else can have ${view.channel ? "them" : "it"}.`,
      // The link opens setup with the call sign and channel held (added 2026-09-29).
      link: `${deps.config.appOrigin}/control/new?reservation=${row.reservation.id}`,
      key: `invite-${row.reservation.id}-${deps.clock.now().getTime()}`
    });
  }

  async function checkNeedsAll(user: CurrentUser, rows: Row[]) {
    for (const marketId of new Set(rows.map((r) => r.reservation.marketId))) await need(user, marketId);
  }

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
      const rows = await tx
        .select({ reservation: R, email: W.email })
        .from(R)
        .leftJoin(W, eq(W.id, R.signupId))
        .where(and(eq(R.callSign, callSign), isNull(R.releasedAt)));
      if (!rows.length || rows.some((r) => r.reservation.stationId === stationId)) return;
      const emails = await services.accounts.emailsOf(userId);
      const mine = rows.filter((r) => !r.reservation.stationId && r.email && emails.includes(r.email.toLowerCase()));
      // Two people asked for it (2026-09-29): nobody takes it until the desk decides.
      if (mine.length && rows.length > 1) throw conflict("call_sign_undecided", `Someone else asked for ${callSign} too. Opencast's team is deciding who keeps it, and will write to you.`);
      if (!mine.length) throw conflict("call_sign_held", `${callSign} is held for someone else.`);
      await tx.update(R).set({ stationId }).where(eq(R.id, mine[0]!.reservation.id));
    },

    async holdAfterSignOff(stationId) {
      const [ident] = [...(await services.stations.idents([stationId])).values()];
      if (!ident?.callSign) return;
      await db
        .update(R)
        .set({ releasedAt: deps.clock.now(), releaseReason: "replaced" })
        .where(and(eq(R.callSign, ident.callSign), isNull(R.releasedAt)));
      await db.insert(R).values({
        callSign: ident.callSign,
        stationId,
        reason: "signed_off",
        heldUntil: new Date(deps.clock.now().getTime() + YEAR)
      });
    },

    async holdCallSign(tx, { callSign, stationId }) {
      const until = new Date(deps.clock.now().getTime() + YEAR);
      await tx
        .update(R)
        .set({ releasedAt: deps.clock.now(), releaseReason: "replaced" })
        .where(and(eq(R.callSign, callSign), isNull(R.releasedAt)));
      await tx.insert(R).values({ callSign, stationId, reason: "signed_off", heldUntil: until });
      return until;
    },

    async releaseHeldFor(tx, { callSign, stationId }) {
      await tx
        .update(R)
        .set({ releasedAt: deps.clock.now(), releaseReason: "signed_on" })
        .where(and(eq(R.callSign, callSign), eq(R.stationId, stationId), isNull(R.releasedAt)));
    },

    async isAvailable(callSign, forStationId) {
      if (!isValidCallSign(callSign)) return false;
      const held = await db.select({ stationId: R.stationId }).from(R).where(and(eq(R.callSign, callSign), isNull(R.releasedAt)));
      if (held.some((h) => !forStationId || h.stationId !== forStationId)) return false;
      const station = await services.stations.byRef(callSign);
      return !station || (!!forStationId && station.id === forStationId);
    },

    async countInMarket(marketId) {
      const rows = await db.select({ id: W.id }).from(W).where(eq(W.marketId, marketId));
      return rows.length;
    },

    async requireAllowed(callSign) {
      const refusal = callSignRefusal(callSign, await rules());
      if (!refusal) return;
      const ideas = await service.suggestionsFor(callSign, 2);
      throw new HttpError(422, "call_sign_refused", `${refusal.reason}${ideas.length ? ` Try ${ideas.join(" or ")}.` : " Choose another."}`, { callSign: refusal.reason });
    },

    async check(raw, userId) {
      const callSign = raw.toUpperCase();
      if (!isValidCallSign(callSign)) return { callSign, valid: false, available: false, reservable: false, heldForYou: false, refusal: null, suggestions: [] };
      const [refusedRules, active, stations] = await Promise.all([rules(), rowsWhere(and(eq(R.callSign, callSign), isNull(R.releasedAt))), services.stations.takenCallSigns([callSign])]);
      const refusal = callSignRefusal(callSign, refusedRules);
      const emails = userId ? await services.accounts.emailsOf(userId) : [];
      const mine = active.filter((r) => r.reservation.reason === "waitlist" && r.email && emails.includes(r.email.toLowerCase()));
      const heldForYou = mine.length > 0 && (active.length === 1 || mine.some((r) => r.reservation.decision === "kept"));
      const onStation = stations.has(callSign);
      const available = !refusal && !onStation && (!active.length || heldForYou);
      const reservable = !refusal && !onStation && !active.some((r) => firm(r.reservation));
      const suggestions = !available || refusal ? await service.suggestionsFor(callSign) : [];
      return { callSign, valid: true, available, reservable, heldForYou, refusal, suggestions };
    },

    async suggestionsFor(callSign, limit = 3) {
      const refusedRules = await rules();
      const ideas = callSignIdeas(callSign).filter((i) => !callSignRefusal(i, refusedRules));
      const [stations, held] = await Promise.all([services.stations.takenCallSigns(ideas), heldNames(ideas)]);
      return ideas.filter((i) => !stations.has(i) && !held.has(i)).slice(0, limit);
    },

    async join(input) {
      const market = await services.network.marketForZip(input.zip);
      const email = input.email.toLowerCase();
      const callSign = input.role === "station" ? input.callSign : undefined;
      let alsoAsked = false;
      let already = false;
      if (callSign) {
        const refusal = callSignRefusal(callSign, await rules());
        if (refusal) {
          const ideas = await service.suggestionsFor(callSign, 2);
          throw new HttpError(422, "call_sign_refused", `${refusal.reason}${ideas.length ? ` Try ${ideas.join(" or ")}.` : " Try another."}`, { callSign: refusal.reason });
        }
        const [active, stations] = await Promise.all([rowsWhere(and(eq(R.callSign, callSign), isNull(R.releasedAt))), services.stations.takenCallSigns([callSign])]);
        already = active.some((r) => r.email === email && r.reservation.reason === "waitlist");
        if (!already && (stations.has(callSign) || active.some((r) => firm(r.reservation)))) {
          const ideas = await service.suggestionsFor(callSign, 2);
          throw conflict("call_sign_taken", `${callSign} is taken. ${ideas.length ? `Try ${ideas.join(" or ")}.` : "Try another."}`);
        }
        alsoAsked = !already && active.length > 0;
      }
      const days = (await hold()).days;
      const now = deps.clock.now();
      await db.transaction(async (tx) => {
        const [signup] = await tx
          .insert(W)
          .values({ role: input.role, email, zip: input.zip, marketId: market?.id ?? null, requestedCallSign: input.callSign ?? null, name: input.name?.trim() || null, about: input.about?.trim() || null, createdAt: now })
          .returning();
        if (callSign && !already) {
          // Its place in line is when it was asked for; it ends the hold's days later.
          await tx.insert(R).values({ callSign, signupId: signup.id, marketId: market?.id ?? null, reason: "waitlist", heldUntil: new Date(now.getTime() + days * DAY), createdAt: now });
        }
      });
      const message = {
        viewer: "You're on the list.",
        station: callSign
          ? already
            ? `${callSign} is already on hold for you.`
            : alsoAsked
              ? `${callSign} is on hold for you. Someone else asked for it too: Opencast's team decides who keeps it, and writes to you either way.`
              : `${callSign} is on hold for you.`
          : "Your station is on the list.",
        producer: "Your programs are on the list.",
        business: "Your business is on the list."
      }[input.role];
      return { role: input.role, market, message, heldCallSign: callSign ?? null };
    },

    async reservations(marketId) {
      return views(await rowsWhere(and(isNull(R.releasedAt), ...(marketId ? [eq(R.marketId, marketId)] : []))));
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
      // Done: a station was set up from one of their reservations (their invite's link).
      const started = rows.length
        ? await db
            .select({ signupId: R.signupId, stationId: R.stationId })
            .from(R)
            .where(and(inArray(R.signupId, rows.map((r) => r.id)), isNotNull(R.stationId), eq(R.reason, "waitlist")))
        : [];
      const stationOf = new Map(started.map((s) => [s.signupId!, s.stationId!]));
      return rows.map((r) => ({
        id: r.id,
        role: r.role,
        email: r.email,
        zip: r.zip,
        market: r.marketId ? (markets.get(r.marketId) ?? null) : null,
        callSign: r.requestedCallSign,
        createdAt: r.createdAt.toISOString(),
        stationId: stationOf.get(r.id) ?? null,
        done: stationOf.has(r.id)
      }));
    },

    async overview(user, marketId) {
      await need(user, marketId);
      const market = (await services.network.marketsByIds([marketId])).get(marketId);
      if (!market) throw notFound("That market");
      const [list, holdRule, refusedRules, onDial] = await Promise.all([service.reservations(marketId), hold(), rules(), services.stations.inMarkets([marketId])]);
      const flaggedStations: FlaggedStation[] = [];
      for (const s of onDial) {
        const refusal = s.ident.callSign ? callSignRefusal(s.ident.callSign, refusedRules) : null;
        if (refusal && s.ident.callSign) flaggedStations.push({ stationId: s.id, callSign: s.ident.callSign, name: s.ident.name, channel: s.ident.channel, refusal });
      }
      return {
        market,
        held: list.length,
        withChannel: list.filter((r) => r.channel).length,
        toInvite: list.filter(invitable).length,
        needsDecision: list.filter((r) => r.state === "same_name" || r.state === "not_allowed").length,
        holdDays: holdRule.days,
        reminderDays: holdRule.reminderDays,
        flaggedStations: flaggedStations.sort((a, b) => a.callSign.localeCompare(b.callSign))
      };
    },

    async invite(user, reservationId) {
      const row = await activeRow(reservationId);
      await need(user, row.reservation.marketId);
      const [view] = await views([row]);
      if (view!.state === "not_allowed") throw refused("not_allowed", `${view!.callSign} isn't allowed. Suggest another name first.`);
      if (view!.state === "same_name") throw refused("same_name", `Two people asked for ${view!.callSign}. Decide who keeps it first.`);
      if (row.reservation.reason !== "waitlist") throw refused("not_waitlist", `${view!.callSign} isn't held for anyone on the waitlist.`);
      if (!row.email) throw refused("no_email", "There's no email to send the invite to.");
      await sendInvite(row, view!);
      const now = deps.clock.now();
      await db.update(R).set({ invitedAt: now }).where(eq(R.id, reservationId));
      if (row.reservation.signupId) await db.update(W).set({ notifiedAt: now }).where(eq(W.id, row.reservation.signupId));
      return viewOf(reservationId);
    },

    async inviteNext(user, marketId, count) {
      await need(user, marketId);
      const rows = await rowsWhere(and(isNull(R.releasedAt), eq(R.marketId, marketId)));
      const list = await views(rows);
      const next = list.filter(invitable);
      const invited: Reservation[] = [];
      for (const view of next.slice(0, count)) invited.push(await service.invite(user, view.id));
      return { invited, left: next.length - invited.length };
    },

    async extend(user, reservationId, note) {
      const row = await activeRow(reservationId);
      await need(user, row.reservation.marketId);
      const now = deps.clock.now();
      const days = (await hold()).days;
      const from = Math.max(now.getTime(), row.reservation.heldUntil?.getTime() ?? now.getTime());
      await db
        .update(R)
        .set({ heldUntil: new Date(from + days * DAY), extendedAt: now, extendedBy: user.id, remindedAt: null, ...(note?.trim() ? { note: note.trim() } : {}) })
        .where(eq(R.id, reservationId));
      return viewOf(reservationId);
    },

    async release(user, reservationId, note) {
      const row = await activeRow(reservationId);
      await need(user, row.reservation.marketId);
      const [view] = await views([row]);
      await db.transaction((tx) => releaseRow(tx, reservationId, "released", user.id, note?.trim() ? { note: note.trim() } : {}));
      if (row.reservation.reason === "waitlist") {
        await tell(row.email, {
          title: `Your hold on ${view!.callSign} has ended`,
          body: `Opencast's team ended your hold on ${view!.callSign}${view!.channel ? ` and channel ${view!.channel}` : ""}. If it's still free, you can reserve it again on the waitlist.`,
          link: deps.config.appOrigin,
          action: "Open Opencast"
        });
      }
      return { ok: true as const, callSign: view!.callSign, channel: view!.channel };
    },

    async decide(user, reservationId, input) {
      const row = await activeRow(reservationId);
      const [view] = await views([row]);
      if (!view!.sameName.length) throw refused("not_same_name", `Nobody else is waiting for ${view!.callSign}.`);
      const others = await rowsWhere(and(inArray(R.id, view!.sameName), isNull(R.releasedAt)));
      await checkNeedsAll(user, [row, ...others]);
      // A name for each of the others: the one chosen here, else the next free suggestion.
      const chosen = new Map((input.suggestions ?? []).map((s) => [s.reservationId, s.callSign]));
      for (const id of chosen.keys()) if (!others.some((o) => o.reservation.id === id)) throw badRequest("A suggestion is for someone who isn't asking for this name.", { suggestions: "Unknown reservation" });
      const picked: Array<{ row: Row; suggestion: string | null }> = [];
      const pool = await service.suggestionsFor(view!.callSign, others.length + 3);
      for (const o of others) {
        const given = chosen.get(o.reservation.id);
        if (given) {
          if (picked.some((p) => p.suggestion === given)) throw badRequest(`${given} can go to one person only.`, { suggestions: "Twice" });
          await requireFree(given);
          picked.push({ row: o, suggestion: given });
        } else {
          picked.push({ row: o, suggestion: pool.find((s) => ![...chosen.values()].includes(s) && !picked.some((p) => p.suggestion === s)) ?? null });
        }
      }
      const now = deps.clock.now();
      const note = input.note?.trim() || null;
      await db.transaction(async (tx) => {
        await tx.update(R).set({ decision: "kept", decidedAt: now, decidedBy: user.id, ...(note ? { note } : {}) }).where(eq(R.id, reservationId));
        for (const p of picked) {
          // The name held instead takes their channel first; then theirs ends.
          if (p.suggestion) await holdInstead(tx, p.row.reservation, p.suggestion, `Held in place of ${view!.callSign}, which went to someone else`);
          await releaseRow(tx, p.row.reservation.id, "not_kept", user.id, { decision: "not_kept", decidedAt: now, decidedBy: user.id, suggested: p.suggestion ? [p.suggestion] : null, ...(note ? { note } : {}) });
        }
      });
      for (const p of picked) {
        await tell(p.row.email, {
          title: `${view!.callSign} went to someone else`,
          body:
            `Two people asked for ${view!.callSign}, and Opencast's team gave it to the other.` +
            (p.suggestion ? ` We've held ${p.suggestion} for you instead, in the same place in line.\n\nYou can choose another call sign when you set up your station.` : " You can reserve another on the waitlist."),
          ...(p.suggestion ? {} : { link: deps.config.appOrigin, action: "Open Opencast" })
        });
      }
      return { kept: await viewOf(reservationId), told: picked.map((p) => ({ reservationId: p.row.reservation.id, email: p.row.email, suggestion: p.suggestion })) };
    },

    async suggest(user, reservationId, input) {
      const row = await activeRow(reservationId);
      await need(user, row.reservation.marketId);
      const [view] = await views([row]);
      if (!view!.refusal) throw refused("allowed", `${view!.callSign} is allowed: there's nothing to suggest.`);
      await requireFree(input.callSign);
      const refusedRules = await rules();
      const taken = await heldNames(input.alternatives ?? []);
      const onStations = await services.stations.takenCallSigns(input.alternatives ?? []);
      const alternatives = [...new Set(input.alternatives ?? [])].filter((a) => a !== input.callSign && !callSignRefusal(a, refusedRules) && !taken.has(a) && !onStations.has(a)).slice(0, 3);
      const note = input.note?.trim() || null;
      const replacement = await db.transaction(async (tx) => {
        const held = await holdInstead(tx, row.reservation, input.callSign, `Held in place of ${view!.callSign}, which isn't allowed`);
        await releaseRow(tx, reservationId, "refused", user.id, { suggested: [input.callSign, ...alternatives], ...(note ? { note } : {}) });
        return held;
      });
      const others = alternatives.length === 1 ? `${alternatives[0]} is free too, if you'd rather.` : alternatives.length ? `${alternatives.slice(0, -1).join(", ")} and ${alternatives.at(-1)} are free too, if you'd rather.` : "";
      await tell(row.email, {
        title: `${view!.callSign} isn't allowed`,
        body: `${view!.refusal!.reason} We've held ${input.callSign} for you instead, in the same place in line.${others ? ` ${others}` : ""}\n\nYou can choose another call sign when you set up your station.`
      });
      return viewOf(replacement.id);
    },

    async invitePreview(reservationId, user) {
      const row = await inviteRow(reservationId);
      const r = row.reservation;
      const [h] = await db.select().from(H).where(and(eq(H.reservationId, r.id), isNull(H.releasedAt)));
      // The channel's market is the one to set up in; else the reservation's.
      const marketId = h?.marketId ?? r.marketId;
      const market = marketId ? ((await services.network.marketsByIds([marketId])).get(marketId) ?? null) : null;
      const emails = user ? await services.accounts.verifiedEmails(user) : [];
      const yours = !!user && !!r.stationId && (await services.accounts.stationRole(user, r.stationId)) !== null;
      return {
        id: r.id,
        callSign: r.callSign,
        market,
        band: h?.band ?? null,
        channel: h ? formatChannelNumber({ band: h.band, tenths: h.tenths }) : null,
        heldUntil: r.heldUntil?.toISOString() ?? null,
        state: inviteState(r),
        emailHint: row.email ? maskEmail(row.email) : null,
        signedInAs: user ? (emails[0] ?? null) : null,
        emailMatches: user && row.email && deps.config.inviteEmailMatch !== false ? emails.includes(row.email.toLowerCase()) : null,
        stationId: yours ? r.stationId : null
      };
    },

    async inviteFor(user, reservationId) {
      const row = await inviteRow(reservationId);
      const r = row.reservation;
      const state = inviteState(r);
      if (state === "ended") throw refused("reservation_ended", `This invite has ended: ${r.callSign} isn't held for you any more. If it's still free, you can reserve it again on the waitlist.`);
      if (state !== "open") throw conflict("reservation_used", `A station is already being set up as ${r.callSign}.`);
      // Only the person it's for: the team invites' check (INVITE_EMAIL_MATCH, on by default).
      if (row.email && deps.config.inviteEmailMatch !== false) {
        const emails = await services.accounts.verifiedEmails(user);
        if (!emails.includes(row.email.toLowerCase())) {
          const hint = maskEmail(row.email);
          throw new HttpError(403, "reservation_email_mismatch", `This invite is for ${hint}; you're signed in as ${emails[0] ?? "an account with no email"}. Sign in with ${hint} to use it.`);
        }
      }
      await service.requireAllowed(r.callSign);
      const others = await db
        .select({ id: R.id })
        .from(R)
        .where(and(eq(R.callSign, r.callSign), isNull(R.releasedAt), ne(R.id, r.id)));
      if (others.length && r.decision !== "kept") throw conflict("call_sign_undecided", `Someone else asked for ${r.callSign} too. Opencast's team is deciding who keeps it, and will write to you.`);
      const [h] = await db.select().from(H).where(and(eq(H.reservationId, r.id), isNull(H.releasedAt)));
      return { callSign: r.callSign, channel: h ? { marketId: h.marketId, band: h.band, tenths: h.tenths } : null };
    },

    async tieToStation(tx, reservationId, stationId) {
      const [tied] = await tx
        .update(R)
        .set({ stationId })
        .where(and(eq(R.id, reservationId), isNull(R.stationId), isNull(R.releasedAt)))
        .returning({ callSign: R.callSign });
      if (!tied) throw conflict("reservation_used", "A station is already being set up with this invite.");
    },

    async releaseOtherChannels(tx, stationId, keep) {
      const held = await tx
        .select({ id: H.id, marketId: H.marketId, band: H.band, tenths: H.tenths })
        .from(H)
        .innerJoin(R, eq(R.id, H.reservationId))
        .where(and(eq(R.stationId, stationId), isNull(H.releasedAt)));
      const other = held.filter((h) => !(h.marketId === keep.marketId && h.band === keep.band && h.tenths === keep.tenths));
      if (!other.length) return;
      await tx
        .update(H)
        .set({ releasedAt: deps.clock.now() })
        .where(inArray(H.id, other.map((h) => h.id)));
    },

    async sweep() {
      const now = deps.clock.now();
      const { reminderDays } = await hold();
      // Signed on: the station has the call sign for good, so the hold is done.
      const withStation = await db
        .select({ id: R.id, stationId: R.stationId })
        .from(R)
        .where(and(isNull(R.releasedAt), eq(R.reason, "waitlist"), isNotNull(R.stationId)));
      const profiles = await services.stations.profiles(withStation.map((r) => r.stationId!));
      let signedOn = 0;
      for (const r of withStation) {
        if (!profiles.get(r.stationId!)?.firstSignedOnAt) continue;
        await db.update(R).set({ releasedAt: now, releaseReason: "signed_on" }).where(eq(R.id, r.id));
        signedOn++;
      }
      // Ended: released, with their channel; the person is told.
      const ended = await rowsWhere(and(isNull(R.releasedAt), lte(R.heldUntil, now)));
      for (const row of ended) {
        await db.transaction((tx) => releaseRow(tx, row.reservation.id, "expired", null));
        if (row.reservation.reason === "waitlist") {
          await tell(row.email, {
            title: `Your hold on ${row.reservation.callSign} has ended`,
            body: `${row.reservation.callSign} was held for you until ${dateWords(row.reservation.heldUntil!, await timezoneOf(row.reservation.marketId))}. If it's still free, you can reserve it again on the waitlist.`,
            link: deps.config.appOrigin,
            action: "Open Opencast",
            key: `hold-ended-${row.reservation.id}`
          });
        }
      }
      // Ending soon: one reminder each.
      const soon = await rowsWhere(and(isNull(R.releasedAt), eq(R.reason, "waitlist"), isNull(R.remindedAt), lte(R.heldUntil, new Date(now.getTime() + reminderDays * DAY))));
      let reminded = 0;
      for (const row of soon) {
        if (!row.email) continue;
        const until = dateWords(row.reservation.heldUntil!, await timezoneOf(row.reservation.marketId));
        await tell(row.email, {
          title: `${row.reservation.callSign} is held until ${until}`,
          body: `Your hold on ${row.reservation.callSign} ends on ${until}. Set up your station before then to keep it. After that, anyone can reserve it.`,
          key: `hold-reminder-${row.reservation.id}-${row.reservation.heldUntil!.getTime()}`
        });
        await db.update(R).set({ remindedAt: now }).where(eq(R.id, row.reservation.id));
        reminded++;
      }
      return { reminded, expired: ended.length, signedOn };
    }
  };

  /** A waitlist reservation and its signup's email, by id, for the invite's link; 404 for anything else. */
  async function inviteRow(reservationId: string) {
    const [row] = await db.select({ reservation: R, email: W.email }).from(R).leftJoin(W, eq(W.id, R.signupId)).where(eq(R.id, reservationId));
    if (!row || row.reservation.reason !== "waitlist") throw notFound("That invite");
    return row;
  }

  /** Where the invite's link stands: its station signed on, a station is being set up with it, it ended, or it's open. */
  function inviteState(r: typeof R.$inferSelect): ReservationInvite["state"] {
    if (r.releaseReason === "signed_on") return "signed_on";
    const ended = !!r.releasedAt || (!!r.heldUntil && r.heldUntil.getTime() <= deps.clock.now().getTime());
    if (r.stationId && !r.releasedAt) return "setting_up";
    return ended ? "ended" : "open";
  }

  /** Waiting for an invite and able to have one. */
  function invitable(r: Reservation) {
    return r.reason === "waitlist" && !r.invitedAt && !r.stationId && !r.refusal && !r.sameName.length && !!r.email;
  }

  return service;
}
