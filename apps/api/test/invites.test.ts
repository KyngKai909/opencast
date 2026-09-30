// Invites that reach people: each kind's email links to the app it's accepted in, resending sends
// again (10 minutes apart at least), accepting needs the invited email on the account, and the
// link's page reads the invite. Notices' emails link into the right app too.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { anon, createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User; // owns BEAT
let jess: User; // owns Orange Street Coffee
let stationId: string;
let businessId: string;

const APP = "https://app.opencast.test";
const BIZ = "https://business.opencast.test";
const MIN = 60_000;
const DAY = 86_400_000;

beforeAll(async () => {
  h = await createHarness();
  const m = await market(h);
  kai = await h.signIn("Kai", { linked: [{ kind: "email", value: "kai@example.com" }] });
  jess = await h.signIn("Jess Lin", { linked: [{ kind: "email", value: "jess@orangestreet.example" }] });
  stationId = (await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: m.id, tenths: 121 })).id;
  const business = await jess
    .post("/v1/businesses", {
      name: "Orange Street Coffee",
      category: "Coffee and food",
      customersWhere: "location",
      locations: [{ kind: "location", streetAddress: "204 Orange St", city: "Redlands", latitude: 34.0558, longitude: -117.1817 }],
      marketIds: [m.id]
    })
    .expect(201);
  businessId = business.body.id;
}, 60_000);
afterAll(() => h.close());

const emailsTo = (to: string) => h.sent.filter((s) => s.channel === "email" && s.to === to);

async function inviteToStation(email: string, role: "operator" | "host" = "operator") {
  const res = await kai.post(`/v1/stations/${stationId}/team/invites`, { email, role }).expect(200);
  await h.deps.bus.settle();
  return res.body.id as string;
}

async function inviteToBusiness(email: string, role: "manager" | "viewer" = "viewer") {
  const res = await jess.post(`/v1/businesses/${businessId}/team/invites`, { email, role }).expect((r) => expect([200, 201]).toContain(r.status));
  await h.deps.bus.settle();
  return res.body.id as string;
}

