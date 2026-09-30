// The desk mock's Settings and catalog shelf answer as the API does: the team reads, admins change
// rules and the team, rights reviewers check; a change never takes effect before today; a signer
// change waits for the other admins; the second check is someone else's; only double-checked items
// go into episodes; a failed item comes out of every episode, and only those are rebuilt.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpHandler } from "msw";
import { apiFor } from "../testApi";
import { catalogShelfApi, deskApi } from "@opencast/contracts";

const NOW = new Date("2026-09-27T03:42:12Z");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RAE = "rae@opencast.example";
const LEE = "lee@opencast.example";
const SAM = "sam@opencast.example";
const CARTOONS = U(7102);

let handlers: HttpHandler[];
let settings: typeof import("../settingsDb");
let api: ReturnType<typeof apiFor>;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  settings = await import("../settingsDb");
  handlers = (await import("./index")).handlers;
  api = apiFor(handlers);
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  localStorage.clear();
  settings.resetSettings();
});

describe("Settings on the mocks", () => {
  it("lets the team read and only admins change", async () => {
    expect((await api("GET", "/admin/rules", { as: "other" })).status).toBe(403);
    const rules = await api("GET", "/admin/rules", { as: RAE });
    expect(rules.status).toBe(200);
    const list = deskApi.listRules.response.parse(rules.json);
    expect(list.canEdit).toBe(false);
    expect(list.rules.find((r) => r.key === "rights.public_domain_us")?.current.display).toBe("1930");
    expect(list.rules.find((r) => r.key === "prices.storage")?.current).toMatchObject({ display: "Not set yet", set: false });
    const denied = await api("POST", "/admin/rules/rights.repeat_limit/versions", { as: RAE, body: { value: { upheldIn12Months: 2 }, effectiveFrom: "2026-10-01" } });
    expect(denied).toMatchObject({ status: 403, json: { error: { code: "desk_role" } } });
  });

  it("sets a rule from a date, never before today, and logs it", async () => {
    const back = await api("POST", "/admin/rules/shares.opencast/versions", { body: { value: { spotBps: 1000, pledgeBps: 0, productionBps: 0 }, effectiveFrom: "2026-09-01" } });
    expect(back.json.error.code).toBe("retroactive");
    const set = await api("POST", "/admin/rules/shares.opencast/versions", { body: { value: { spotBps: 1000, pledgeBps: 0, productionBps: 0 }, effectiveFrom: "2026-11-01", note: "October review" } });
    expect(set.status).toBe(200);
    expect(set.json.next).toMatchObject({ display: "10% of spots, 0% of pledges, 0% of production", effectiveFrom: "2026-11-01T00:00:00.000Z" });
    expect((await api("GET", "/admin/rules/shares.opencast/value", { query: { at: "2026-11-02T00:00:00.000Z" } })).json.value).toEqual({ spotBps: 1000, pledgeBps: 0, productionBps: 0 });
    const log = deskApi.changeLog.response.parse((await api("GET", "/admin/change-log", { query: { kind: "rule" } })).json);
    expect(log[0]).toMatchObject({ summary: "Opencast's share of spots and sponsorships: 0%, not set yet to 10% of spots, 0% of pledges, 0% of production", by: { name: "Dee A." }, note: "October review" });
  });

  it("changes the team's roles, never the last admin", async () => {
    const team = deskApi.getTeam.response.parse((await api("GET", "/admin/desk/team")).json);
    expect(team.people.map((p) => [p.name, p.roles.map((r) => r.role)])).toEqual([
      ["Dee A.", ["admin"]],
      ["Sam K.", ["admin"]],
      ["Lee R.", ["market_lead"]],
      ["Rae T.", ["rights_reviewer"]]
    ]);
    const made = await api("PUT", `/admin/desk/team/${U(903)}`, { body: { roles: [{ role: "market_lead", marketId: U(90001) }] } });
    expect(made.status).toBe(200);
    expect((await api("GET", "/me", { as: LEE })).json.deskRoles).toEqual([{ role: "market_lead", market: expect.objectContaining({ slug: "inland-empire" }) }]);
    await api("PUT", `/admin/desk/team/${U(901)}`, { body: { roles: [] } });
    const last = await api("PUT", `/admin/desk/team/${U(900)}`, { body: { roles: [] } });
    expect(last.json.error.code).toBe("last_admin");
  });

  it("needs every other admin's approval for a signer change", async () => {
    const p = await api("POST", "/admin/escrow/signer-proposals", { body: { kind: "add", newAddress: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" } });
    expect(p.status).toBe(200);
    expect(p.json).toMatchObject({ status: "open", thresholdAfter: 2, signersAfter: expect.arrayContaining(["0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"]), canWithdraw: true });
    expect((await api("POST", `/admin/escrow/signer-proposals/${p.json.id}/decision`, { body: { decision: "approve" } })).status).toBe(403);
    const ok = await api("POST", `/admin/escrow/signer-proposals/${p.json.id}/decision`, { as: SAM, body: { decision: "approve" } });
    expect(ok.json.status).toBe("approved");
    const signers = deskApi.getSigners.response.parse((await api("GET", "/admin/escrow/signers")).json);
    expect(signers.approved?.id).toBe(p.json.id);
    expect(signers.signers).toHaveLength(3);
  });
});

describe("the catalog shelf on the mocks", () => {
  it("draws the reference's shelf", async () => {
    const shelf = catalogShelfApi.getShelf.response.parse((await api("GET", "/admin/catalog/shelf")).json);
    expect(shelf.stats).toEqual({ itemsPassed: 312, readyMs: expect.any(Number), carrierStations: 21, carrierMarkets: 3, awaitingSecondCheck: 7 });
    expect(shelf.series.map((s) => [s.title, s.basisLabel, s.episodesReady, s.episodesTotal, s.carriers, s.state])).toEqual([
      ["Nights at the observatory", "US government work", 12, 12, 14, "offered"],
      ["Cartoons, 1928 to 1936", "Mixed, per short", 40, 40, 12, "offered"],
      ["National parks on film", "US government work", 18, 18, 8, "offered"],
      ["Newsreels, 1930 to 1950", "Mixed, per reel", 26, 26, 5, "offered"],
      ["The mystery hour", "Per show, still checking", 44, 60, 6, "in_review"],
      ["Licensed catalogs", "Licence", 0, 0, 0, "coming"]
    ]);
    const series = catalogShelfApi.getSeries.response.parse((await api("GET", `/admin/catalog/series/${CARTOONS}`)).json);
    expect(series.episodes[0]!.items.map((i) => [i.title, i.position, i.removedReason])).toEqual([
      ["River Rhythms", 1, null],
      ["The Paddle Wheel Parade", 2, null],
      ["Steam and Song", 3, null],
      ["Harbor Lights Frolic", 4, null],
      ["Down the River", null, "Renewal found in 1962"]
    ]);
  });

  it("checks an item twice, the second time by someone else", async () => {
    const added = await api("POST", `/admin/catalog/series/${CARTOONS}/items`, { body: { libraryItemId: U(7701), source: "1933, original print, Library of Congress", publishedYear: 1933 } });
    expect(added.status).toBe(200);
    const id = added.json.id as string;
    expect(added.json.checklist.find((l: { line: string }) => l.line === "renewal")).toMatchObject({ state: "todo", help: "Renewal would have been due in 1960 or 1961. Search the Copyright Office renewal records for the title and studio" });
    expect((await api("POST", `/admin/catalog/items/${id}/send`)).json.error.code).toBe("evidence_missing");
    for (const line of ["source", "published", "renewal", "soundtrack", "trademarks"]) {
      const res = await api("PUT", `/admin/catalog/items/${id}/checks/${line}`, { body: { state: line === "trademarks" ? "warn" : "ok", record: "Checked" } });
      expect(res.status).toBe(200);
    }
    const sent = await api("POST", `/admin/catalog/items/${id}/send`);
    expect(sent.json).toMatchObject({ state: "second_check", basis: "not_renewed", firstCheck: { by: { name: "Dee A." } } });
    expect((await api("POST", `/admin/catalog/items/${id}/second-check`, { body: { decision: "confirm" } })).json.error.code).toBe("same_person");
    expect((await api("POST", `/admin/catalog/items/${id}/second-check`, { as: LEE, body: { decision: "confirm" } })).status).toBe(403);
    const confirmed = await api("POST", `/admin/catalog/items/${id}/second-check`, { as: RAE, body: { decision: "confirm" } });
    expect(confirmed.json).toMatchObject({ state: "passed", secondCheck: { by: { name: "Rae T." } } });
  });

  it("puts only double-checked items in episodes, and rebuilds only what a failure touched", async () => {
    const draft = await api("POST", `/admin/catalog/series/${CARTOONS}/items`, { body: { libraryItemId: U(7702), source: "1929, original print", publishedYear: 1929 } });
    const refused = await api("PUT", `/admin/catalog/series/${CARTOONS}/episodes/15`, { body: { itemIds: [draft.json.id, U(7301)] } });
    expect(refused.json.error.code).toBe("not_passed");
    const ep15 = await api("PUT", `/admin/catalog/series/${CARTOONS}/episodes/15`, { body: { itemIds: [U(7303)] } });
    expect(ep15.json.status).toBe("draft");
    const built = await api("POST", `/admin/catalog/series/${CARTOONS}/rebuild`);
    expect(built.json.episodes.map((e: { number: number }) => e.number)).toEqual([15]);
    const failed = await api("POST", `/admin/catalog/items/${U(7302)}/fail`, { as: RAE, body: { reason: "A rights claim, upheld" } });
    expect(failed.json.rebuild).toMatchObject({ reason: "A rights claim, upheld", episodes: [{ number: 14, fromVersion: 2, toVersion: 3 }] });
    const series = catalogShelfApi.getSeries.response.parse((await api("GET", `/admin/catalog/series/${CARTOONS}`)).json);
    expect(series.episodes.find((e) => e.number === 14)!.items.filter((i) => i.position !== null).map((i) => i.title)).toEqual(["River Rhythms", "Steam and Song", "Harbor Lights Frolic"]);
    expect(series.episodes.find((e) => e.number === 15)!.version).toBe(1);
  });
});
