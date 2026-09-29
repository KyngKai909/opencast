// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { approveAll, makeCode, signInHandlers } from "./signIn";

const server = setupServer(...signInHandlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

async function api(path: string, method = "GET", token?: string) {
  const res = await fetch(`http://localhost/v1${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: await res.json() };
}

describe("TV sign-in by code, mocked (B2)", () => {
  it("gives the frame's code first, then new ones, never 0/O or 1/I", () => {
    expect(makeCode(() => false)).toBe("K7Q4MP");
    const c = makeCode((x) => x === "K7Q4MP", () => 0.5);
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it("creates a code whose QR opens the viewer's /tv page, pending until a phone approves it", async () => {
    const created = await api("/tv/codes", "POST");
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: "K7Q4MP", enterAt: "useopencast.org/tv", pollSeconds: 2 });
    expect(created.body.qrUrl).toMatch(/\/tv\?code=K7Q4MP$/);
    expect((await api(`/tv/codes/${created.body.pollToken}`)).body).toEqual({ status: "pending" });
    expect(approveAll()).toBe(1);
    expect((await api(`/tv/codes/${created.body.pollToken}`)).body).toEqual({ status: "approved", token: "mock-access-token", signedInAs: "Kai M." });
  });

  it("doesn't know a made-up poll token", async () => {
    const r = await api("/tv/codes/poll-nope");
    expect(r.status).toBe(404);
  });

  it("signs this TV out only with its session", async () => {
    expect((await api("/tv/session", "DELETE")).status).toBe(401);
    expect((await api("/tv/session", "DELETE", "mock-access-token")).body).toEqual({ ok: true });
  });
});

describe("the market from the connection, mocked (S10)", () => {
  it("is the Inland Empire, with the nearest others", async () => {
    const r = await api("/markets/by-connection");
    expect(r.body.market).toMatchObject({ slug: "inland-empire", name: "Inland Empire" });
    expect(r.body.nearby.map((n: { market: { slug: string } }) => n.market.slug)).not.toContain("inland-empire");
  });
});
