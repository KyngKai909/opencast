// The desk mock's rules, on the reference's Saturday, 8:42 pm: the admin gate, the board's
// figures, and a creator taken found → asked → said yes → set up → on air → claimed, with the API's
// refusals on the way (asking after a no, setting up before a yes, a held channel, a taken call
// sign, a second reminder).

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpHandler } from "msw";
import { MarketBoardX, CreatorsX, HeldEarningsX } from "../../api/ext";
import { apiFor } from "../testApi";

const NOW = new Date("2026-09-27T03:42:12Z");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const IE = U(90001);
const SKATE = U(202);
const GOSPEL = U(205);
const JAZZ = U(208);
const LUPE = U(201);
const DEE = U(900);

let handlers: HttpHandler[];
let db: typeof import("../db");
let api: ReturnType<typeof apiFor>;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  db = await import("../db");
  handlers = (await import("./index")).handlers;
  api = apiFor(handlers);
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  localStorage.clear();
  db.resetDb();
});

const creator = async (id: string) => CreatorsX.parse((await api("GET", "/admin/creators", { query: { marketId: IE } })).json).find((c) => c.id === id)!;

describe("the admin gate", () => {
  it("answers 401 signed out and 403 for someone not on the team", async () => {
    expect((await api("GET", "/admin/creators", { as: null })).status).toBe(401);
    expect((await api("GET", "/admin/creators", { as: "other" })).status).toBe(403);
    expect((await api("GET", "/admin/creators")).status).toBe(200);
  });

  it("says who's on the team in Me.isAdmin", async () => {
    expect((await api("GET", "/me")).json).toMatchObject({ displayName: "Dee A.", isAdmin: true });
    expect((await api("GET", "/me", { as: "other" })).json.isAdmin).toBe(false);
  });

  it("leaves the creator's permission page public", async () => {
    expect((await api("GET", "/permission/req-riverside-poetry-0919", { as: null })).status).toBe(200);
  });
});

describe("the board", () => {
  it("is the frame's Inland Empire: the slots, the holds and the stats", async () => {
    const tv = MarketBoardX.parse((await api("GET", "/admin/markets/inland-empire/board", { query: { band: "tv" } })).json);
    const radio = MarketBoardX.parse((await api("GET", "/admin/markets/inland-empire/board", { query: { band: "radio" } })).json);
    expect(tv.slots).toHaveLength(68);
    expect(radio.slots).toHaveLength(100);
    const slot = (b: typeof tv, major: number) => b.slots.find((s) => s.major === major)!;
    expect(slot(tv, 9).stations.map((s) => s.callSign)).toEqual(["RDLS", "COLT", "SBCO"]);
    expect(slot(tv, 33)).toMatchObject({ state: "claimable", signOnAt: "2026-09-28T13:00:00.000Z", creatorId: LUPE });
    expect([slot(tv, 41).heldFor, slot(tv, 44).heldFor, slot(tv, 52).heldFor, slot(radio, 955).heldFor]).toEqual(["TACO", "SKAT", "HOOP", "GOSP"]);
    expect(slot(tv, 60).state).toBe("catalog");
    expect(tv.stats.market).toMatchObject({ localShareOfTonightPercent: 71, claimableOnAir: 2 });
    expect(tv.stats.saidYesNotSetUp).toBe(4);
    expect(tv.stats.waitlistHere).toBe(26);
    expect(radio.stats.deadAirComing.map((s) => s.callSign)).toEqual(["HALL"]);
  });

  it("has nothing on Los Angeles yet", async () => {
    const tv = MarketBoardX.parse((await api("GET", "/admin/markets/los-angeles/board")).json);
    expect(tv.slots.every((s) => s.state === "open")).toBe(true);
    expect(tv.stats.localShareOfTonightPercent).toBeNull();
  });
});

