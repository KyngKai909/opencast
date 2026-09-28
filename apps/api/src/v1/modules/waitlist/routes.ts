import { waitlistApi as api } from "@opencast/contracts";
import { isValidCallSign } from "@opencast/domain";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

export function waitlistRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { waitlist } = services;

  r.handle(api.join, ({ body }) => waitlist.join(body));
  r.handle(api.checkCallSign, async ({ params }) => {
    const callSign = params.callSign.toUpperCase();
    return { callSign, valid: isValidCallSign(callSign), available: await waitlist.isAvailable(callSign) };
  });
  r.handle(api.listReservations, ({ query }) => waitlist.reservations(query.marketId));
  r.handle(api.holdChannel, async ({ params, body }) => {
    await waitlist.holdChannel(params.reservationId, body);
    return { ok: true as const };
  });
  r.handle(api.listSignups, ({ query }) => waitlist.signups(query));
}
