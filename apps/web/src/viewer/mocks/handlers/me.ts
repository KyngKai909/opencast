// The signed-in person: me, presets, reminders, pledges, notification settings, and the proposed
// endpoints in api/ext/you.ts (E1, A1, A2, A3). TVs and the remote relay are in tvs.ts.

import { http } from "msw";
import { accountsApi, audienceApi, ledgerApi, notificationsApi, stationsApi } from "@opencast/contracts";
import { now } from "../../../lib/clock";
import { accountApiX, PledgesX, PledgeX, pledgesApiX } from "../../api/ext/you";
import { lowestFreeKey, normalise, placePreset, removePresetFrom, type KeyedPreset } from "../../components/you/presetRules";
import { getDb, profileOf, resetDb, saveDb, type DbPledge, type DbPreset } from "../db";
import { meHandler, meView } from "../../../mocks/me";
import { AIRINGS, airingById } from "../fixtures/schedule";
import { STATIONS, stationById, uid } from "../fixtures/stations";
import { channelsFor, nextChargeFor, receiptsFor } from "../fixtures/you";
import { fail, needsUser, path, personOf, reply } from "../respond";
import { marketOf } from "../view";

const ident = (id: string) => stationById(id)!.ident;

function presetsView() {
  return [...getDb().presets].sort((a, b) => a.position - b.position).map((p) => ({ station: ident(p.stationId), key: p.key, position: p.position }));
}

/** Writes a list from the preset rules back to the db, positions in order. */
function setPresets(list: KeyedPreset[]) {
  getDb().presets = normalise(list).map((p, i): DbPreset => ({ stationId: p.stationId, key: p.key, position: i }));
  saveDb();
}

function reminderView(r: { id: string; airingId: string; switchMeOver: boolean; createdAt: string }) {
  const a = airingById(r.airingId)!;
  return {
    id: r.id,
    switchMeOver: r.switchMeOver,
    airing: { title: a.title, startsAt: a.start, station: ident(a.stationId), listed: !!a.listed, logEntryId: a.listed ? null : a.id, listedAiringId: a.listed ? a.id : null },
    createdAt: r.createdAt
  };
}

export function pledgeView(p: DbPledge): PledgeX {
  const items = receiptsFor(p, now());
  return {
    id: p.id,
    station: ident(p.stationId),
    cadence: p.cadence,
    amountMicros: p.amountMicros,
    creditOnAir: p.creditOnAir,
    startedAt: p.startedAt,
    nextChargeOn: nextChargeFor(p, now()),
    endsAfter: p.endsAfter,
    card: { label: p.card, expired: false },
    receipts: { count: items.length, totalMicros: items.reduce((s, r) => s + r.amountMicros, 0), items }
  };
}