describe("a creator, found to claimed", () => {
  it("asks, hears yes, sets up from a recipe, signs on and is claimed", async () => {
    // Found.
    expect((await creator(SKATE)).stage).toBe("found");
    const works = (await api("GET", `/admin/creators/${SKATE}/works`)).json as Array<{ id: string; leftOutReason: string | null }>;
    expect(works).toHaveLength(14);
    const ticked = works.filter((w) => !w.leftOutReason).map((w) => w.id);
    // Asked.
    const asked = await api("POST", `/admin/creators/${SKATE}/permission-requests`, { body: { sentVia: ["Vimeo message", "hello@desertskate.example"], note: "Hello", workIds: ticked } });
    expect(asked.status).toBe(201);
    expect(asked.json.link).toMatch(/\/permission\/mk\./);
    expect(await creator(SKATE)).toMatchObject({ stage: "asked", nextActionDue: "2026-10-03" });
    // The link carries the page to the viewer's mock (two origins, two mocks): its facts read back.
    const token = asked.json.link.split("/permission/")[1] as string;
    const b64 = token.slice(3).replace(/-/g, "+").replace(/_/g, "/");
    const seed = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0))));
    expect(seed).toMatchObject({ d: "Desert Skate Films", s: "vimeo", b: "tv", c: "38.1", n: "Hello", m: "Inland Empire" });
    expect(seed.w.filter((w: unknown[]) => w[3]).length).toBe(13);
    // Said yes, from the link (public).
    const yes = await api("POST", `/permission/${token}/answer`, { as: null, body: { answer: "yes" } });
    expect(yes.json.answer).toMatchObject({ answer: "yes", works: 13 });
    expect((await api("POST", `/permission/${token}/answer`, { as: null, body: { answer: "no" } })).json.error.code).toBe("already_answered");
    expect((await creator(SKATE)).stage).toBe("said_yes");
    const covered = (await api("GET", `/admin/creators/${SKATE}/works`)).json.filter((w: { covered: string }) => w.covered === "permission");
    expect(covered).toHaveLength(13);
    // Set up from a recipe.
    const recipes = (await api("GET", "/admin/recipes")).json as Array<{ id: string; name: string }>;
    const films = recipes.find((r) => r.name === "Films and video")!;
    const body = { recipeId: films.id, marketId: IE, band: "tv", channel: "38.1", callSign: "DSF", name: "Desert Skate Films", colour: "#1F5E8C", operatorUserId: DEE, signOnAt: "2026-09-28T13:00:00.000Z" };
    const made = await api("POST", `/admin/creators/${SKATE}/station`, { body });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ station: { callSign: "DSF", channel: "38.1", kind: "claimable" }, importable: 13 });
    // Asked again: the API checks the stage first, so a station that's set up says no permission (as the API does).
    expect((await api("POST", `/admin/creators/${SKATE}/station`, { body })).json.error.code).toBe("no_permission");
    const setUp = await creator(SKATE);
    expect(setUp).toMatchObject({ stage: "setting_up", setup: { callSign: "DSF", importTotal: 13, operator: { name: "Dee A." } } });
    const tv = MarketBoardX.parse((await api("GET", "/admin/markets/inland-empire/board")).json);
    expect(tv.slots.find((s) => s.major === 38)).toMatchObject({ state: "claimable", status: "Signs on" });
    // On air, not claimed: the sign-on time comes.
    vi.setSystemTime(new Date("2026-09-28T13:00:05Z"));
    expect((await creator(SKATE)).stage).toBe("on_air");
    const held = HeldEarningsX.parse((await api("GET", "/admin/held-earnings")).json);
    expect(held.stations.find((s) => s.station.callSign === "DSF")).toMatchObject({ status: "on_air", onAirSince: "2026-09-28T13:00:00.000Z" });
    // Claimed (mock mode's other side: the claim, then the verifiers and 72 hours).
    await api("POST", `/__mock/desk/creators/${SKATE}/claim`, { body: {} });
    expect(HeldEarningsX.parse((await api("GET", "/admin/held-earnings")).json).stations.find((s) => s.station.callSign === "DSF")!.status).toBe("claim_pending");
    await api("POST", `/__mock/desk/creators/${SKATE}/claim-complete`, { body: {} });
    expect((await creator(SKATE)).stage).toBe("claimed");
    expect(HeldEarningsX.parse((await api("GET", "/admin/held-earnings")).json).stations.some((s) => s.station.callSign === "DSF")).toBe(false);
  });

  it("never asks after a no", async () => {
    const r = await api("POST", `/admin/creators/${JAZZ}/permission-requests`, { body: { sentVia: ["Bandcamp message"] } });
    expect(r.status).toBe(422);
    expect(r.json.error).toMatchObject({ code: "do_not_ask", message: "They said no. Don't ask again." });
  });

  it("won't set up before a yes, on a held channel, or with a taken call sign", async () => {
    const recipe = (await api("GET", "/admin/recipes")).json[0].id;
    const base = { recipeId: recipe, marketId: IE, band: "radio", name: "Inland Gospel Choirs", operatorUserId: DEE };
    expect((await api("POST", `/admin/creators/${SKATE}/station`, { body: { ...base, band: "tv", channel: "38.1", callSign: "DSF" } })).json.error.code).toBe("no_permission");
    expect((await api("POST", `/admin/creators/${GOSPEL}/station`, { body: { ...base, channel: "95.5", callSign: "INGC" } })).json.error).toMatchObject({ code: "channel_held", message: "The waitlist holds 95.5 for GOSP. Pick another." });
    expect((await api("POST", `/admin/creators/${GOSPEL}/station`, { body: { ...base, channel: "95.7", callSign: "LUPE" } })).json.error.code).toBe("call_sign_taken");
    expect((await api("POST", `/admin/creators/${GOSPEL}/station`, { body: { ...base, channel: "95.6", callSign: "INGC" } })).json.error.code).toBe("bad_channel");
    expect((await api("POST", `/admin/creators/${GOSPEL}/station`, { body: { ...base, channel: "95.7", callSign: "INGC" } })).status).toBe(201);
  });

  it("sends one reminder, then only No answer is left", async () => {
    const POETRY = U(204);
    expect((await api("POST", `/admin/creators/${POETRY}/reminders`)).status).toBe(201);
    expect(await creator(POETRY)).toMatchObject({ remindedAt: NOW.toISOString(), nextActionDue: "2026-10-03" });
    expect((await api("POST", `/admin/creators/${POETRY}/reminders`)).json.error.code).toBe("reminded");
    expect((await api("PATCH", `/admin/creators/${POETRY}`, { body: { stage: "no_answer" } })).json.stage).toBe("no_answer");
  });

  it("adds a creator as Found, checked against the contract", async () => {
    expect((await api("POST", "/admin/creators", { body: { marketId: IE, displayName: "", sourcePlatform: "youtube", sourceUrl: "nope" } })).status).toBe(400);
    const r = await api("POST", "/admin/creators", { body: { marketId: IE, displayName: "Beaumont Bakers", sourcePlatform: "youtube", sourceUrl: "https://www.youtube.com/@beaumontbakers" } });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ stage: "found", works: 0, doNotAsk: false });
  });
});

