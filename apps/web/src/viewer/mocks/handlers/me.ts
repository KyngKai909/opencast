// The signed-in person: me, presets, reminders, pledges (with E1's card, receipts, cadence and card
// page), notification settings, and the account's data (A1 sign out everywhere, A2 watch history,
// A3 export and delete). TVs and the remote relay are in tvs.ts.

import { http } from "msw";
import { AccountExport, accountsApi, audienceApi, ledgerApi, notificationsApi, stationsApi, WatchHistory, type Pledge } from "@opencast/contracts";
import { now } from "../../../lib/clock";
import { lowestFreeKey, normalise, placePreset, removePresetFrom, type KeyedPreset } from "../../components/you/presetRules";
import { getDb, profileOf, resetDb, saveDb, type DbPledge, type DbPreset } from "../db";
import { meHandler, meView } from "../../../mocks/me";
import { AIRINGS, airingById, nowNext } from "../fixtures/schedule";
import { syncStreamSignOff } from "../fixtures/signoff";
import { STATIONS, stationById, uid } from "../fixtures/stations";
import { channelsFor, nextChargeFor, receiptsFor } from "../fixtures/you";
import { fail, needsUser, path, personOf, reply } from "../respond";
import { marketOf } from "../view";
import { rememberSession } from "./watch";

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

export function pledgeView(p: DbPledge): Pledge {
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
    card: { label: p.card, expired: false, expiresOn: "2028-04-30" },
    receipts: { count: items.length, totalMicros: items.reduce((s, r) => s + r.amountMicros, 0), items }
  };
}

/** A heartbeat extends the stretch it continues, or starts a new one. */
export function recordWatching(stationId: string, at: Date) {
  const db = getDb();
  const t = at.toISOString();
  const last = db.watchHistory[0];
  if (last && last.stationId === stationId && at.getTime() - new Date(last.endedAt).getTime() <= 90_000) last.endedAt = t;
  else db.watchHistory.unshift({ stationId, startedAt: t, endedAt: t });
  const cutoff = new Date(at.getTime() - 30 * 86400e3).toISOString();
  db.watchHistory = db.watchHistory.filter((w) => w.endedAt >= cutoff);
  saveDb();
}

function historyView(p: Parameters<typeof profileOf>[0]) {
  const keep = profileOf(p).settings.privacy?.keepWatchHistory !== false;
  const items = keep ? getDb().watchHistory.filter((w) => stationById(w.stationId)).map((w) => ({ station: ident(w.stationId), startedAt: w.startedAt, endedAt: w.endedAt })) : [];
  return { keep, lastChannel: items[0] ? { station: items[0].station, at: items[0].endedAt } : null, items };
}

