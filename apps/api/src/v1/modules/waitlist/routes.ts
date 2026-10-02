import { waitlistApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

export function waitlistRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { waitlist } = services;

  r.handle(api.join, ({ body }) => waitlist.join(body));
  // Signed in (2026-09-29), a name held for you is available to you.
  r.handle(api.checkCallSign, ({ params, user }) => waitlist.check(params.callSign, user?.id ?? null));
  // A market lead (added 2026-09-29) sees their own market's; the whole list is admins only.
  r.handle(api.listReservations, async ({ user, query }) => {
    await services.settings.requireDesk(user, query.marketId ? { market: query.marketId } : "admin");
    return waitlist.reservations(query.marketId);
  });
  r.handle(api.holdChannel, async ({ params, body }) => {
    await waitlist.holdChannel(params.reservationId, body);
    return { ok: true as const };
  });
  r.handle(api.listSignups, ({ query }) => waitlist.signups(query));
  // The invite's link (added 2026-09-29): anyone with it reads it; signed in, it says whether it's theirs.
  r.handle(api.getReservationInvite, ({ params, user }) => waitlist.invitePreview(params.reservationId, user ?? null));

  // Reserved call signs on the desk (added 2026-09-29, desk-pages 02): each checks the desk role
  // for the reservation's market.
  r.handle(api.reservationsOverview, ({ user, query }) => waitlist.overview(user, query.marketId));
  r.handle(api.callSignSuggestions, async ({ params }) => {
    const callSign = params.callSign.toUpperCase();
    const check = await waitlist.check(callSign, null);
    return { callSign, refusal: check.refusal, suggestions: await waitlist.suggestionsFor(callSign) };
  });
  r.handle(api.inviteReservation, ({ user, params }) => waitlist.invite(user, params.reservationId));
  r.handle(api.inviteNextReservations, ({ user, body }) => waitlist.inviteNext(user, body.marketId, body.count));
  r.handle(api.extendReservation, ({ user, params, body }) => waitlist.extend(user, params.reservationId, body?.note));
  r.handle(api.releaseReservation, ({ user, params, body }) => waitlist.release(user, params.reservationId, body?.note));
  r.handle(api.decideReservation, ({ user, params, body }) => waitlist.decide(user, params.reservationId, body ?? {}));
  r.handle(api.suggestCallSign, ({ user, params, body }) => waitlist.suggest(user, params.reservationId, body));
}
