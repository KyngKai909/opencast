// Programming Phase 6's emails, from the jobs' hourly pass. P6.1: each maker whose offered or
// carried programs can go to carriers' relays (every offer and agreement from before 2026-10-10
// has them) hears it once, the owners only, with a link to its offers. P6.8: when a network
// licence for something on a station's log comes within two weeks of its last day (the log's
// warning, the same rule), the station's owners hear once per licence, naming what's on the log
// and the day, with a link to the log; the Network desk hears once per licence.
// Against the local Postgres (no ffmpeg).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { renderEmail } from "../src/v1/email.js";
import { createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

/** With EMAIL_SAMPLES_DIR set, each email is kept there as text and HTML. */
async function sample(name: string, sent: Harness["sent"][number]) {
  if (!process.env.EMAIL_SAMPLES_DIR) return;
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");
  const email = renderEmail({ title: sent.title, body: sent.body ?? "", link: sent.link ?? null, action: sent.action, footer: sent.footer });
  await fs.mkdir(process.env.EMAIL_SAMPLES_DIR, { recursive: true });
  await fs.writeFile(path.join(process.env.EMAIL_SAMPLES_DIR, `${name}.txt`), `Subject: ${email.subject}\n\n${email.text}`);
  await fs.writeFile(path.join(process.env.EMAIL_SAMPLES_DIR, `${name}.html`), email.html);
}

let h: Harness;
let kai: User;
let dee: User;
let jen: User;
let sam: User;
let desk: User;
let marketId: string;

const terms = {
  termsOffered: ["barter"],
  cashPriceMicros: null,
  cashPriceUnit: null,
  barterMakerMsPerHour: 120_000,
  airingsPerEpisode: null,
  windowDays: 7,
  liveOnly: false,
  noticeDays: 7,
  approval: "i_approve",
  radioBandAllowed: true
};

type Notice = { kind: string; title: string; body: string; link: string | null };
const notices = async (u: User, kind: string) => ((await u.get("/v1/me/notices").expect(200)).body as Notice[]).filter((n) => n.kind === kind);
const emailOf = (u: User) => `${u.id.slice(0, 8)}@opencast.example`;
const emailsTo = (u: User, from: number) => h.sent.slice(from).filter((s) => s.channel === "email" && s.to === emailOf(u));
const owner = (stationId: string, user: User, role: "owner" | "operator" = "owner") => h.db.insert(schema.stationMemberships).values({ stationId, userId: user.id, role });
const transfer = async (by: User, stationId: string, to: User) => {
  await by.post(`/v1/stations/${stationId}/team/transfer`, { toUserId: to.id }).expect(200);
  await h.deps.bus.settle();
};

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-19T19:00:00.000Z");
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
  dee = await h.signIn("Dee");
  jen = await h.signIn("Jen");
  sam = await h.signIn("Sam");
  desk = await h.signIn("Desk", { admin: true });
  for (const u of [kai, dee, jen, sam, desk]) await h.db.update(schema.users).set({ email: emailOf(u) }).where(eq(schema.users.id, u.id));
}, 60_000);
afterAll(() => h.close());