function exportView(p: Parameters<typeof meView>[0]) {
  const me = meView(p);
  const db = getDb();
  return {
    exportedAt: now().toISOString(),
    account: { id: me.id, displayName: me.displayName, email: me.email, market: me.market, createdAt: "2026-06-01T19:00:00.000Z", settings: me.settings },
    identities: me.identities,
    memberships: me.memberships,
    presets: presetsView(),
    reminders: db.reminders.map(reminderView),
    watchHistory: historyView(p).items,
    pledges: db.pledges.map(pledgeView),
    notificationPrefs: [{ scope: "viewer" as const, scopeId: null, prefs: db.prefs }],
    notices: [],
    tvs: db.tvs,
    clear: me.clear ?? null
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
    // Turning watch history off stops keeping it and clears what was kept (A2).
    if ((body.settings?.privacy as { keepWatchHistory?: boolean } | undefined)?.keepWatchHistory === false) getDb().watchHistory = [];
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
  http.get(path(ledgerApi.listMyPledges), ({ request }) => needsUser(request) ?? reply(ledgerApi.listMyPledges.response, getDb().pledges.map(pledgeView))),

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

  http.patch(path(ledgerApi.updatePledge), async ({ request, params }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const p = getDb().pledges.find((x) => x.id === params.pledgeId);
    if (!p) return fail(404, "not_found", "That pledge wasn't found.");
    const body = (await request.json()) as { amountMicros?: number; creditOnAir?: boolean; cadence?: "monthly" | "once"; stop?: true };
    if (body.amountMicros !== undefined && body.amountMicros < 1_000_000) return fail(400, "bad_request", "Pledges start at $1.00.");
    if (body.cadence === "monthly" && p.cadence === "once") return fail(422, "new_pledge_needed", "A one-time pledge can't become monthly. Pledge again, monthly.");
    if (body.cadence && p.endsAfter && p.endsAfter < now().toISOString().slice(0, 10)) return fail(422, "pledge_ended", "This pledge has ended. Pledge again to start it.");
    if (body.amountMicros !== undefined) p.amountMicros = body.amountMicros;
    if (body.creditOnAir !== undefined) p.creditOnAir = body.creditOnAir;
    // Monthly to once: it isn't charged again, like stopping (E1).
    if (body.cadence === "once" && p.cadence === "monthly") p.endsAfter = endOfThisMonth(now());
    if (body.cadence === "monthly" && p.cadence === "monthly") p.endsAfter = null;
    // Stopping: it ends after the current month.
    if (body.stop) p.endsAfter = endOfThisMonth(now());
    saveDb();
    return reply(ledgerApi.updatePledge.response, pledgeView(p));
  }),

  http.post(path(ledgerApi.pledgeCardSession), async ({ request, params }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const p = getDb().pledges.find((x) => x.id === params.pledgeId);
    if (!p) return fail(404, "not_found", "That pledge wasn't found.");
    if (p.cadence === "once" || p.endsAfter) return fail(422, "no_card_to_change", p.cadence === "once" ? "A one-time pledge has nothing more to charge." : "This pledge isn't charged again.");
    const body = ((await request.json().catch(() => null)) ?? {}) as { returnTo?: string };
    // A real one is Stripe's page, which comes back to returnTo with ?card=updated. The mock comes straight back.
    return reply(ledgerApi.pledgeCardSession.response, { url: `${body.returnTo ?? `/you/pledges/${params.pledgeId}`}?card=updated` });
  }),

  // ---------- Account (A1, A2, A3) ----------
  http.post(path(accountsApi.signOutEverywhere), ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const db = getDb();
    db.signedOutEverywhereAt = now().toISOString();
    db.tvs = db.tvs.filter((t) => t.kind !== "tv_app");
    saveDb();
    return reply(accountsApi.signOutEverywhere.response, { ok: true });
  }),

  http.get(path(accountsApi.getWatchHistory), ({ request }) => {
    const p = personOf(request);
    if (!p) return fail(401, "unauthorized", "Sign in to do that.");
    return reply(WatchHistory, historyView(p));
  }),

  http.delete(path(accountsApi.clearWatchHistory), ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    getDb().watchHistory = [];
    saveDb();
    return reply(accountsApi.clearWatchHistory.response, { ok: true });
  }),

  http.post(path(accountsApi.exportData), ({ request }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    // The link goes to /settings/data?download=1; the file is made when it's opened, so it's ready now.
    return reply(accountsApi.exportData.response, { email: personOf(request)!.email, readyBy: now().toISOString() });
  }),

  http.get(path(accountsApi.downloadData), ({ request }) => {
    const p = personOf(request);
    if (!p) return fail(401, "unauthorized", "Sign in to do that.");
    return reply(AccountExport, exportView(p));
  }),

  http.delete(path(accountsApi.deleteAccount), ({ request }) => {
    const p = personOf(request);
    if (!p) return fail(401, "unauthorized", "Sign in to do that.");
    // An owner hands the station over first (A3's 409).
    if (meView(p).memberships.some((m) => m.kind === "station" && m.role === "owner")) return fail(409, "owns_station", "You own a station. Make someone on its team the owner first, then delete your account.");
    // The mock starts over, as if a new person signed in next.
    resetDb();
    return reply(accountsApi.deleteAccount.response, { ok: true });
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
  // Signed in (and keeping history), it's also the person's watch history (A2). The tuned-in count stays anonymous.
  http.post(path(audienceApi.heartbeat), async ({ request }) => {
    const p = personOf(request);
    const body = (await request.json().catch(() => null)) as { stationId?: string; sessionId?: string; playing?: boolean } | null;
    // Watch data: the session, for its "Not for me" votes (watch.ts).
    if (body?.stationId && body.sessionId) rememberSession(body.sessionId, body.stationId);
    // During the station's planned off air (G9) the beat isn't counted or kept, and says when it's back.
    await syncStreamSignOff();
    const t = now();
    const off = body?.stationId ? nowNext(body.stationId, t).now : null;
    if (off?.offAir) return reply(audienceApi.heartbeat.response, { ok: true, nextInMs: Math.max(1000, Date.parse(off.end) - t.getTime()), offAirUntil: off.end });
    if (p && body?.stationId && body.playing && profileOf(p).settings.privacy?.keepWatchHistory !== false) recordWatching(body.stationId, t);
    return reply(audienceApi.heartbeat.response, { ok: true, nextInMs: 30_000 });
  })
];
