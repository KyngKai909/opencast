// "Tuning sound" (viewer you 01, tv-update 04.1): kept with the account's watching settings, off for
// video and on for the radio band unless set. The contracts' `watching` drops keys it doesn't
// know, so these are typed there (added 2026-09-29).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User;

beforeAll(async () => {
  h = await createHarness();
  kai = await h.signIn("Kai");
}, 60_000);
afterAll(() => h.close());

describe("tuning sound", () => {
  it("isn't set until the viewer sets it, and then keeps both bands with the other watching settings", async () => {
    const before = await kai.get("/v1/me").expect(200);
    expect(before.body.settings.watching?.tuningSound).toBeUndefined();
    await kai.patch("/v1/me", { settings: { watching: { captions: "on", tuningSound: true, radioTuningSound: false } } }).expect(200);
    const after = await kai.get("/v1/me").expect(200);
    expect(after.body.settings.watching).toMatchObject({ captions: "on", tuningSound: true, radioTuningSound: false });
    await kai.patch("/v1/me", { settings: { watching: { tuningSound: "loud" } } }).expect(400);
  });
});
