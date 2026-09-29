import { accountsApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

export function accountsRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const accounts = services.accounts;

  r.handle(api.getMe, ({ user }) => accounts.me(user.id));
  r.handle(api.updateMe, ({ user, body }) => accounts.updateMe(user.id, body));
  r.handle(api.linkClear, ({ user }) => accounts.linkClear(user));
  r.handle(api.unlinkClear, async ({ user }) => {
    await accounts.unlinkClear(user.id);
    return { ok: true as const };
  });
  r.handle(api.mergeDevice, async ({ user, body }) => {
    // The account's own presets win; the device's fill the rest.
    const existing = await accounts.presets(user.id);
    const have = new Set(existing.map((p) => p.station.id));
    const takenKeys = new Set(existing.map((p) => p.key).filter((k) => k !== null));
    for (const preset of body.presets) {
      if (have.has(preset.stationId)) continue;
      const key = preset.key !== null && !takenKeys.has(preset.key) ? preset.key : null;
      await accounts.savePreset(user.id, { stationId: preset.stationId, key });
      if (key !== null) takenKeys.add(key);
    }
    for (const reminder of body.reminders) {
      await accounts.addReminder(user.id, reminder).catch(() => undefined);
    }
    return { presets: await accounts.presets(user.id), reminders: await accounts.reminders(user.id) };
  });

  r.handle(api.listPresets, ({ user }) => accounts.presets(user.id));
  r.handle(api.savePreset, async ({ user, body }) => {
    await accounts.savePreset(user.id, body);
    return accounts.presets(user.id);
  });
  r.handle(api.reorderPresets, async ({ user, body }) => {
    await accounts.reorderPresets(user.id, body);
    return accounts.presets(user.id);
  });
  r.handle(api.removePreset, async ({ user, params }) => {
    await accounts.removePreset(user.id, params.stationId);
    return accounts.presets(user.id);
  });
  r.handle(api.suggestPresetKey, async ({ user }) => ({ key: await accounts.suggestPresetKey(user.id) }));
  r.handle(api.usePresetKey, async ({ user, params }) => {
    await accounts.usePresetKey(user.id, params.key);
    return { ok: true as const };
  });

  r.handle(api.listReminders, ({ user }) => accounts.reminders(user.id));
  r.handle(api.addReminder, ({ user, body }) => accounts.addReminder(user.id, body));
  r.handle(api.updateReminder, ({ user, params, body }) => accounts.updateReminder(user.id, params.reminderId, body.switchMeOver));
  r.handle(api.removeReminder, async ({ user, params }) => {
    await accounts.removeReminder(user.id, params.reminderId);
    return { ok: true as const };
  });

  r.handle(api.getStationTeam, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, ["owner", "operator"]);
    return accounts.team({ kind: "station", id: params.stationId });
  });
  r.handle(api.inviteToStation, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    return accounts.invite(user, { kind: "station", id: params.stationId }, body);
  });
  r.handle(api.updateStationMember, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    await accounts.updateMember({ kind: "station", id: params.stationId }, params.userId, body);
    return accounts.team({ kind: "station", id: params.stationId });
  });
  r.handle(api.removeStationMember, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    await accounts.removeMember({ kind: "station", id: params.stationId }, params.userId);
    return accounts.team({ kind: "station", id: params.stationId });
  });
  r.handle(api.transferStationOwnership, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    await accounts.transferStationOwnership(params.stationId, user.id, body.toUserId);
    return accounts.team({ kind: "station", id: params.stationId });
  });

  r.handle(api.getBusinessTeam, async ({ user, params }) => {
    await accounts.requireBusiness(user, params.businessId, ["owner", "manager", "viewer"]);
    return accounts.team({ kind: "business", id: params.businessId });
  });
  r.handle(api.inviteToBusiness, async ({ user, params, body }) => {
    await accounts.requireBusiness(user, params.businessId, ["owner"]);
    return accounts.invite(user, { kind: "business", id: params.businessId }, body);
  });
  r.handle(api.updateBusinessMember, async ({ user, params, body }) => {
    await accounts.requireBusiness(user, params.businessId, ["owner"]);
    await accounts.updateMember({ kind: "business", id: params.businessId }, params.userId, body);
    return accounts.team({ kind: "business", id: params.businessId });
  });
  r.handle(api.removeBusinessMember, async ({ user, params }) => {
    await accounts.requireBusiness(user, params.businessId, ["owner"]);
    await accounts.removeMember({ kind: "business", id: params.businessId }, params.userId);
    return accounts.team({ kind: "business", id: params.businessId });
  });

  // A1, A2, A3, A6 (added 2026-09-28)
  r.handle(api.signOutEverywhere, async ({ user }) => {
    await accounts.signOutEverywhere(user.id);
    return { ok: true as const };
  });
  r.handle(api.getWatchHistory, ({ user }) => accounts.watchHistory(user.id));
  r.handle(api.clearWatchHistory, async ({ user }) => {
    await accounts.clearWatchHistory(user.id);
    return { ok: true as const };
  });
  r.handle(api.exportData, ({ user }) => accounts.exportData(user.id));
  r.handle(api.downloadData, ({ user }) => accounts.downloadData(user.id));
  r.handle(api.deleteAccount, async ({ user }) => {
    await accounts.deleteAccount(user.id);
    return { ok: true as const };
  });
  r.handle(api.listOpencastTeam, () => accounts.opencastTeam());
  // A5: the station switcher.
  r.handle(api.myStationStatus, ({ user }) => accounts.stationStatus(user.id));

  r.handle(api.resendInvite, ({ user, params }) => accounts.resendInvite(user, params.inviteId));
  r.handle(api.acceptInvite, async ({ user, params }) => {
    await accounts.acceptInvite(user, params.inviteId);
    return accounts.me(user.id);
  });
}
