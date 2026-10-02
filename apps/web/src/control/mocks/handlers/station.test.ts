// The Station area's mock API: roles on every change, the break rule's order, translators,
// claims and standing, notification settings, the switcher's status, and claiming a station.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupServer } from "msw/node";
import { resetDb, getDb } from "../db";
import { BEAT, CRAT, HALL } from "../fixtures/stations";
import { resetStationState } from "../fixtures/station";
import { at } from "../fixtures/time";
import { mockTokenFor } from "../../../auth/mockToken";
import { firstGap, nextDeadAir, normaliseFillOrder, stationHandlers } from "./station";

const server = setupServer(...stationHandlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetStationState();
});

const api = async (who: string | null, method: string, path: string, body?: unknown) => {
  const headers: Record<string, string> = {};
  if (who) headers.authorization = `Bearer ${mockTokenFor(`${who}@example.com`)}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`http://localhost/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
};

describe("the team (station-settings 03)", () => {
  it("lists members and the waiting invite for owners and operators, not hosts", async () => {
    const kai = await api("kai", "GET", `/stations/${BEAT.id}/team`);
    expect(kai.status).toBe(200);
    expect(kai.json.members.map((m: { displayName: string; role: string }) => [m.displayName, m.role])).toEqual([
      ["Kai M.", "owner"],
      ["Marcus Reyes", "operator"],
      ["Jen Park", "host"]
    ]);
    expect(kai.json.invites.map((i: { email: string }) => i.email)).toEqual(["dee@example.com"]);
    expect((await api("marcus", "GET", `/stations/${BEAT.id}/team`)).status).toBe(200);
    expect((await api("jen", "GET", `/stations/${BEAT.id}/team`)).status).toBe(403);
    expect((await api(null, "GET", `/stations/${BEAT.id}/team`)).status).toBe(401);
  });

  it("lets only the owner invite, and a host needs blocks", async () => {
    expect((await api("marcus", "POST", `/stations/${BEAT.id}/team/invites`, { email: "dana@example.com", role: "operator" })).status).toBe(403);
    const noBlocks = await api("kai", "POST", `/stations/${BEAT.id}/team/invites`, { email: "dana@example.com", role: "host" });
    expect(noBlocks.status).toBe(400);
    expect(noBlocks.json.error.message).toBe("Choose the blocks they'll host.");
    const ok = await api("kai", "POST", `/stations/${BEAT.id}/team/invites`, { email: "dana@example.com", role: "host", note: "Co-op town hall", programIds: [BEAT.id] });
    expect(ok.status).toBe(201);
    expect(ok.json.role).toBe("host");
    expect(Date.parse(ok.json.expiresAt) - Date.parse(ok.json.createdAt)).toBe(7 * 86_400_000);
    const already = await api("kai", "POST", `/stations/${BEAT.id}/team/invites`, { email: "marcus@example.com", role: "operator" });
    expect(already.status).toBe(409);
  });

  it("changes roles and removes people, but never the owner", async () => {
    const marcus = getDb().members.find((m) => m.stationId === BEAT.id && m.role === "operator")!;
    const kai = getDb().members.find((m) => m.stationId === BEAT.id && m.role === "owner")!;
    const r = await api("kai", "PATCH", `/stations/${BEAT.id}/team/${marcus.personId}`, { role: "host" });
    expect(r.json.members.find((m: { userId: string }) => m.userId === marcus.personId).role).toBe("host");
    expect((await api("kai", "PATCH", `/stations/${BEAT.id}/team/${kai.personId}`, { role: "operator" })).status).toBe(409);
    expect((await api("kai", "DELETE", `/stations/${BEAT.id}/team/${kai.personId}`)).status).toBe(409);
    const gone = await api("kai", "DELETE", `/stations/${BEAT.id}/team/${marcus.personId}`);
    expect(gone.json.members).toHaveLength(2);
  });

  it("hands ownership over, and the old owner stays as an operator", async () => {
    const marcus = getDb().members.find((m) => m.stationId === BEAT.id && m.role === "operator")!;
    const r = await api("kai", "POST", `/stations/${BEAT.id}/team/transfer`, { toUserId: marcus.personId });
    expect(r.json.members.map((m: { displayName: string; role: string }) => [m.displayName, m.role]).slice(0, 2)).toEqual([
      ["Marcus Reyes", "owner"],
      ["Kai M.", "operator"]
    ]);
    expect((await api("kai", "POST", `/stations/${BEAT.id}/team/transfer`, { toUserId: marcus.personId })).status).toBe(403);
  });

  it("resends an invite for another week", async () => {
    const team = await api("kai", "GET", `/stations/${BEAT.id}/team`);
    const invite = team.json.invites[0];
    const r = await api("kai", "POST", `/invites/${invite.id}/resend`);
    expect(Date.parse(r.json.expiresAt)).toBeGreaterThan(Date.parse(invite.expiresAt));
  });
});

