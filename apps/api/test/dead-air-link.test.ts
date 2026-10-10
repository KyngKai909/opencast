// A246 (decision 9): the dead-air warning (30 and 12 minutes before) opens straight to the gap on
// the Schedule, with Fill ready: its notice links to `/stations/:id/schedule?day=<broadcast
// day>&fill=<gap start>`, and its email to master control's Schedule with that query. The other
// notices that pointed at the log, the as-run log or the breaks open the Schedule too.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User;
let beat: string;

// Saturday, October 3, 2026, 11:30 pm in Los Angeles (PDT).
const SATURDAY_NIGHT = "2026-10-04T06:30:00.000Z";

beforeAll(async () => {
  h = await createHarness();
  h.clock.set(SATURDAY_NIGHT);
  kai = await h.signIn("Kai");
  await h.db.update(schema.users).set({ email: "kai@example.com" }).where(eq(schema.users.id, kai.id));
  beat = (await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: (await market(h)).id, tenths: 121, signedOn: true })).id;
}, 60_000);
afterAll(() => h.close());

const noticeLinks = async (kind: string) => (await h.db.select({ link: schema.notices.link }).from(schema.notices).where(and(eq(schema.notices.userId, kai.id), eq(schema.notices.kind, kind)))).map((n) => n.link);
const emails = (title: string) => h.sent.filter((s) => s.channel === "email" && s.to === "kai@example.com" && s.title === title).map((s) => s.link);

describe("the dead-air warning's link", () => {
  it("opens the gap's broadcast day on the Schedule with Fill ready, 30 and 12 minutes before", async () => {
    // Midnight: after midnight is still Saturday's broadcast day.
    const gap = "2026-10-04T07:00:00.000Z";
    h.deps.bus.emit("station.dead_air_warning", { stationId: beat, gapStartsAt: gap, minutesBefore: 30 });
    h.deps.bus.emit("station.dead_air_warning", { stationId: beat, gapStartsAt: gap, minutesBefore: 12 });
    await h.deps.bus.settle();
    const link = `/stations/${beat}/schedule?day=2026-10-03&fill=${gap}`;
    expect(await noticeLinks("dead_air_warning")).toEqual([link, link]);
    expect(emails("Dead air in 30 minutes")).toEqual([`https://app.opencast.test/control/beat/schedule?day=2026-10-03&fill=${gap}`]);
    expect(emails("Dead air in 12 minutes")).toEqual([`https://app.opencast.test/control/beat/schedule?day=2026-10-03&fill=${gap}`]);
  });

  it("and the notices that pointed at the log or the as-run log open the Schedule", async () => {
    h.deps.bus.emit("station.dead_air_filled", { stationId: beat, gapStartsAt: "2026-10-04T07:00:00.000Z", gapEndsAt: "2026-10-04T07:30:00.000Z" });
    // A maker's rights claim: the station carrying it hears, with a link to its log.
    const maker = (await stationFixture(h, { callSign: "REEL", name: "Reel 24", tenths: 241, signedOn: true })).id;
    h.deps.bus.emit("claim.filed", { claimId: "c1", stationId: maker, itemTitle: "Saturday Reel", carrierStationIds: [beat] });
    await h.deps.bus.settle();
    expect(await noticeLinks("dead_air_filled")).toEqual([`/stations/${beat}/as-run`]);
    expect(await noticeLinks("rights_claim")).toEqual([`/stations/${beat}/log`]);
    expect(emails("Saturday Reel is off air for now")).toEqual(["https://app.opencast.test/control/beat/schedule"]);
  });
});