describe("listed sources and held earnings", () => {
  it("lists a source on the dial, and finds its calendar or doesn't", async () => {
    const ok = await api("POST", "/admin/listed-sources", { body: { marketId: IE, band: "tv", channel: "9.4", callSign: "RIAL", name: "City of Rialto", streamUrl: "https://rialto.example.gov/live", embedTerms: "allowed", calendarUrl: "https://rialto.example.gov/agenda.ics" } });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ listingState: "listed", calendarSync: "synced", station: { channel: "9.4", kind: "listed" } });
    const unclear = await api("POST", "/admin/listed-sources", { body: { marketId: IE, band: "tv", channel: "9.5", callSign: "FONT", name: "City of Fontana", streamUrl: "https://fontana.example.gov/live", embedTerms: "unclear", calendarUrl: "https://fontana.example.gov/agenda" } });
    expect(unclear.json).toMatchObject({ listingState: "checking", calendarSync: "calendar_not_found" });
    expect((await api("POST", "/admin/listed-sources", { body: { marketId: IE, band: "tv", channel: "12.1", callSign: "XXXX", name: "Taken", streamUrl: "https://x.example/live", embedTerms: "allowed" } })).status).toBe(409);
  });

  it("holds $227.00 across CRAT and FLDR, and never moves any to Opencast", async () => {
    const h = HeldEarningsX.parse((await api("GET", "/admin/held-earnings")).json);
    expect(h.totalHeldMicros).toBe(227_000_000);
    expect(h.everMovedToOpencastMicros).toBe(0);
    expect(h.stations.map((s) => [s.station.callSign, s.escrowStationId, s.status])).toEqual([
      ["CRAT", 101, "claim_link_sent"],
      ["FLDR", 91, "invited"],
      ["LUPE", 33, "not_on_air_yet"]
    ]);
  });
});
