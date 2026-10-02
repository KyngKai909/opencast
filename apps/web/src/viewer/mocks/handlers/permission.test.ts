// The permission page's mock (network-desk 06): public to read and answer, one answer only, stop
// from the link, claim needs sign-in, and links from the desk's mock read back.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getResponse } from "msw";
import { MOCK_TOKEN } from "../../../auth/mockToken";

let handlers: typeof import("./permission").permissionHandlers;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-27T03:42:00Z") });
  handlers = (await import("./permission")).permissionHandlers;
});
beforeEach(() => localStorage.clear());

async function api(method: string, path: string, body?: unknown, signedIn = false) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signedIn) headers.authorization = `Bearer ${MOCK_TOKEN}`;
  const res = await getResponse(handlers, new Request(`http://localhost/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  if (!res) throw new Error(`No mock for ${method} ${path}`);
  return { status: res.status, json: await res.json() };
}

describe("the permission page", () => {
  it("is 06.1 unanswered, then 06.2 after yes, with no account", async () => {
    const t = "desert-skate-films-2026-0926";
    const before = await api("GET", `/permission/${t}`);
    expect(before.json).toMatchObject({ answer: null, creator: { displayName: "Desert Skate Films", sourcePlatform: "vimeo" }, proposed: { band: "tv" } });
    expect(before.json.works.filter((w: { included: boolean }) => w.included)).toHaveLength(13);
    const after = await api("POST", `/permission/${t}/answer`, { answer: "yes" });
    expect(after.json.answer).toMatchObject({ answer: "yes", works: 13 });
    expect((await api("GET", `/permission/${t}`)).json.answer.answer).toBe("yes");
  });

  it("takes one answer only", async () => {
    const t = "desert-skate-films-said-yes";
    const again = await api("POST", `/permission/${t}/answer`, { answer: "no" });
    expect(again.status).toBe(422);
    expect(again.json.error).toMatchObject({ code: "already_answered", message: "This has been answered. Write to us to change it." });
  });

  it("stops from the link (B8), only after a yes", async () => {
    expect((await api("POST", "/permission/desert-skate-films-2026-0926/stop")).status).toBe(422);
    const r = await api("POST", "/permission/desert-skate-films-said-yes/stop");
    expect(r.json.stoppedAt).toBe("2026-09-27T03:42:00.000Z");
  });

  it("claims from the link (B8) only when signed in, before or after the station exists, once", async () => {
    expect((await api("POST", "/permission/desert-skate-films-said-yes/claim")).status).toBe(401);
    expect((await api("POST", "/permission/desert-skate-films-said-yes/claim", undefined, true)).json.claim.status).toBe("verifying");
    const lupe = (await api("GET", "/permission/tia-lupes-kitchen-2026-0922")).json;
    expect(lupe.station.callSign).toBe("LUPE");
    const c = await api("POST", "/permission/tia-lupes-kitchen-2026-0922/claim", undefined, true);
    expect(c.json.claim.status).toBe("verifying");
    const again = await api("POST", "/permission/tia-lupes-kitchen-2026-0922/claim", undefined, true);
    expect(again.status).toBe(422);
    expect(again.json.error.code).toBe("in_progress");
  });

  it("reads back a link from the desk's mock, and turns away one it doesn't know", async () => {
    const seed = { d: "Chino Hills Birding", p: null, s: "vimeo", b: "tv", c: "57.1", n: "Hi", w: [["00000000-0000-4000-8000-000000010001", "Bird walk 1", 1_320_000, true, null, null, "video"], ["00000000-0000-4000-8000-000000010002", "Bird walk 2", 1_320_000, false, "Not theirs", null, "video"]], m: "Inland Empire" };
    const bytes = new TextEncoder().encode(JSON.stringify(seed));
    const token = `mk.${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    const page = await api("GET", `/permission/${token}`);
    expect(page.json).toMatchObject({ creator: { displayName: "Chino Hills Birding" }, proposed: { band: "tv", channel: "57.1" }, marketName: "Inland Empire" });
    expect(page.json.works.map((w: { included: boolean }) => w.included)).toEqual([true, false]);
    expect((await api("GET", "/permission/not-a-real-link-at-all")).status).toBe(404);
  });
});