describe("the break rule (station-settings 02.1)", () => {
  it("reads BEAT's rule and keeps the station ID last when it's changed", async () => {
    const r = await api("marcus", "GET", `/stations/${BEAT.id}/break-rule`);
    expect(r.json).toMatchObject({ mode: "every_n_minutes", everyMinutes: 30, lengthMs: 120_000, spotMsPerHour: 180_000, blockedCategories: ["Alcohol", "Gambling", "Political"] });
    const set = await api("marcus", "PUT", `/stations/${BEAT.id}/break-rule`, { ...r.json, fillOrder: ["SID", "BMP", "SPT", "UND"], mode: "none" });
    expect(set.json.fillOrder).toEqual(["BMP", "SPT", "UND", "SID"]);
    expect(set.json.everyMinutes).toBeNull();
    expect((await api("jen", "PUT", `/stations/${BEAT.id}/break-rule`, r.json)).status).toBe(403);
  });
  it("normalises the order", () => {
    expect(normaliseFillOrder(["SPT", "SID", "SPT", "UND"])).toEqual(["SPT", "UND", "SID"]);
  });
  it("answers how often the station ID, bumpers and credit air, and keeps it when it's left out (added 2026-09-29)", async () => {
    const r = await api("marcus", "GET", `/stations/${BEAT.id}/break-rule`);
    expect(r.json.cadence).toEqual({ stationId: { every: "break" }, bumpers: { every: "break" }, underwriting: { every: "break" }, spots: { every: "break" } });
    const cadence = { stationId: { every: "n_programs", n: 2 }, bumpers: { every: "never" }, underwriting: { every: "hour" }, spots: { every: "program" } };
    expect((await api("marcus", "PUT", `/stations/${BEAT.id}/break-rule`, { ...r.json, cadence })).json.cadence).toEqual(cadence);
    const { cadence: _left, ...rest } = r.json;
    expect((await api("marcus", "PUT", `/stations/${BEAT.id}/break-rule`, { ...rest, lengthMs: 90_000 })).json).toMatchObject({ lengthMs: 90_000, cadence });
    // An app from before spots had a choice leaves them out: they stay.
    const { spots: _spots, ...older } = cadence;
    expect((await api("marcus", "PUT", `/stations/${BEAT.id}/break-rule`, { ...rest, cadence: older })).json.cadence).toEqual(cadence);
    expect((await api("marcus", "PUT", `/stations/${BEAT.id}/break-rule`, { ...r.json, cadence: { ...cadence, stationId: { every: "never" } } })).status).toBe(400);
  });
});

describe("translators (master-control A.5)", () => {
  it("lists YouTube, adds Twitch with its key, and never returns the key", async () => {
    expect((await api("kai", "GET", `/stations/${BEAT.id}/translators`)).json).toHaveLength(1);
    const bad = await api("kai", "POST", `/stations/${BEAT.id}/translators`, { service: "rtmp", name: "Mine", rtmpUrl: "http://x", streamKey: "k" });
    expect(bad.json.error.message).toBe("The address starts with rtmp:// or rtmps://.");
    const tw = await api("kai", "POST", `/stations/${BEAT.id}/translators`, { service: "twitch", name: "Twitch channel", rtmpUrl: "rtmp://live.twitch.tv/app", streamKey: "live_123", breakHandling: "station_id_slate", prerecordedLabel: true });
    expect(tw.status).toBe(201);
    expect(tw.json).toMatchObject({ hasStreamKey: true, breakHandling: "station_id_slate", prerecordedLabel: true, status: "connected" });
    expect(JSON.stringify(tw.json)).not.toContain("live_123");
    const off = await api("marcus", "PATCH", `/stations/${BEAT.id}/translators/${tw.json.id}`, { enabled: false });
    expect(off.json.enabled).toBe(false);
    await api("kai", "DELETE", `/stations/${BEAT.id}/translators/${tw.json.id}`);
    expect((await api("kai", "GET", `/stations/${BEAT.id}/translators`)).json).toHaveLength(1);
  });
});