describe("P6.1: makers told once that carriers can send their programs to relays", () => {
  let reel: { id: string };
  let wave: { id: string };
  let crate: { id: string };
  let beat: { id: string };

  it("sends nothing while no program is offered", async () => {
    const before = h.sent.length;
    expect(await h.services.catalog.tellMakersAboutRelays()).toBe(0);
    expect(h.sent.length).toBe(before);
  });

  it("tells each maker's owners once, with a link to its offers", async () => {
    reel = await stationFixture(h, { callSign: "REEL", ownerId: dee.id, marketId, tenths: 241, signedOn: true });
    wave = await stationFixture(h, { callSign: "WAVE", ownerId: jen.id, marketId, tenths: 251, signedOn: true });
    crate = await stationFixture(h, { callSign: "CRAT", ownerId: jen.id, marketId, tenths: 261, signedOn: true });
    beat = await stationFixture(h, { callSign: "BEAT", ownerId: kai.id, marketId, tenths: 121, signedOn: true });
    await owner(reel.id, sam, "operator");

    // REEL offers two programs as offers always were: relays on.
    for (const title of ["Night Reel", "Crate Sessions"]) {
      const programId = (await dee.post(`/v1/stations/${reel.id}/programs`, { title }).expect(201)).body.id;
      await itemFixture(h, reel.id, { programId, episodeNumber: 1, title: `${title} 1` });
      await dee.post(`/v1/programs/${programId}/offer`, terms).expect(201);
    }
    // WAVE offers its program for Opencast only: nothing to tell.
    const waveProgram = (await jen.post(`/v1/stations/${wave.id}/programs`, { title: "Wave Hour" }).expect(201)).body.id;
    await itemFixture(h, wave.id, { programId: waveProgram, episodeNumber: 1, title: "Wave Hour 1" });
    await jen.post(`/v1/programs/${waveProgram}/offer`, { ...terms, outlets: [] }).expect(201);

    const before = h.sent.length;
    expect(await h.services.catalog.tellMakersAboutRelays()).toBe(1);

    const told = await notices(dee, "carriage_outlets");
    expect(told).toEqual([
      expect.objectContaining({
        title: "Stations carrying your programs can send them to relays",
        body:
          "Stations that carry Crate Sessions and Night Reel can send them to their relays too: YouTube, Twitch and the other platforms. They always could. Now you choose, and it stays on unless you turn it off.\n\n" +
          'To turn it off, open an offer and untick Relays under "Where carriers can send it". The change is for new carriers. Stations carrying them now keep what they agreed to.',
        link: `/stations/${reel.id}/offered`
      })
    ]);
    // Email only (push is off for this one), to the owner; the operator, WAVE and the carrier hear nothing.
    const sent = h.sent.slice(before);
    expect(sent.map((s) => [s.channel, s.to])).toEqual([["email", emailOf(dee)]]);
    expect(sent[0]).toMatchObject({
      link: "https://app.opencast.test/control/reel/market/offered",
      action: "See your offers",
      footer: "Opencast sends this once, to the owners of stations whose programs other stations can carry."
    });
    await sample("p6.1-makers-relays", sent[0]!);
    for (const u of [sam, jen, kai]) expect(await notices(u, "carriage_outlets")).toEqual([]);
  });

  it("isn't sent again, even when the station has a new owner", async () => {
    const before = h.sent.length;
    expect(await h.services.catalog.tellMakersAboutRelays()).toBe(0);
    await transfer(dee, reel.id, sam);
    expect(await h.services.catalog.tellMakersAboutRelays()).toBe(0);
    expect(h.sent.slice(before).filter((s) => s.title.includes("relays"))).toEqual([]);
    expect(await notices(sam, "carriage_outlets")).toEqual([]);
    expect(await notices(dee, "carriage_outlets")).toHaveLength(1);
  });

  it("tells a maker whose only relays are in a running agreement, naming the one program", async () => {
    const programId = (await jen.post(`/v1/stations/${crate.id}/programs`, { title: "Dig Deep" }).expect(201)).body.id;
    await itemFixture(h, crate.id, { programId, episodeNumber: 1, title: "Dig Deep 1" });
    const offerId = (await jen.post(`/v1/programs/${programId}/offer`, terms).expect(201)).body.id;
    const req = await kai.post(`/v1/catalog/offers/${offerId}/requests`, { carrierStationId: beat.id, term: "barter", slots: [{ weekday: 6, time: "20:00" }], startsOn: "2026-10-24" }).expect(201);
    await jen.post(`/v1/carriage/requests/${req.body.id}/decision`, { decision: "approve" }).expect(200);
    // The maker narrows the offer for new carriers, then withdraws it: BEAT's agreement still has relays.
    await jen.patch(`/v1/catalog/offers/${offerId}`, { outlets: [] }).expect(200);
    await jen.patch(`/v1/catalog/offers/${offerId}`, { status: "withdrawn" }).expect(200);

    const before = h.sent.length;
    expect(await h.services.catalog.tellMakersAboutRelays()).toBe(1);
    const told = await notices(jen, "carriage_outlets");
    expect(told).toHaveLength(1);
    expect(told[0]!.link).toBe(`/stations/${crate.id}/offered`);
    expect(told[0]!.body).toContain("Stations that carry Dig Deep can send it to their relays too");
    expect(told[0]!.body).toContain("Stations carrying it now keep what they agreed to.");
    expect(emailsTo(jen, before).map((s) => s.link)).toEqual(["https://app.opencast.test/control/crat/market/offered"]);
    expect(await h.services.catalog.tellMakersAboutRelays()).toBe(0);
  });
});

