// @vitest-environment node
// A242 (2026-10-02) on the mocks, as the API: openers, closers and off-air cards as library types.
// `code` keeps the old code beside `identCode`; a picture is an off-air card only; the log refuses them.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { getDb, resetDb } from "../db";
import { MOCK_TOKEN_PREFIX } from "../../../auth/mockToken";
import { resetLive } from "../fixtures/live";
import { BEAT } from "../fixtures/stations";
import { handlers } from "./index";
import { typed } from "./library";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  resetLive();
});

async function api(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${MOCK_TOKEN_PREFIX}kai@example.com` };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`http://localhost/v1${path}`, { method: init.method ?? "GET", headers, body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)) });
  return { status: res.status, body: await res.json() };
}
const S = `/stations/${BEAT.id}`;

describe("openers, closers and off-air cards in the mock library", () => {
  it("keeps the old code beside identCode", () => {
    expect(typed("OPN")).toEqual({ code: "SID", identCode: "OPN" });
    expect(typed("CLS")).toEqual({ code: "SID", identCode: "CLS" });
    expect(typed("OFF")).toEqual({ code: "OPEN", identCode: "OFF" });
    expect(typed("BMP")).toEqual({ code: "BMP", identCode: null });
  });

  it("lists each type by its code", async () => {
    const r = await api(`${S}/library?code=OFF`);
    expect(r.body.items.map((i: { title: string }) => i.title)).toEqual(["BEAT test card"]);
  });

  it("takes a picture only as an off-air card", async () => {
    const card = new FormData();
    card.set("file", new File([new Uint8Array(1024)], "night-card.png", { type: "image/png" }));
    card.set("code", "OFF");
    const r = await api(`${S}/library/uploads`, { method: "POST", form: card });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ title: "Night card", code: "OPEN", identCode: "OFF", still: true });
    const bumper = new FormData();
    bumper.set("file", new File([new Uint8Array(1024)], "night-card.png", { type: "image/png" }));
    expect((await api(`${S}/library/uploads`, { method: "POST", form: bumper })).status).toBe(415);
    // A picture can't become anything else.
    expect((await api(`/library/${r.body.id}`, { method: "PATCH", body: { code: "BMP" } })).status).toBe(422);
  });

  it("marks an upload as an opener", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(1024)], "sign-on.mp4", { type: "video/mp4" }));
    form.set("code", "OPN");
    const r = await api(`${S}/library/uploads`, { method: "POST", form });
    expect(r.body).toMatchObject({ code: "SID", identCode: "OPN" });
  });

  it("keeps them off the log", async () => {
    const opener = getDb().library.items.find((i) => i.stationId === BEAT.id && i.identCode === "OPN")!;
    const r = await api(`${S}/log`, { method: "POST", body: { kind: "program", startsAt: "2026-09-28T03:00:00.000Z", itemId: opener.id } });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("not_for_the_log");
  });
});
