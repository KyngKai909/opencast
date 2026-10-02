// Reserved call signs on the desk's mocks (desk-pages 02), on the reference's Saturday, 8:42 pm: the
// states as the API gives them, Invite the next 10 in reservation order, Decide and Suggest holding
// another name in the same place in line, Extend and Release, the call sign check refusing K and W
// names with suggestions, and a market lead kept to their own market.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpHandler } from "msw";
import { waitlistApi, type Reservation } from "@opencast/contracts";
import { apiFor } from "../testApi";

const NOW = new Date("2026-09-27T03:42:12Z");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const IE = U(90001);
const HD = U(90003);
const LEE = "lee@opencast.example";

let handlers: HttpHandler[];
let db: typeof import("../db");
let settings: typeof import("../settingsDb");
let api: ReturnType<typeof apiFor>;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  db = await import("../db");
  settings = await import("../settingsDb");
  handlers = (await import("./index")).handlers;
  api = apiFor(handlers);
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  localStorage.clear();
  db.resetDb();
  settings.resetSettings();
});

const list = async (marketId = IE, as?: string) => waitlistApi.listReservations.response.parse((await api("GET", "/admin/reservations", { query: { marketId }, as })).json) as Reservation[];
const find = async (callSign: string) => (await list()).filter((r) => r.callSign === callSign);

describe("the list", () => {
  it("gives each reservation its state, in reservation order", async () => {
    const rows = await list();
    expect(rows).toHaveLength(26);
    expect(rows[0]).toMatchObject({ callSign: "TACO", state: "ending", name: "Hank V.", channel: "41.1" });
    const state = Object.fromEntries(rows.map((r) => [r.callSign, r.state]));
    expect(state).toMatchObject({ HOOP: "signing_on", DUSK: "waiting", KFRO: "not_allowed", SKAT: "waiting" });
    const vale = rows.filter((r) => r.callSign === "VALE");
    expect(vale.map((r) => [r.about, r.state])).toEqual([
      ["A skate crew, Fontana", "same_name"],
      ["A church, Fontana", "same_name"]
    ]);
    expect(vale[0]!.sameName).toEqual([vale[1]!.id]);
    expect(rows.find((r) => r.callSign === "KFRO")!.refusal).toMatchObject({ rule: "kw_four_letters" });
    const overview = (await api("GET", "/admin/reservations/overview", { query: { marketId: IE } })).json;
    expect(overview).toMatchObject({ held: 26, withChannel: 4, toInvite: 22, needsDecision: 3, holdDays: 120, reminderDays: 14, flaggedStations: [] });
  });
});

describe("Invite the next 10", () => {
  it("invites in reservation order, skipping names that need a decision and people setting up", async () => {
    const res = await api("POST", "/admin/reservations/invite-next", { body: { marketId: IE } });
    expect(res.status).toBe(200);
    expect(res.json.invited.map((r: Reservation) => r.callSign)).toEqual(["TACO", "SKAT", "GOSP", "BRUN", "CHLO", "EAST", "FARM", "GRIT", "HOME", "INKY"]);
    expect(res.json.left).toBe(12);
    expect((await find("SKAT"))[0]!.state).toBe("invited");
  });
});

describe("decisions", () => {
  it("Decide keeps one and holds a suggestion for the other, in their place in line", async () => {
    const [crew, church] = await find("VALE");
    const ideas = (await api("GET", "/admin/call-signs/VALE/suggestions")).json;
    expect(ideas.suggestions).toEqual(["VALES", "VALEY", "VALEO"]);
    const res = await api("POST", `/admin/reservations/${crew!.id}/decide`, { body: { suggestions: [{ reservationId: church!.id, callSign: "VALEY" }] } });
    expect(res.status).toBe(200);
    expect(res.json.kept).toMatchObject({ callSign: "VALE", state: "waiting", sameName: [] });
    expect(res.json.told).toEqual([{ reservationId: church!.id, email: "grace@example.com", suggestion: "VALEY" }]);
    expect((await find("VALEY"))[0]).toMatchObject({ createdAt: church!.createdAt, about: "A church, Fontana", state: "waiting" });
    expect((await api("POST", `/admin/reservations/${crew!.id}/decide`)).json.error.code).toBe("not_same_name");
  });

  it("Suggest holds an allowed, free name in place of one that isn't allowed", async () => {
    const [kfro] = await find("KFRO");
    expect((await api("POST", `/admin/reservations/${kfro!.id}/invite`)).json.error.code).toBe("not_allowed");
    expect((await api("POST", `/admin/reservations/${kfro!.id}/suggest`, { body: { callSign: "WREN" } })).json.error.code).toBe("call_sign_refused");
    expect((await api("POST", `/admin/reservations/${kfro!.id}/suggest`, { body: { callSign: "TACO" } })).status).toBe(409);
    const res = await api("POST", `/admin/reservations/${kfro!.id}/suggest`, { body: { callSign: "FRO" } });
    expect(res.json).toMatchObject({ callSign: "FRO", name: "J. Park", createdAt: kfro!.createdAt, state: "waiting" });
    expect(await find("KFRO")).toEqual([]);
  });

  it("Extend adds the hold's days from the end; Release frees the name and its channel", async () => {
    const [taco] = await find("TACO");
    const extended = await api("POST", `/admin/reservations/${taco!.id}/extend`);
    expect(Date.parse(extended.json.heldUntil)).toBe(Date.parse(taco!.heldUntil!) + 120 * 86_400_000);
    expect(extended.json.state).toBe("waiting");
    const released = await api("POST", `/admin/reservations/${taco!.id}/release`);
    expect(released.json).toEqual({ ok: true, callSign: "TACO", channel: "41.1" });
    const board = (await api("GET", "/admin/markets/inland-empire/board", { query: { band: "tv" } })).json;
    expect(board.slots.find((s: { major: number }) => s.major === 41).state).toBe("open");
  });
});

describe("call sign checks", () => {
  it("refuses four letters starting with K or W, with names to try", async () => {
    const res = (await api("GET", "/call-signs/KBEA", { as: null })).json;
    expect(res).toMatchObject({ valid: true, available: false, reservable: false, refusal: { rule: "kw_four_letters" }, suggestions: ["BEA", "BEAS", "BEAY"] });
    expect((await api("GET", "/call-signs/VALE", { as: null })).json).toMatchObject({ available: false, reservable: true });
  });
});

describe("market leads", () => {
  it("see and act on their own market only", async () => {
    expect((await api("GET", "/admin/reservations", { query: { marketId: IE }, as: LEE })).status).toBe(403);
    const hd = await list(HD, LEE);
    expect(hd.map((r) => r.callSign)).toEqual(["DUST", "JOSH", "RIMS"]);
    expect((await api("POST", `/admin/reservations/${hd[0]!.id}/extend`, { as: LEE })).status).toBe(200);
    const [taco] = await find("TACO");
    const refused = await api("POST", `/admin/reservations/${taco!.id}/release`, { as: LEE });
    expect(refused.status).toBe(403);
    expect(refused.json.error.code).toBe("desk_role");
    expect((await api("POST", "/admin/reservations/invite-next", { body: { marketId: IE }, as: LEE })).status).toBe(403);
  });
});
