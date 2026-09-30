// Setup (A.1): starting a station, the market's channels, choosing one, and whether a call sign
// is free; a waitlist invite's link, and starting a station from it (added 2026-09-29). Sign-on, sign off and cue a break are with the log in log.ts. The On air area owns
// this file.

import { http } from "msw";
import { CALL_SIGN_RULES_DEFAULT, callSignIdeas, callSignRefusal, stationsApi, waitlistApi, type ReservationInvite, type StationIdent } from "@opencast/contracts";
import { contrastRatio, ratioLabel, stationColourPasses } from "@opencast/ui";
import { now } from "../../../lib/clock";
import { dbStation, getDb, membership, saveDb, stationLog, type DbStation } from "../db";
import type { DbLogEntry } from "../fixtures/evening";
import { stationState } from "../fixtures/station";
import { HELD, MOCK_STREAMS, TV_CHANNELS, mockReservations, radioFrequencies, saveReservations, type MockReservation } from "../fixtures/onair";
import type { MockPerson } from "../fixtures/people";
import { MARKET, STATIONS } from "../fixtures/stations";
import { fail, needsUser, path, personOf, reply } from "../respond";
import { maskEmail } from "./station";

/** Every station the dial knows: the shared db's, and the market's others (listed, carried). */
function allIdents(): StationIdent[] {
  const ours = getDb().stations.map((s) => s.ident);
  return [...ours, ...STATIONS.filter((s) => !ours.some((o) => o.id === s.id))];
}

/** Channels in a market and band: open, taken by a station, or held for a reserved call sign. */
export function channelsFor(band: "tv" | "radio", marketSlug = MARKET.slug) {
  const numbers = band === "tv" ? Array.from({ length: TV_CHANNELS.last - TV_CHANNELS.first + 1 }, (_, i) => `${TV_CHANNELS.first + i}.1`) : radioFrequencies();
  const taken = new Set(allIdents().filter((s) => s.marketSlug === marketSlug && s.band === band && s.channel).map((s) => (band === "tv" ? `${s.channel!.split(".")[0]}.1` : s.channel!)));
  // And the channels held with waitlist call signs that are still held.
  const held = new Set([...HELD[band], ...mockReservations().flatMap((r) => (!r.releasedAt && r.band === band && r.channel ? [r.channel] : []))]);
  return numbers.map((channel) => ({ channel, state: taken.has(channel) ? ("taken" as const) : held.has(channel) ? ("held" as const) : ("open" as const) }));
}

/** Where an invite's link stands, as the API says it. */
function inviteState(r: MockReservation): ReservationInvite["state"] {
  if (r.signedOn) return "signed_on";
  if (r.stationId && !r.releasedAt) return "setting_up";
  return r.releasedAt || Date.parse(r.heldUntil) <= now().getTime() ? "ended" : "open";
}

function reservationInvite(r: MockReservation, p: MockPerson | null): ReservationInvite {
  return {
    id: r.id,
    callSign: r.callSign,
    market: { ...MARKET, open: true },
    band: r.channel ? r.band : null,
    channel: r.channel,
    heldUntil: r.heldUntil,
    state: inviteState(r),
    emailHint: maskEmail(r.email),
    signedInAs: p?.email ?? null,
    emailMatches: p ? p.email === r.email : null,
    stationId: p && r.stationId && membership(r.stationId, p.id) ? r.stationId : null
  };
}

function setupOf(st: DbStation) {
  return { station: st.ident, ...st.setup };
}

function airing(e: DbLogEntry) {
  return { logEntryId: e.id, title: e.title, episodeTitle: e.episodeTitle, code: e.code, kind: e.kind, startsAt: e.startsAt, endsAt: e.endsAt, live: e.kind === "live", carriedFrom: e.carriedFrom, programId: e.programId };
}