describe("rights claims (rights 01 to 04)", () => {
  it("lists BEAT's claims with its standing; hosts don't see them", async () => {
    const r = await api("marcus", "GET", `/stations/${BEAT.id}/claims`);
    expect(r.json.standing).toEqual({ status: "good", openClaims: 1, upheldLast12Months: 0, threshold: 3 });
    expect(r.json.claims.map((c: { item: { title: string }; state: string }) => [c.item.title, c.state])).toEqual([
      ["Crate Session 03", "open"],
      ["Late Crate, ep. 12", "restored"],
      ["BEAT station ID, v1", "removed"]
    ]);
    expect(r.json.claims[0].daysToAnswer).toBeGreaterThanOrEqual(8);
    expect(r.json.claims[0].takedowns[0].airings).toHaveLength(1);
    expect((await api("jen", "GET", `/stations/${BEAT.id}/claims`)).status).toBe(403);
  });

  it("lets only the owner answer, with the permission attached when that's the basis", async () => {
    const id = (await api("kai", "GET", `/stations/${BEAT.id}/claims`)).json.claims[0].id;
    expect((await api("marcus", "POST", `/claims/${id}/answer`, { basis: "made_it", attest: true })).status).toBe(403);
    expect((await api("kai", "POST", `/claims/${id}/answer`, { basis: "owner_permission", attest: true })).status).toBe(400);
    const r = await api("kai", "POST", `/claims/${id}/answer`, { basis: "owner_permission", attachmentUrl: "https://files.example/l.pdf", note: "Licensed", attest: true });
    expect(r.json.state).toBe("answered");
    expect(r.json.answer).toMatchObject({ basis: "owner_permission", note: "Licensed" });
    expect(r.json.takedowns[0].restoredAt).not.toBeNull();
    expect((await api("kai", "GET", `/stations/${BEAT.id}/claims`)).json.standing.openClaims).toBe(0);
  });

  it("takes the item out of the library when it's removed; an operator may", async () => {
    const before = getDb().library.items.length;
    const id = (await api("kai", "GET", `/stations/${BEAT.id}/claims`)).json.claims[0].id;
    const r = await api("marcus", "POST", `/claims/${id}/remove`);
    expect(r.json.state).toBe("removed");
    expect(getDb().library.items).toHaveLength(before - 1);
    expect(getDb().library.items.some((i) => i.title === "Crate Session 03")).toBe(false);
    expect((await api("kai", "POST", `/claims/${id}/remove`)).status).toBe(409);
  });

  it("takes a file for the answer", async () => {
    const id = (await api("kai", "GET", `/stations/${BEAT.id}/claims`)).json.claims[0].id;
    // Written out by hand: jsdom's FormData isn't the one Node's fetch sends.
    const b = "----oc";
    const body = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="westside-licence-2023.pdf"\r\nContent-Type: application/pdf\r\n\r\nlicence\r\n--${b}--\r\n`;
    const res = await fetch(`http://localhost/v1/claims/${id}/attachments`, {
      method: "POST",
      headers: { authorization: `Bearer ${mockTokenFor("kai@example.com")}`, "content-type": `multipart/form-data; boundary=${b}` },
      body
    });
    expect(res.status).toBe(201);
    expect((await res.json()).fileName).toBe("westside-licence-2023.pdf");
  });
});

