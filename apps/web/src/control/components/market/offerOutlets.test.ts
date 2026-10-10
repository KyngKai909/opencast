// Programming Phase 6: a carriage offer names where carriers can send it, Opencast always on. The
// form's body carries the outlets; the pane says them; the mock keeps them, as the API does, with
// Opencast put back in and Opencast and relays when an offer doesn't say.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getResponse, type HttpHandler } from "msw";
import { outletsWords, termsFromDraft } from "./OfferForm";

const NOW = new Date("2026-09-27T03:42:12Z");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const draft = {
  barter: true,
  barterFill: "2:00",
  cash: false,
  cashPrice: "$3.00",
  cpb: false,
  cpbFill: "1:00",
  cpbPrice: "$1.50",
  airings: "3" as const,
  liveOnly: false,
  approval: "i_approve" as const,
  outlets: ["opencast" as const, "relays" as const]
};

describe("the offer form's outlets", () => {
  it("go in the body, Opencast always among them", () => {
    const relays = termsFromDraft(draft);
    expect("body" in relays && relays.body.outlets).toEqual(["opencast", "relays"]);
    const only = termsFromDraft({ ...draft, outlets: [] });
    expect("body" in only && only.body.outlets).toEqual(["opencast"]);
    const more = termsFromDraft({ ...draft, outlets: ["other_apps", "fast"] });
    expect("body" in more && more.body.outlets).toEqual(["opencast", "other_apps", "fast"]);
  });

  it("read in the pane as words", () => {
    expect(outletsWords([])).toBe("Opencast only");
    expect(outletsWords(["opencast", "relays"])).toBe("Opencast and Relays");
    expect(outletsWords(["relays", "other_apps"])).toBe("Opencast, Other apps and Relays");
  });
});

describe("the market mock", () => {
  let handlers: HttpHandler[];
  let db: typeof import("../../mocks/db");
  let market: typeof import("../../mocks/fixtures/market");

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    db = await import("../../mocks/db");
    market = await import("../../mocks/fixtures/market");
    handlers = (await import("../../mocks/handlers/market")).marketHandlers;
  });

  beforeEach(() => {
    localStorage.clear();
    db.resetDb();
    market.resetMarket();
  });

  async function api(method: string, path: string, body?: unknown) {
    const req = new Request(`http://localhost/v1${path}`, { method, headers: { authorization: "Bearer mock-access-token:kai@example.com", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const res = await getResponse(handlers, req);
    if (!res) throw new Error(`No mock for ${method} ${path}`);
    return { status: res.status, json: await res.json() };
  }

  it("keeps an offer's outlets, and narrows them on a change", async () => {
    const terms = { termsOffered: ["barter"], cashPriceMicros: null, cashPriceUnit: null, barterMakerMsPerHour: 120_000, airingsPerEpisode: 3, windowDays: 7, liveOnly: false, noticeDays: 7, approval: "i_approve", radioBandAllowed: true };
    const offered = await api("POST", `/programs/${U(280003)}/offer`, terms);
    expect(offered.status).toBe(201);
    expect(offered.json.outlets).toEqual(["opencast", "relays"]);
    const narrowed = await api("PATCH", `/catalog/offers/${offered.json.id}`, { outlets: [] });
    expect(narrowed.json.outlets).toEqual(["opencast"]);
  });
});