describe("P6.8: a network licence ending within two weeks", () => {
  let krat: { id: string };
  let dust: { id: string };
  let west: { id: string };
  let licenceId: string;
  // Saturday 8:00 pm in Los Angeles.
  const SAT = { oct24: "2026-10-25T03:00:00.000Z", nov7: "2026-11-08T04:00:00.000Z" };

  it("tells no one three weeks out", async () => {
    h.clock.set("2026-10-09T19:00:00.000Z");
    krat = await stationFixture(h, { callSign: "KRAT", name: "Crate TV", ownerId: kai.id, marketId, tenths: 331, signedOn: true });
    dust = await stationFixture(h, { callSign: "DUST", ownerId: dee.id, marketId, tenths: 451, signedOn: true });
    west = await stationFixture(h, { callSign: "WEST", ownerId: jen.id, marketId, tenths: 441, signedOn: true });
    await owner(krat.id, sam, "operator");
    const programId = (await kai.post(`/v1/stations/${krat.id}/programs`, { title: "Prairie Westerns" }).expect(201)).body.id;
    const episodes = [];
    for (let n = 1; n <= 2; n++) episodes.push(await itemFixture(h, krat.id, { title: `Western ${n}`, programId, episodeNumber: n }));
    const noon = await itemFixture(h, dust.id, { title: "High Noon Again" });
    const westProgram = (await jen.post(`/v1/stations/${west.id}/programs`, { title: "Trail Dust" }).expect(201)).body.id;
    await itemFixture(h, west.id, { title: "Trail Dust 1", programId: westProgram, episodeNumber: 1 });
    // On the logs before the licences are recorded: KRAT on the 24th and the 7th (after the end), DUST on the 24th.
    await kai.post(`/v1/stations/${krat.id}/log`, { kind: "program", startsAt: SAT.oct24, itemId: episodes[0]!.id }).expect(201);
    await kai.post(`/v1/stations/${krat.id}/log`, { kind: "program", startsAt: SAT.nov7, itemId: episodes[1]!.id }).expect(201);
    await dee.post(`/v1/stations/${dust.id}/log`, { kind: "program", startsAt: SAT.oct24, itemId: noon.id }).expect(201);

    // Prairie Films covers KRAT's program and DUST's item to the 31st; WEST's program (not on its log) too.
    licenceId = (
      await desk
        .post("/v1/admin/licences", { licensor: "Prairie Films", name: "Westerns package", outlets: ["relays"], worldwide: true, countries: [], startsOn: "2026-10-01", endsOn: "2026-10-31", deal: { kind: "none" }, programIds: [programId, westProgram], itemIds: [noon.id] })
        .expect(201)
    ).body.id;
    // A second licence keeps DUST's item on the air to the end of the year: no warning on its log, so no email.
    await desk.post("/v1/admin/licences", { licensor: "Long Deal Pictures", outlets: [], worldwide: true, countries: [], startsOn: "2026-10-01", endsOn: "2026-12-31", deal: { kind: "none" }, programIds: [], itemIds: [noon.id] }).expect(201);

    const before = h.sent.length;
    expect(await h.services.licences.tellEnding()).toEqual({ stations: 0, desk: 0 });
    expect(h.sent.length).toBe(before);
  });

  it("tells the owners of a station with it on the log, and the desk, once each", async () => {
    h.clock.set("2026-10-19T19:00:00.000Z");
    const before = h.sent.length;
    expect(await h.services.licences.tellEnding()).toEqual({ stations: 1, desk: 1 });

    const station = await notices(kai, "licence_ending");
    expect(station).toEqual([
      expect.objectContaining({
        title: "Prairie Westerns comes off the air after Sat Oct 31",
        body:
          "Opencast's licence from Prairie Films for Prairie Westerns ends Sat Oct 31. It can't air on KRAT 33.1 after that day.\n\n" +
          "On your log:\nPrairie Westerns, ep. 1, Sat Oct 24 at 8:00 pm\nPrairie Westerns, ep. 2, Sat Nov 7 at 8:00 pm, after the end\n\n" +
          "What's on the log after Sat Oct 31 won't air: station ID and bumpers air in its place. Replace it when you can.",
        link: `/stations/${krat.id}/log`
      })
    ]);
    const toKai = emailsTo(kai, before);
    expect(toKai).toHaveLength(1);
    expect(toKai[0]).toMatchObject({ link: "https://app.opencast.test/control/krat/schedule", action: "Open the log", footer: "Opencast sends this once for each licence, to the owners of stations with something it covers on their log." });
    await sample("p6.8-station-owners", toKai[0]!);
    // The owners only: not KRAT's operator; not DUST (another licence runs on) or WEST (nothing on its log).
    expect(await notices(sam, "licence_ending")).toEqual([]);
    expect(await notices(dee, "licence_ending")).toEqual([]);
    expect(await notices(jen, "licence_ending")).toEqual([]);

    const deskNotices = await notices(desk, "licence_ending");
    expect(deskNotices).toEqual([
      expect.objectContaining({
        title: "The licence from Prairie Films ends Sat Oct 31",
        body:
          "Westerns package, from Prairie Films, covers High Noon Again, Prairie Westerns and Trail Dust. Unless another licence covers them, they're off the air after Sat Oct 31.\n\n" +
          "Something it covers is on the log at KRAT 33.1. Its owners have been told.\n\n" +
          "If the deal goes on, change its last day on the licence's page.",
        link: `/desk/licences/${licenceId}`
      })
    ]);
    const toDesk = emailsTo(desk, before);
    expect(toDesk).toHaveLength(1);
    expect(toDesk[0]).toMatchObject({ link: `https://app.opencast.test/desk/licences/${licenceId}`, action: "Open the licence", footer: "You're getting this because you're on Opencast's Network desk." });
    await sample("p6.8-network-desk", toDesk[0]!);
    // Push too, on by default.
    expect(h.sent.slice(before).filter((s) => s.channel === "push").map((s) => s.to).sort()).toEqual([desk.id, kai.id].sort());
  });

  it("isn't sent again, even to a new owner", async () => {
    const before = h.sent.length;
    h.clock.set("2026-10-20T19:00:00.000Z");
    expect(await h.services.licences.tellEnding()).toEqual({ stations: 0, desk: 0 });
    await transfer(kai, krat.id, sam);
    expect(await h.services.licences.tellEnding()).toEqual({ stations: 0, desk: 0 });
    expect(h.sent.slice(before).filter((s) => s.title.includes("off the air"))).toEqual([]);
    expect(await notices(sam, "licence_ending")).toEqual([]);
  });

  it("tells them again near a new last day, once the licence is extended", async () => {
    await desk.patch(`/v1/admin/licences/${licenceId}`, { endsOn: "2026-11-21" }).expect(200);
    // Two weeks and more before the 21st: nothing.
    expect(await h.services.licences.tellEnding()).toEqual({ stations: 0, desk: 0 });
    h.clock.set("2026-11-08T20:00:00.000Z");
    const before = h.sent.length;
    // KRAT's last entry (the 7th) has aired: nothing of it on the log now, so only the desk.
    expect(await h.services.licences.tellEnding()).toEqual({ stations: 0, desk: 1 });
    const latest = (await notices(desk, "licence_ending"))[0]!;
    expect(latest.title).toBe("The licence from Prairie Films ends Sat Nov 21");
    expect(latest.body).toContain("Nothing it covers is on a station's log.");
    expect(emailsTo(desk, before)).toHaveLength(1);
  });
});