describe("the invite's email", () => {
  it("links a station invite to master control, and a business invite to the business app", async () => {
    const stationInvite = await inviteToStation("dee@example.com");
    const [toDee] = emailsTo("dee@example.com");
    expect(toDee).toMatchObject({ title: "Join Inland Beat on Opencast", link: `${APP}/control/invites/${stationInvite}`, key: `invite:${stationInvite}:${h.clock.now().toISOString()}` });
    expect(toDee!.body).toBe(
      "Kai invited you to Inland Beat's team on Opencast, as an operator. Operators run the station day to day, but not money or the team.\n\nSign in with this email address to join. The invite lasts a week."
    );

    const businessInvite = await inviteToBusiness("sam@orangestreet.example");
    const [toSam] = emailsTo("sam@orangestreet.example");
    expect(toSam).toMatchObject({ title: "Join Orange Street Coffee on Opencast", link: `${BIZ}/invites/${businessInvite}` });
    expect(toSam!.body).toMatch(/^Jess Lin invited you to Orange Street Coffee's team on Opencast, as a viewer\. Viewers see results and statements/);
  });

  it("sends nothing for a phone invite", async () => {
    const before = h.sent.length;
    await kai.post(`/v1/stations/${stationId}/team/invites`, { phone: "+15555550100", role: "host" }).expect(200);
    await h.deps.bus.settle();
    expect(h.sent.length).toBe(before);
  });
});

describe("resending", () => {
  it("sends the email again, not within 10 minutes of the last, and extends it a week", async () => {
    const id = await inviteToStation("again@example.com");
    const soon = await kai.post(`/v1/invites/${id}/resend`).expect(429);
    expect(soon.body.error).toMatchObject({ code: "resend_too_soon", message: "It went out less than a minute ago. You can send it again in 10 minutes." });
    h.clock.advance(4 * MIN);
    expect((await kai.post(`/v1/invites/${id}/resend`).expect(429)).body.error.message).toBe("It went out 4 minutes ago. You can send it again in 6 minutes.");

    h.clock.advance(7 * MIN);
    const resent = await kai.post(`/v1/invites/${id}/resend`).expect(200);
    expect(resent.body.expiresAt).toBe(new Date(h.clock.now().getTime() + 7 * DAY).toISOString());
    const sent = emailsTo("again@example.com");
    expect(sent).toHaveLength(2);
    expect(sent[1]!.link).toBe(`${APP}/control/invites/${id}`);
    // Each send is its own email to Resend: a new idempotency key.
    expect(sent[1]!.key).not.toBe(sent[0]!.key);

    // Only the owner resends.
    const stranger = await h.signIn();
    h.clock.advance(11 * MIN);
    await stranger.post(`/v1/invites/${id}/resend`).expect(404);
  });

  it("changes nothing when the email doesn't go, so it can be tried again at once", async () => {
    const id = await inviteToBusiness("flaky@orangestreet.example");
    h.clock.advance(11 * MIN);
    const [before] = await h.db.select().from(schema.invites).where(eq(schema.invites.id, id));
    const email = h.deps.notifier.email;
    h.deps.notifier.email = async () => {
      throw new Error("Resend answered 503");
    };
    try {
      const failed = await jess.post(`/v1/invites/${id}/resend`).expect(502);
      expect(failed.body.error).toMatchObject({ code: "email_not_sent", message: "The email didn't go out. Try again in a few minutes." });
    } finally {
      h.deps.notifier.email = email;
    }
    const [after] = await h.db.select().from(schema.invites).where(eq(schema.invites.id, id));
    expect(after!.expiresAt.toISOString()).toBe(before!.expiresAt.toISOString());
    await jess.post(`/v1/invites/${id}/resend`).expect(200);
    expect(emailsTo("flaky@orangestreet.example").at(-1)!.link).toBe(`${BIZ}/invites/${id}`);
  });

  it("refuses an invite that was used", async () => {
    const id = await inviteToBusiness("used@orangestreet.example");
    const used = await h.signIn(undefined, { linked: [{ kind: "email", value: "used@orangestreet.example" }] });
    await used.post(`/v1/invites/${id}/accept`).expect(200);
    h.clock.advance(11 * MIN);
    expect((await jess.post(`/v1/invites/${id}/resend`).expect(409)).body.error.code).toBe("invite_used");
  });
});

describe("accepting", () => {
  it("joins with the invited email on the account (email, Google or Apple)", async () => {
    const id = await inviteToBusiness("maya@orangestreet.example", "manager");
    const maya = await h.signIn("Maya", { linked: [{ kind: "google", value: "maya@orangestreet.example" }] });
    const me = await maya.post(`/v1/invites/${id}/accept`).expect(200);
    expect(me.body.memberships).toEqual([{ kind: "business", business: { id: businessId, name: "Orange Street Coffee" }, role: "manager" }]);
    // A second tap changes nothing.
    await maya.post(`/v1/invites/${id}/accept`).expect(200);
  });

  it("refuses someone signed in with another email, and says which address it's for", async () => {
    const id = await inviteToStation("jo@example.com");
    const other = await h.signIn("Other", { linked: [{ kind: "email", value: "other@example.com" }] });
    const res = await other.post(`/v1/invites/${id}/accept`).expect(403);
    expect(res.body.error).toMatchObject({
      code: "invite_email_mismatch",
      message: "This invite is for j…@example.com; you're signed in as other@example.com. Sign in with j…@example.com to join."
    });
    const noEmail = await h.signIn();
    expect((await noEmail.post(`/v1/invites/${id}/accept`).expect(403)).body.error.message).toBe(
      "This invite is for j…@example.com; you're signed in as an account with no email. Sign in with j…@example.com to join."
    );
    const team = await kai.get(`/v1/stations/${stationId}/team`).expect(200);
    expect(team.body.members.map((m: { userId: string }) => m.userId)).not.toContain(other.id);
  });

  it("counts an email linked in Privy after the first sign-in", async () => {
    const id = await inviteToStation("later@example.com", "host");
    const later = await h.signIn("Later");
    h.linked.set(later.did, [{ kind: "email", value: "later@example.com" }]);
    await later.post(`/v1/invites/${id}/accept`).expect(200);
  });

  it("refuses an invite someone else used, and an expired one", async () => {
    const id = await inviteToStation("once@example.com");
    const first = await h.signIn(undefined, { linked: [{ kind: "email", value: "once@example.com" }] });
    await first.post(`/v1/invites/${id}/accept`).expect(200);
    const second = await h.signIn(undefined, { linked: [{ kind: "apple", value: "once@example.com" }] });
    expect((await second.post(`/v1/invites/${id}/accept`).expect(409)).body.error.code).toBe("invite_used");

    const expiring = await inviteToStation("late@example.com");
    h.clock.advance(8 * DAY);
    const late = await h.signIn(undefined, { linked: [{ kind: "email", value: "late@example.com" }] });
    expect((await late.post(`/v1/invites/${expiring}/accept`).expect(422)).body.error.code).toBe("invite_expired");
  });

  it("lets anyone signed in accept when the check is off (INVITE_EMAIL_MATCH=off)", async () => {
    const id = await inviteToBusiness("off@orangestreet.example");
    const anyone = await h.signIn(undefined, { linked: [{ kind: "email", value: "anyone@example.com" }] });
    h.deps.config.inviteEmailMatch = false;
    try {
      const preview = await anyone.get(`/v1/invites/${id}`).expect(200);
      expect(preview.body.emailMatches).toBeNull();
      await anyone.post(`/v1/invites/${id}/accept`).expect(200);
    } finally {
      h.deps.config.inviteEmailMatch = true;
    }
  });
});

describe("the invite's page", () => {
  it("reads the invite signed out, and whether it matches signed in", async () => {
    const id = await inviteToStation("page@example.com", "host");
    const out = await anon(h).get(`/v1/invites/${id}`).expect(200);
    expect(out.body).toEqual({
      id,
      team: { kind: "station", id: stationId, name: "Inland Beat", callSign: "BEAT" },
      role: "host",
      invitedBy: "Kai",
      emailHint: "p…@example.com",
      state: "open",
      expiresAt: new Date(h.clock.now().getTime() + 7 * DAY).toISOString(),
      signedInAs: null,
      emailMatches: null,
      acceptedByYou: false
    });
    const other = await h.signIn(undefined, { linked: [{ kind: "email", value: "someone@example.com" }] });
    expect((await other.get(`/v1/invites/${id}`).expect(200)).body).toMatchObject({ signedInAs: "someone@example.com", emailMatches: false });
    const them = await h.signIn(undefined, { linked: [{ kind: "email", value: "page@example.com" }] });
    expect((await them.get(`/v1/invites/${id}`).expect(200)).body).toMatchObject({ signedInAs: "page@example.com", emailMatches: true });
    await them.post(`/v1/invites/${id}/accept`).expect(200);
    expect((await them.get(`/v1/invites/${id}`).expect(200)).body).toMatchObject({ state: "accepted", acceptedByYou: true });
    expect((await anon(h).get(`/v1/invites/${id}`).expect(200)).body).toMatchObject({ state: "accepted", acceptedByYou: false });

    const business = await inviteToBusiness("bpage@orangestreet.example");
    expect((await anon(h).get(`/v1/invites/${business}`).expect(200)).body).toMatchObject({
      team: { kind: "business", id: businessId, name: "Orange Street Coffee", callSign: null },
      invitedBy: "Jess Lin",
      role: "viewer"
    });
    h.clock.advance(8 * DAY);
    expect((await anon(h).get(`/v1/invites/${business}`).expect(200)).body.state).toBe("expired");
    await anon(h).get("/v1/invites/00000000-0000-4000-8000-000000000000").expect(404);
  });
});

describe("notices' emails", () => {
  it("link into the app the notice belongs to, one email per notice", async () => {
    h.deps.bus.emit("business.low_balance", { businessId, daysLeft: 1, since: "start" });
    h.deps.bus.emit("station.dead_air_warning", { stationId, gapStartsAt: new Date(h.clock.now().getTime() + 30 * MIN).toISOString(), minutesBefore: 30 });
    await h.deps.bus.settle();
    const low = emailsTo("jess@orangestreet.example").find((s) => s.title === "Your spots pause tomorrow");
    expect(low).toMatchObject({ link: `${BIZ}/${businessId}/balance` });
    expect(low!.key).toMatch(/^notice:/);
    const dead = emailsTo("kai@example.com").find((s) => s.title === "Dead air in 30 minutes");
    expect(dead).toMatchObject({ link: `${APP}/control/beat/log` });
  });
});
