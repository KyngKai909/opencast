// The desk mock's rights claims answer as the API does (desk-pages 01): every station's claims for
// admins and rights reviewers, a market lead's own market only; the figures; each claim's timeline
// and carriers (an agreement with nothing scheduled counts); a privacy complaint with no answer
// window; and outcomes recorded by a rights reviewer or an admin, once.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpHandler } from "msw";
import { trustApi, type DeskClaims } from "@opencast/contracts";
import { apiFor } from "../testApi";

const NOW = new Date("2026-09-27T03:42:12Z");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RAE = "rae@opencast.example";
const LEE = "lee@opencast.example";
const HD = U(90003);
const IE = U(90001);
const LATE_CRATE = U(8101);
const HARBOR = U(8103);
const COUNCIL = U(8104);

let handlers: HttpHandler[];
let claims: typeof import("../claimsDb");
let settings: typeof import("../settingsDb");
let api: ReturnType<typeof apiFor>;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  claims = await import("../claimsDb");
  settings = await import("../settingsDb");
  handlers = (await import("./index")).handlers;
  api = apiFor(handlers);
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  localStorage.clear();
  settings.resetSettings();
  claims.resetClaims();
});

const list = async (as?: string, query?: Record<string, string>) => {
  const r = await api("GET", "/admin/claims", { as, query });
  return { status: r.status, body: r.status === 200 ? (trustApi.listDeskClaims.response.parse(r.json) as DeskClaims) : null, json: r.json };
};

describe("rights claims on the mocks", () => {
  it("lists every station's claims with the page's figures", async () => {
    const { body } = await list();
    expect(body!.claims.filter((c) => c.phase === "open").map((c) => c.item.title)).toEqual(["Council Watch, Sept 22", "Harbor Nights, ep. 2", "Tamales for forty, ep. 3", "Late Crate, ep. 9"]);
    expect(body!.stats).toEqual({ open: 4, offAir: 3, answersDue: 1, soonestAnswerDays: 2, carryingStations: 6, nearRepeatLimit: 0 });
    expect(body!.rules).toEqual({ repeatLimit: 3, answerDays: 14, counterNoticeBusinessDays: 10 });
    expect(body!.canResolve).toBe(true);
    expect(body!.stations.find((s) => s.station.callSign === "REEL")).toMatchObject({ open: 1, closed: 2, upheldLast12Months: 1, standing: "good" });
  });

  it("builds each claim's timeline and counts its carriers", async () => {
    const { body } = await list();
    const late = body!.claims.find((c) => c.id === LATE_CRATE)!;
    expect(late.carriers.map((k) => k.station.callSign)).toEqual(["REEL", "PREP", "VOZE"]);
    expect(late.timeline.map((s) => [s.step, s.state])).toEqual([
      ["received", "done"],
      ["off_air", "done"],
      ["answered", "done"],
      ["counter_notice", "done"],
      ["back_on_air", "done"],
      ["reply_due", "current"]
    ]);
    const harbor = body!.claims.find((c) => c.id === HARBOR)!;
    expect(harbor.carriers).toEqual([expect.objectContaining({ station: expect.objectContaining({ callSign: "PREP" }), airingsPulled: 0, pulledAt: null })]);
    expect(harbor.next).toEqual({ kind: "answer", at: "2026-10-06T18:00:00.000Z" });
    const council = body!.claims.find((c) => c.id === COUNCIL)!;
    expect(council).toMatchObject({ kind: "privacy", daysToAnswer: null, next: { kind: "review", at: null } });
    expect(council.carriers).toHaveLength(6);
    expect(council.timeline.map((s) => s.step)).toEqual(["received", "off_air", "review"]);
  });

  it("shows a market lead their own market only, and no outcomes", async () => {
    const lee = await list(LEE);
    expect(lee.body!.claims.map((c) => c.station.callSign)).toEqual(["MOJV"]);
    expect(lee.body!.canResolve).toBe(false);
    expect((await list(LEE, { marketId: HD })).status).toBe(200);
    const other = await list(LEE, { marketId: IE });
    expect(other.status).toBe(403);
    expect(other.json.error.code).toBe("desk_role");
    expect((await list("other")).status).toBe(403);
    expect((await list(null as unknown as string)).status).toBe(401);
    const tried = await api("POST", `/claims/${HARBOR}/resolve`, { as: LEE, body: { outcome: "withdrawn" } });
    expect(tried.status).toBe(403);
  });

  it("records an outcome once: upheld counts toward the repeat limit, restored brings it back everywhere", async () => {
    const upheld = await api("POST", `/claims/${HARBOR}/resolve`, { as: RAE, body: { outcome: "upheld" } });
    expect(upheld.status).toBe(200);
    expect(upheld.json).toMatchObject({ state: "upheld", kind: "copyright" });
    expect((await api("POST", `/claims/${HARBOR}/resolve`, { as: RAE, body: { outcome: "restored" } })).status).toBe(409);
    const restored = await api("POST", `/claims/${COUNCIL}/resolve`, { as: RAE, body: { outcome: "restored" } });
    expect(restored.status).toBe(200);
    const { body } = await list();
    expect(body!.stations.find((s) => s.station.callSign === "REEL")).toMatchObject({ upheldLast12Months: 2, standing: "near_limit" });
    expect(body!.stats.nearRepeatLimit).toBe(1);
    const council = body!.claims.find((c) => c.id === COUNCIL)!;
    expect(council.phase).toBe("closed");
    expect(council.timeline.map((s) => s.step)).toEqual(["received", "off_air", "restored", "back_on_air"]);
    expect(council.carriers.every((k) => k.restoredAt)).toBe(true);
  });
});
