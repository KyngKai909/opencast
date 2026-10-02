import { createHash } from "node:crypto";
import { tvApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import { clientIp } from "../../geo.js";
import type { RouteRegistrar } from "../../http.js";

export function tvRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const tv = services.tv;
  const ok = { ok: true as const };

  // Devices and sign-in by code
  r.handle(api.registerTv, ({ body }) => tv.register(body));
  r.handle(api.createTvCode, ({ device }) => tv.createCode(device.tvId));
  r.handle(api.pollTvCode, ({ params }) => tv.pollCode(params.pollToken));
  r.handle(api.approveTvCode, ({ user, params }) => tv.approveCode(user, params.code));
  r.handle(api.signOutThisTv, async ({ device }) => {
    await tv.signOutDevice(device.tvId);
    return ok;
  });

  // TVs on the account
  r.handle(api.listTvs, ({ user }) => tv.listTvs(user.id));
  r.handle(api.signOutTv, ({ user, params }) => tv.signOutTv(user.id, params.tvId));
  r.handle(api.recordCastTarget, ({ user, body }) => tv.recordCastTarget(user.id, body));

  // The relay: the TV's side
  r.stream(api.tvRemoteEvents, async ({ device }, open) => {
    await tv.remote.openTvStream(device.tvId, open());
  });
  r.handle(api.postRemoteState, async ({ device, body }) => {
    await tv.remote.postState(device.tvId, body);
    return ok;
  });
  r.handle(api.endRemote, async ({ device }) => {
    await tv.remote.end(device.tvId);
    return ok;
  });
  r.handle(api.createPairCode, ({ device }) => tv.remote.createPairCode(device.tvId));
  r.handle(api.listRemotePhones, ({ device }) => tv.remote.phones(device.tvId));
  r.handle(api.removeRemotePhone, ({ device, params }) => tv.remote.removePhone(device.tvId, params.phoneId));

  // The relay: a phone's side
  r.handle(api.pairPhone, ({ user, body, req }) => {
    // Wrong codes are limited per person, or per connection for a phone that isn't signed in.
    // The address is only hashed, and the hash is kept for an hour at most.
    const ip = clientIp(req) ?? "unknown";
    const clientKey = user && !user.viaTv ? `user:${user.id}` : `ip:${createHash("sha256").update(`opencast-pair:${ip}`).digest("hex")}`;
    return tv.remote.pair({ code: body.code, name: body.name, user, clientKey });
  });
  r.stream(api.phoneRemoteEvents, async ({ user, phone, params }, open) => {
    const driver = await tv.remote.authorize({ user, phone }, params.tvId);
    await tv.remote.openPhoneStream(driver, open());
  });
  r.handle(api.sendRemoteCommand, async ({ user, phone, params, body }) => {
    const driver = await tv.remote.authorize({ user, phone }, params.tvId);
    await tv.remote.sendCommand(driver, body.command, body.name);
    return ok;
  });
}
