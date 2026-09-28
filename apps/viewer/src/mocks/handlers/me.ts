// The signed-in person: me, presets, reminders, pledges, notification settings.

import { http } from "msw";
import { accountsApi, audienceApi, ledgerApi, notificationsApi } from "@opencast/contracts";
import { now } from "../../lib/clock";
import { getDb, saveDb, type DbPreset } from "../db";
import { AIRINGS, airingById } from "../fixtures/schedule";
import { STATIONS, stationById, uid } from "../fixtures/stations";
import { fail, needsUser, path, reply } from "../respond";
import { marketOf } from "../view";

const ident = (id: string) => stationById(id)!.ident;

function meView() {
  const { me } = getDb();
  return {
    id: me.id,
    displayName: me.displayName,
    email: me.email,
    market: me.marketSlug ? marketOf(me.marketSlug) : null,
    isAdmin: false,
    identities: [{ kind: "email" as const, value: me.email, verifiedAt: "2026-06-01T19:00:00Z" }],
    memberships: [],
    settings: me.settings
  };
}

function presetsView() {
  return [...getDb().presets].sort((a, b) => a.position - b.position).map((p) => ({ station: ident(p.stationId), key: p.key, position: p.position }));
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

function pledgeView(p: ReturnType<typeof getDb>["pledges"][number]) {
  const next = new Date(now());
  next.setUTCMonth(next.getUTCMonth() + 1, 1);
  return {
    id: p.id,
    station: ident(p.stationId),
    cadence: p.cadence,
    amountMicros: p.amountMicros,
    creditOnAir: p.creditOnAir,
    startedAt: p.startedAt,
    nextChargeOn: p.cadence === "monthly" && !p.endsAfter ? next.toISOString().slice(0, 10) : null,
    endsAfter: p.endsAfter,
    receipts: { count: p.receipts, totalMicros: p.receipts * p.amountMicros }
  };
}

/** Save a station to a key: a station already on that key moves to More presets, never deleted. */
function savePreset(stationId: string, key: number | null) {
  const db = getDb();
  const list = db.presets;
  const existing = list.find((p) => p.stationId === stationId);
  if (key !== null) for (const p of list) if (p.key === key && p.stationId !== stationId) p.key = null;
  if (existing) existing.key = key;
  else list.push({ stationId, key, position: list.length });
  // Keys first, in key order, then More presets in the order they were saved.
  const keyed = list.filter((p) => p.key !== null).sort((a, b) => a.key! - b.key!);
  const more = list.filter((p) => p.key === null).sort((a, b) => a.position - b.position);
  [...keyed, ...more].forEach((p, i) => (p.position = i));
  saveDb();
}

export const meHandlers = [
  http.get(path(accountsApi.getMe), ({ request }) => needsUser(request) ?? reply(accountsApi.getMe.response, meView())),

  http.patch(path(accountsApi.updateMe), async ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const body = (await request.json()) as { displayName?: string | null; marketId?: string | null; settings?: Record<string, unknown> };
    const { me } = getDb();
    if (body.displayName !== undefined) me.displayName = body.displayName;
    if (body.marketId !== undefined) me.marketSlug = body.marketId ? (["inland-empire", "los-angeles", "high-desert"].find((s) => marketOf(s)?.id === body.marketId) ?? me.marketSlug) : null;
    if (body.settings) {
      const cur = me.settings as Record<string, Record<string, unknown> | undefined>;
      for (const [k, v] of Object.entries(body.settings)) cur[k] = typeof v === "object" && v ? { ...(cur[k] ?? {}), ...(v as object) } : (v as never);
    }
    saveDb();
    return reply(accountsApi.updateMe.response, meView());
  }),

  // ---------- Presets ----------
  http.get(path(accountsApi.listPresets), ({ request }) => needsUser(request) ?? reply(accountsApi.listPresets.response, presetsView())),

  http.post(path(accountsApi.savePreset), async ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const { stationId, key } = (await request.json()) as { stationId: string; key: number | null };
    if (!stationById(stationId)) return fail(404, "not_found", "That station wasn't found.");
    savePreset(stationId, key);
    return reply(accountsApi.savePreset.response, presetsView(), 201);
  }),

  http.put(path(accountsApi.reorderPresets), async ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const body = (await request.json()) as { presets: Array<{ stationId: string; key: number | null }> };
    getDb().presets = body.presets.map((p, i): DbPreset => ({ stationId: p.stationId, key: p.key, position: i }));
    saveDb();
    return reply(accountsApi.reorderPresets.response, presetsView());
  }),

  http.delete(path(accountsApi.removePreset), ({ request, params }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const db = getDb();
    db.presets = db.presets.filter((p) => p.stationId !== params.stationId);
    db.presets.forEach((p, i) => (p.position = i));
    saveDb();
    return reply(accountsApi.removePreset.response, presetsView());
  }),

  http.get(path(accountsApi.suggestPresetKey), ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    // The key used least in the last month: the mock says key 6, as the reference does.
    return reply(accountsApi.suggestPresetKey.response, { key: 6 });
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

  http.post(path(accountsApi.mergeDevice), async ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const body = (await request.json()) as { presets: Array<{ stationId: string; key: number | null }>; reminders: Array<{ logEntryId?: string; listedAiringId?: string; switchMeOver: boolean }> };
    const db = getDb();
    for (const p of body.presets) if (!db.presets.some((x) => x.stationId === p.stationId)) savePreset(p.stationId, p.key !== null && db.presets.some((x) => x.key === p.key) ? null : p.key);
    for (const r of body.reminders) {
      const airingId = r.logEntryId ?? r.listedAiringId;
      if (airingId && AIRINGS.some((a) => a.id === airingId) && !db.reminders.some((x) => x.airingId === airingId)) db.reminders.push({ id: uid(90000 + db.reminders.length), airingId, switchMeOver: r.switchMeOver, createdAt: now().toISOString() });
    }
    saveDb();
    return reply(accountsApi.mergeDevice.response, { presets: presetsView(), reminders: db.reminders.map(reminderView) });
  }),

  // ---------- Pledges ----------
  http.get(path(ledgerApi.listMyPledges), ({ request }) => needsUser(request) ?? reply(ledgerApi.listMyPledges.response, getDb().pledges.map(pledgeView))),

  http.post(path(ledgerApi.pledge), async ({ request, params }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const body = (await request.json()) as { cadence: "monthly" | "once"; amountMicros: number; creditOnAir?: boolean };
    if (body.amountMicros < 1_000_000) return fail(400, "bad_request", "Pledges start at $1.00.");
    const s = STATIONS.find((x) => x.ident.id === params.stationId);
    if (!s) return fail(404, "not_found", "That station wasn't found.");
    const db = getDb();
    const p = { id: uid(60000 + db.pledges.length + Math.floor(Math.random() * 30000)), stationId: s.ident.id, cadence: body.cadence, amountMicros: body.amountMicros, creditOnAir: !!body.creditOnAir, startedAt: now().toISOString(), endsAfter: null, card: "Visa ending 4417", receipts: 1 };
    db.pledges.push(p);
    saveDb();
    // A real pledge goes to Stripe's checkout; the mock is paid at once.
    return reply(ledgerApi.pledge.response, { pledge: pledgeView(p), checkoutUrl: null }, 201);
  }),

  http.patch(path(ledgerApi.updatePledge), async ({ request, params }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const p = getDb().pledges.find((x) => x.id === params.pledgeId);
    if (!p) return fail(404, "not_found", "That pledge wasn't found.");
    const body = (await request.json()) as { amountMicros?: number; creditOnAir?: boolean; stop?: true };
    if (body.amountMicros !== undefined) p.amountMicros = body.amountMicros;
    if (body.creditOnAir !== undefined) p.creditOnAir = body.creditOnAir;
    if (body.stop) {
      // It ends after the current month.
      const end = new Date(now());
      end.setUTCMonth(end.getUTCMonth() + 1, 0);
      p.endsAfter = end.toISOString().slice(0, 10);
    }
    saveDb();
    return reply(ledgerApi.updatePledge.response, pledgeView(p));
  }),

  // ---------- Notifications ----------
  http.get(path(notificationsApi.getPrefs), ({ request }) => needsUser(request) ?? reply(notificationsApi.getPrefs.response, { prefs: getDb().prefs, alwaysOn: [] })),

  http.put(path(notificationsApi.setPrefs), async ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const body = (await request.json()) as { prefs: Record<string, { push: boolean; email: boolean }> };
    getDb().prefs = body.prefs;
    saveDb();
    return reply(notificationsApi.setPrefs.response, { prefs: getDb().prefs, alwaysOn: [] });
  }),

  // ---------- Tuned in ----------
  http.post(path(audienceApi.heartbeat), () => reply(audienceApi.heartbeat.response, { ok: true, nextInMs: 30_000 }))
];