/** The last day of the month a stopped pledge was last charged in: it ends after that month. */
export function endOfThisMonth(t: Date): string {
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

export const meHandlers = [
  // Who am I: the one answer for every area (src/mocks/me.ts).
  meHandler,

  http.patch(path(accountsApi.updateMe), async ({ request }) => {
    const p = personOf(request);
    if (!p) return fail(401, "unauthorized", "Sign in to do that.");
    const body = (await request.json()) as { displayName?: string | null; marketId?: string | null; settings?: Record<string, unknown> };
    const me = profileOf(p);
    if (body.displayName !== undefined) me.displayName = body.displayName;
    if (body.marketId !== undefined) me.marketSlug = body.marketId ? (["inland-empire", "los-angeles", "high-desert"].find((s) => marketOf(s)?.id === body.marketId) ?? me.marketSlug) : null;
    if (body.settings) {
      const cur = me.settings as Record<string, Record<string, unknown> | undefined>;
      for (const [k, v] of Object.entries(body.settings)) cur[k] = typeof v === "object" && v ? { ...(cur[k] ?? {}), ...(v as object) } : (v as never);
    }
    saveDb();
    return reply(accountsApi.updateMe.response, meView(p));
  }),

  // ---------- Presets ----------
  http.get(path(accountsApi.listPresets), ({ request }) => needsUser(request) ?? reply(accountsApi.listPresets.response, presetsView())),

  http.post(path(accountsApi.savePreset), async ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const { stationId, key } = (await request.json()) as { stationId: string; key: number | null };
    if (!stationById(stationId)) return fail(404, "not_found", "That station wasn't found.");
    // A key that's taken moves its station to More presets, never deleted.
    setPresets(placePreset(getDb().presets, stationId, key));
    return reply(accountsApi.savePreset.response, presetsView(), 201);
  }),

  http.put(path(accountsApi.reorderPresets), async ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const body = (await request.json()) as Array<{ stationId: string; key: number | null }>;
    const keys = body.map((p) => p.key).filter((k) => k !== null);
    if (new Set(keys).size !== keys.length) return fail(400, "bad_request", "Two presets can't share a key.");
    if (body.some((p) => !stationById(p.stationId))) return fail(404, "not_found", "That station wasn't found.");
    setPresets(body);
    return reply(accountsApi.reorderPresets.response, presetsView());
  }),

  http.delete(path(accountsApi.removePreset), ({ request, params }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    setPresets(removePresetFrom(getDb().presets, String(params.stationId)));
    return reply(accountsApi.removePreset.response, presetsView());
  }),

  http.get(path(accountsApi.suggestPresetKey), ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    // The key used least in the last month: the mock says key 6, as the reference does; null
    // while a key is free (nothing needs replacing).
    const full = lowestFreeKey(getDb().presets) === null;
    return reply(accountsApi.suggestPresetKey.response, { key: full ? 6 : null });
  }),

  http.post(path(accountsApi.usePresetKey), ({ request }) => needsUser(request) ?? reply(accountsApi.usePresetKey.response, { ok: true })),

  // ---------- Reminders ----------
  http.get(path(accountsApi.listReminders), ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const t = now().toISOString();
    const list = getDb().reminders.filter((r) => (airingById(r.airingId)?.end ?? "") > t).sort((a, b) => airingById(a.airingId)!.start.localeCompare(airingById(b.airingId)!.start));
    return reply(accountsApi.listReminders.response, list.map(reminderView));
  }),

  http.post(path(accountsApi.addReminder), async ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const body = (await request.json()) as { logEntryId?: string; listedAiringId?: string; switchMeOver?: boolean };
    const airingId = body.logEntryId ?? body.listedAiringId;
    if (!airingId || !airingById(airingId)) return fail(404, "not_found", "That airing wasn't found.");
    const db = getDb();
    const existing = db.reminders.find((r) => r.airingId === airingId);
    const r = existing ?? { id: uid(50000 + db.reminders.length + Math.floor(Math.random() * 40000)), airingId, switchMeOver: !!body.switchMeOver, createdAt: now().toISOString() };
    if (!existing) db.reminders.push(r);
    saveDb();
    return reply(accountsApi.addReminder.response, reminderView(r), 201);
  }),

  http.patch(path(accountsApi.updateReminder), async ({ request, params }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const r = getDb().reminders.find((x) => x.id === params.reminderId);
    if (!r) return fail(404, "not_found", "That reminder wasn't found.");
    r.switchMeOver = ((await request.json()) as { switchMeOver: boolean }).switchMeOver;
    saveDb();
    return reply(accountsApi.updateReminder.response, reminderView(r));
  }),

  http.delete(path(accountsApi.removeReminder), ({ request, params }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const db = getDb();
    db.reminders = db.reminders.filter((r) => r.id !== params.reminderId);
    saveDb();
    return reply(accountsApi.removeReminder.response, { ok: true });
  }),

  // First sign-in: keep what's on this device. The account's keys win: a device preset whose key
  // is taken gets the lowest free key, or goes to More presets; nothing on the account moves.
  http.post(path(accountsApi.mergeDevice), async ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const body = (await request.json()) as { presets: Array<{ stationId: string; key: number | null }>; reminders: Array<{ logEntryId?: string; listedAiringId?: string; switchMeOver: boolean }> };
    const db = getDb();
    let list: KeyedPreset[] = db.presets;
    for (const p of body.presets) {
      if (!stationById(p.stationId) || list.some((x) => x.stationId === p.stationId)) continue;
      const key = p.key === null ? null : !list.some((x) => x.key === p.key) ? p.key : lowestFreeKey(list);
      list = placePreset(list, p.stationId, key);
    }
    setPresets(list);
    for (const r of body.reminders) {
      const airingId = r.logEntryId ?? r.listedAiringId;
      if (airingId && AIRINGS.some((a) => a.id === airingId) && !db.reminders.some((x) => x.airingId === airingId)) db.reminders.push({ id: uid(90000 + db.reminders.length), airingId, switchMeOver: r.switchMeOver, createdAt: now().toISOString() });
    }
    saveDb();
    return reply(accountsApi.mergeDevice.response, { presets: presetsView(), reminders: db.reminders.map(reminderView) });
  }),

  // ---------- Pledges ----------
  http.get(path(ledgerApi.listMyPledges), ({ request }) => needsUser(request) ?? reply(PledgesX, getDb().pledges.map(pledgeView))),

  http.post(path(ledgerApi.pledge), async ({ request, params }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const body = (await request.json()) as { cadence: "monthly" | "once"; amountMicros: number; creditOnAir?: boolean };
    if (body.amountMicros < 1_000_000) return fail(400, "bad_request", "Pledges start at $1.00.");
    const s = STATIONS.find((x) => x.ident.id === params.stationId);
    if (!s) return fail(404, "not_found", "That station wasn't found.");
    const db = getDb();
    const p: DbPledge = { id: uid(60000 + db.pledges.length + Math.floor(Math.random() * 30000)), stationId: s.ident.id, cadence: body.cadence, amountMicros: body.amountMicros, creditOnAir: !!body.creditOnAir, startedAt: now().toISOString(), endsAfter: null, card: "Visa ending 4417" };
    db.pledges.push(p);
    saveDb();
    // A real pledge goes to Stripe's checkout; the mock is paid at once.
    return reply(ledgerApi.pledge.response, { pledge: pledgeView(p), checkoutUrl: null }, 201);
  }),

  http.patch(path(pledgesApiX.updatePledge), async ({ request, params }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const p = getDb().pledges.find((x) => x.id === params.pledgeId);
    if (!p) return fail(404, "not_found", "That pledge wasn't found.");
    const body = (await request.json()) as { amountMicros?: number; creditOnAir?: boolean; cadence?: "monthly" | "once"; stop?: true };
    if (body.amountMicros !== undefined && body.amountMicros < 1_000_000) return fail(400, "bad_request", "Pledges start at $1.00.");
    if (body.amountMicros !== undefined) p.amountMicros = body.amountMicros;
    if (body.creditOnAir !== undefined) p.creditOnAir = body.creditOnAir;
    // Monthly to once: it isn't charged again, like stopping (E1).
    if (body.cadence === "once" && p.cadence === "monthly") p.endsAfter = endOfThisMonth(now());
    if (body.cadence === "monthly" && p.cadence === "monthly") p.endsAfter = null;
    // Stopping: it ends after the current month.
    if (body.stop) p.endsAfter = endOfThisMonth(now());
    saveDb();
    return reply(PledgeX, pledgeView(p));
  }),

  http.post(path(pledgesApiX.cardSession), ({ request, params }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    if (!getDb().pledges.some((x) => x.id === params.pledgeId)) return fail(404, "not_found", "That pledge wasn't found.");
    // A real one is Stripe's page, which comes back here. The mock comes straight back.
    return reply(pledgesApiX.cardSession.response, { url: `/you/pledges/${params.pledgeId}` });
  }),

  // ---------- Account (A1, A2, A3) ----------
  http.post(path(accountApiX.signOutEverywhere), ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const db = getDb();
    db.signedOutEverywhereAt = now().toISOString();
    db.tvs = db.tvs.filter((t) => t.kind !== "tv_app");
    saveDb();
    return reply(accountApiX.signOutEverywhere.response, { ok: true });
  }),

  http.delete(path(accountApiX.clearWatchHistory), ({ request }) => needsUser(request) ?? reply(accountApiX.clearWatchHistory.response, { ok: true })),

  http.post(path(accountApiX.exportData), ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    return reply(accountApiX.exportData.response, { email: personOf(request)!.email, readyBy: new Date(now().getTime() + 86400e3).toISOString() });
  }),

  http.delete(path(accountApiX.deleteAccount), ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    // The mock starts over, as if a new person signed in next.
    resetDb();
    return reply(accountApiX.deleteAccount.response, { ok: true });
  }),

  // ---------- Run a station ----------
  http.get(path(stationsApi.availableChannels), ({ request, params }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const market = marketOf(String(params.marketSlug));
    if (!market) return fail(404, "not_found", "That market wasn't found.");
    const band = new URL(request.url).searchParams.get("band") === "radio" ? "radio" : "tv";
    return reply(stationsApi.availableChannels.response, { market, band, channels: channelsFor(market.slug, band) });
  }),

  // ---------- Notifications ----------
  http.get(path(notificationsApi.getPrefs), ({ request }) => needsUser(request) ?? reply(notificationsApi.getPrefs.response, { prefs: getDb().prefs, alwaysOn: [] })),

  http.put(path(notificationsApi.setPrefs), async ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const body = (await request.json()) as { prefs: Record<string, { push: boolean; email: boolean }> };
    getDb().prefs = { ...getDb().prefs, ...body.prefs };
    saveDb();
    return reply(notificationsApi.setPrefs.response, { prefs: getDb().prefs, alwaysOn: [] });
  }),

  // ---------- Tuned in ----------
  http.post(path(audienceApi.heartbeat), () => reply(audienceApi.heartbeat.response, { ok: true, nextInMs: 30_000 }))
];