describe("notification settings (station-settings 05.1)", () => {
  it("keeps dead air on, whatever is sent", async () => {
    const q = `/me/notification-prefs?scope=station&scopeId=${BEAT.id}`;
    const r = await api("marcus", "GET", q);
    expect(r.json.alwaysOn).toContain("dead_air_warning");
    expect(r.json.prefs.signed_on_off.push).toBe(false);
    const set = await api("marcus", "PUT", "/me/notification-prefs", { scope: "station", scopeId: BEAT.id, prefs: { dead_air_warning: { push: false, email: false }, signed_on_off: { push: true, email: false } } });
    expect(set.json.prefs.dead_air_warning.push).toBe(true);
    expect(set.json.prefs.signed_on_off.push).toBe(true);
    // Per person: Kai's are his own.
    expect((await api("kai", "GET", q)).json.prefs.signed_on_off.push).toBe(false);
  });
});

describe("the switcher's status (A5)", () => {
  it("says each of Kai's stations is on air, and when HALL goes quiet", async () => {
    const r = await api("kai", "GET", "/me/stations/status");
    const hall = r.json.find((x: { stationId: string }) => x.stationId === HALL.id);
    const beat = r.json.find((x: { stationId: string }) => x.stationId === BEAT.id);
    expect(beat.onAir).toBe(true);
    expect(hall.onAir).toBe(true);
    // BEAT 12.1, BEAT 12.2 (Beat Tapes, sharing its call sign) and HALL.
    expect(r.json).toHaveLength(3);
  });
  it("finds the first moment nothing is on the log", () => {
    const e = (a: string, b: string) => ({ startsAt: `2026-09-27T${a}:00.000Z`, endsAt: `2026-09-27T${b}:00.000Z` });
    const from = "2026-09-27T03:42:00.000Z";
    const to = "2026-09-27T09:42:00.000Z";
    // Short joins between entries aren't dead air; the end of the log is.
    expect(firstGap([e("03:30", "03:59"), e("04:01", "05:00"), e("05:00", "06:40")], from, to)).toBe("2026-09-27T06:40:00.000Z");
    expect(firstGap([e("03:30", "04:00"), e("04:30", "09:59")], from, to)).toBe("2026-09-27T04:00:00.000Z");
    expect(firstGap([e("03:30", "10:00")], from, to)).toBeNull();
  });
  it("finds BEAT's dead air from its log: 11:40 pm, after Slow Hours", () => {
    expect(nextDeadAir(BEAT.id, new Date(at("20:42:12")))).toBe(at("23:40"));
    // More than six hours out, the switcher doesn't look that far.
    expect(nextDeadAir(HALL.id, new Date(at("14:00")))).toBeNull();
    expect(nextDeadAir(HALL.id, new Date(at("20:42:12")))).toBe(at("21:22:12"));
  });
});

describe("claiming a station (rights 05.1)", () => {
  it("shows the claim page to anyone with the link", async () => {
    const r = await api(null, "GET", "/claim/crat-101-9-ready");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ personName: "Marcus Reyes", presetCount: 88, heldMicros: 214_600_000, escrowStationId: 101, handover: null });
    expect(r.json.station.callSign).toBe("CRAT");
    expect((await api(null, "GET", "/claim/not-a-real-link")).status).toBe(404);
  });

  it("takes a claim only from the person it's for, and the desk's check starts the 72 hours", async () => {
    expect((await api("kai", "POST", `/stations/${CRAT.id}/claim`, { kind: "claim", sourceAccountProof: "x" })).status).toBe(403);
    const start = await api("marcus", "POST", `/stations/${CRAT.id}/claim`, { kind: "claim", sourceAccountProof: "soundcloud:connected" });
    expect(start.status).toBe(201);
    expect(start.json.status).toBe("verifying");
    expect((await api(null, "GET", "/claim/crat-101-9-ready")).json.handover.status).toBe("verifying");
    const spy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
    const later = (await api(null, "GET", "/claim/crat-101-9-ready")).json.handover;
    spy.mockRestore();
    expect(later.status).toBe("waiting_period");
    expect(later.payableAfter).not.toBeNull();
  });

  it("asks to stop instead, which replaces a claim in progress", async () => {
    await api("marcus", "POST", `/stations/${CRAT.id}/claim`, { kind: "claim", sourceAccountProof: "p" });
    const stop = await api("marcus", "POST", `/stations/${CRAT.id}/claim`, { kind: "stop", sourceAccountProof: "p" });
    expect(stop.json.status).toBe("verifying");
    expect((await api(null, "GET", "/claim/crat-101-9-ready")).json.handover.kind).toBe("stop");
  });
});