export const onairHandlers = [
  // A station page. Master control reads it for a claimable station's "Run by Opencast" (rights 05.2).
  http.get(path(stationsApi.getStation), ({ params }) => {
    const ref = String(params.stationRef).toLowerCase();
    const ident = allIdents().find((s) => s.id === ref || s.callSign?.toLowerCase() === ref || s.handle === ref);
    if (!ident) return fail(404, "not_found", "That station wasn't found.");
    const st = dbStation(ident.id);
    const t = now().toISOString();
    const log = st ? stationLog(ident.id).filter((e) => e.endsAt > t) : [];
    const onNow = log.find((e) => e.startsAt <= t) ?? null;
    const onAir = !!st?.onAir && onNow?.kind !== "off_air";
    const slug = (ident.callSign ?? ident.handle ?? "").toLowerCase();
    // Who a claimable station is run for: the creator named on its claim (the Station area's handover).
    const token = stationState().claimTokens.find((c) => c.stationId === ident.id);
    const claimed = stationState().handovers.some((h) => h.stationId === ident.id && h.kind === "claim" && h.status === "completed");
    return reply(stationsApi.getStation.response, {
      station: ident,
      description: st?.setup.description ?? null,
      onAir,
      now: onAir && onNow ? airing(onNow) : null,
      upNext: log.filter((e) => e !== onNow).slice(0, 3).map(airing),
      programs: getDb().library.programs.filter((p) => p.station.id === ident.id).map((p) => ({ id: p.id, title: p.title, description: p.description, live: p.live })),
      claimable: ident.kind === "claimable" || token ? { runFor: token?.page.personName ?? "its creator", claimed: claimed || ident.kind !== "claimable", escrowContract: token?.page.escrowContract ?? null, escrowStationId: token?.page.escrowStationId ?? 0 } : null,
      pledgesTaxDeductible: st?.setup.pledgesTaxDeductible ?? null,
      playback: onAir && MOCK_STREAMS.includes(slug) ? { kind: "hls" as const, url: `/mock-hls/${slug}/master.m3u8` } : null
    });
  }),

  http.get(path(stationsApi.listMarkets), () => reply(stationsApi.listMarkets.response, [{ ...MARKET, open: true }])),

  http.get(path(waitlistApi.checkCallSign), ({ params }) => {
    const callSign = String(params.callSign).toUpperCase();
    const valid = /^[A-Z]{3,5}$/.test(callSign);
    // Names Opencast won't allow (2026-09-29), with the registry's first rules.
    const refusal = valid ? callSignRefusal(callSign, CALL_SIGN_RULES_DEFAULT) : null;
    const taken = (cs: string) => allIdents().some((s) => s.callSign === cs);
    const available = valid && !refusal && !taken(callSign);
    const suggestions = valid && !available ? callSignIdeas(callSign).filter((i) => !taken(i) && !callSignRefusal(i, CALL_SIGN_RULES_DEFAULT)).slice(0, 3) : [];
    return reply(waitlistApi.checkCallSign.response, { callSign, valid, available, reservable: available, heldForYou: false, refusal, suggestions });
  }),

  // A waitlist invite's link: anyone with it reads it.
  http.get(path(waitlistApi.getReservationInvite), ({ request, params }) => {
    const r = mockReservations().find((x) => x.id === String(params.reservationId));
    if (!r) return fail(404, "not_found", "That invite wasn't found.");
    return reply(waitlistApi.getReservationInvite.response, reservationInvite(r, personOf(request)));
  }),

  http.post(path(stationsApi.createStation), async ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const body = stationsApi.createStation.body.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "bad_request", "A station needs a name.");
    const { kind, name, description, colour, handle, reservationId } = body.data;
    if (colour && !stationColourPasses(colour)) return fail(422, "colour", `White text on it reads at ${ratioLabel(contrastRatio(colour, "#FFFFFF"))}. A station colour needs 4.5:1.`);
    // From a waitlist invite: only the person it's for, while it's held, once.
    const reservation = reservationId ? mockReservations().find((r) => r.id === reservationId) : undefined;
    if (reservationId) {
      if (!reservation) return fail(404, "not_found", "That invite wasn't found.");
      if (kind === "studio") return fail(422, "studio", "A studio has a handle, not a call sign.");
      const state = inviteState(reservation);
      if (state === "ended") return fail(422, "reservation_ended", `This invite has ended: ${reservation.callSign} isn't held for you any more. If it's still free, you can reserve it again on the waitlist.`);
      if (state !== "open") return fail(409, "reservation_used", `A station is already being set up as ${reservation.callSign}.`);
      if (reservation.email !== p.email) {
        const hint = maskEmail(reservation.email);
        return fail(403, "reservation_email_mismatch", `This invite is for ${hint}; you're signed in as ${p.email}. Sign in with ${hint} to use it.`);
      }
    }
    const id = crypto.randomUUID();
    const t = now().toISOString();
    const st: DbStation = {
      ident: {
        id,
        kind,
        callSign: reservation?.callSign ?? null,
        handle: handle ?? null,
        name,
        colour: colour ?? null,
        band: reservation?.channel ? reservation.band : null,
        channel: reservation?.channel ?? null,
        marketSlug: kind === "studio" ? null : MARKET.slug,
        homeCity: null
      },
      setup: {
        description: description ?? null,
        status: "setting_up",
        firstSignedOnAt: null,
        fixed: false,
        bug: { mode: "call_sign_and_channel", position: "bottom_right", opacity: 78 },
        logoUrl: null,
        category: null,
        studioLocation: null,
        legalName: null,
        legalContact: null,
        pledgesTaxDeductible: null,
        memberCreditStyle: "text",
        orders: { takesOrders: false, turnaround: null, fromMicros: null }
      },
      onAir: false,
      onAirSince: null
    };
    const db = getDb();
    db.stations.push(st);
    // The creator becomes the owner.
    db.members.push({ stationId: id, personId: p.id, role: "owner", hosts: null, hostProgramIds: [], lastInAt: t });
    saveDb();
    if (reservation) {
      reservation.stationId = id;
      saveReservations();
    }
    return reply(stationsApi.createStation.response, setupOf(st), 201);
  }),

  http.get(path(stationsApi.availableChannels), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const slug = String(params.marketSlug);
    if (slug !== MARKET.slug) return fail(404, "not_found", "That market wasn't found.");
    const band = new URL(request.url).searchParams.get("band") === "radio" ? "radio" : "tv";
    return reply(stationsApi.availableChannels.response, { market: { ...MARKET, open: true }, band, channels: channelsFor(band, slug) });
  }),

  http.put(path(stationsApi.chooseChannel), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const st = dbStation(String(params.stationId));
    if (!st) return fail(404, "not_found", "That station wasn't found.");
    if (membership(st.ident.id, p.id)?.role !== "owner") return fail(403, "forbidden", "Only an owner can choose the channel.");
    if (st.setup.fixed) return fail(409, "fixed", "Call sign, channel, band and market are fixed after the first sign-on.");
    const body = stationsApi.chooseChannel.body.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "bad_request", "Choose a channel.");
    const { band, channel, marketId } = body.data;
    if (marketId !== MARKET.id) return fail(404, "not_found", "That market wasn't found.");
    const state = channelsFor(band).find((c) => c.channel === channel)?.state;
    // The channel held with the station's waitlist call sign is its to choose.
    const held = mockReservations().find((r) => r.stationId === st.ident.id && !r.releasedAt && r.channel);
    const mine = (st.ident.band === band && st.ident.channel === channel) || (held?.band === band && held.channel === channel);
    if (!state) return fail(422, "channel", `${channel} isn't a channel on the ${band === "tv" ? "TV" : "radio"} band here.`);
    if (state !== "open" && !mine) return fail(409, "channel_taken", `${channel} is taken. Choose another channel.`);
    st.ident = { ...st.ident, band, channel, marketSlug: MARKET.slug };
    saveDb();
    // Another than the one held: the held one goes.
    if (held && (held.band !== band || held.channel !== channel)) {
      held.channel = null;
      held.band = null;
      saveReservations();
    }
    return reply(stationsApi.chooseChannel.response, setupOf(st));
  })
];
