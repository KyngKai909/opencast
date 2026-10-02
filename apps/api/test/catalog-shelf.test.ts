// The catalog's shelf (follow-up Phase 0 item 10): series built from items, each with its own rights
// record; the checklist pre-filled from the public-domain rules in Settings; the two-person check with
// evidence (the second by someone else, enforced); only double-checked items in episodes; and an item
// failing after the fact: out of every episode it was in, and only those episodes composed again, so
// playout prepares only what changed.
import { promises as fs } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createHarness, market, stationFixture, testClip, type Harness, type User } from "./harness.js";

let h: Harness;
let dee: User;
let rae: User;
let lee: User;
let catalogId: string;
let seriesId: string;
const library: Record<string, string> = {};

async function upload(title: string, seconds: number) {
  const clip = await testClip(seconds);
  const stat = await fs.stat(clip);
  const item = await h.services.library.upload(catalogId, { path: clip, originalName: `${title}.mp4`, size: stat.size, mimeType: "video/mp4" }, { title, code: "PGM" });
  library[title] = item.id;
  return item.id;
}

/** Answers every line that isn't answered yet, with a written record, as a reviewer. */
async function answerAll(itemId: string, who: User) {
  const item = (await who.get(`/v1/admin/catalog/items/${itemId}`)).body;
  for (const line of item.checklist) {
    if (line.state === "not_needed") continue;
    const res = await who.put(`/v1/admin/catalog/items/${itemId}/checks/${line.line}`, { state: line.line === "trademarks" ? "warn" : "ok", record: `Checked: ${line.title}` });
    expect(res.status).toBe(200);
  }
}

/** An item through both checks: Rae first, Dee second. */
async function passed(title: string, year: number) {
  const added = await rae.post(`/v1/admin/catalog/series/${seriesId}/items`, { libraryItemId: library[title], source: `${year}, original print, Library of Congress`, publishedYear: year });
  expect(added.status).toBe(200);
  await answerAll(added.body.id, rae);
  expect((await rae.post(`/v1/admin/catalog/items/${added.body.id}/send`)).status).toBe(200);
  const second = await dee.post(`/v1/admin/catalog/items/${added.body.id}/second-check`, { decision: "confirm" });
  expect(second.body.state).toBe("passed");
  return added.body.id as string;
}

const fileVersions = async (libraryItemId: string) =>
  (await h.db.select({ version: schema.assetFiles.version, contentId: schema.assetFiles.contentId }).from(schema.assetFiles).where(eq(schema.assetFiles.assetId, libraryItemId))).sort((a, b) => a.version - b.version);

beforeAll(async () => {
  h = await createHarness();
  // Before the machine's own clock: what was prepared "since" a moment is read from real file times.
  h.clock.set("2026-09-02T19:00:00.000Z");
  const ie = await market(h);
  dee = await h.signIn("Dee A.", { admin: true });
  rae = await h.signIn("Rae T.");
  lee = await h.signIn("Lee R.");
  await h.db.update(schema.users).set({ email: "rae@opencast.test" }).where(eq(schema.users.id, rae.id));
  await h.db.update(schema.users).set({ email: "lee@opencast.test" }).where(eq(schema.users.id, lee.id));
  await dee.post("/v1/admin/desk/team", { email: "rae@opencast.test", roles: [{ role: "rights_reviewer" }] });
  await dee.post("/v1/admin/desk/team", { email: "lee@opencast.test", roles: [{ role: "market_lead", marketId: ie.id }] });
  const station = await stationFixture(h, { kind: "catalog", callSign: "OCAT", name: "Opencast catalog", marketId: ie.id, tenths: 331, signedOn: true });
  catalogId = station.id;
  await upload("River Rhythms", 1);
  await upload("The Paddle Wheel Parade", 2);
  await upload("Steam and Song", 3);
  await upload("Harbor Lights Frolic", 4);
  await h.services.library.settle();
}, 120_000);
afterAll(() => h.close());

describe("the shelf", () => {
  it("makes a series on the catalog station, and lists it with its basis", async () => {
    expect((await lee.post("/v1/admin/catalog/series", { title: "Cartoons, 1928 to 1936", rightsBasis: "mixed" })).status).toBe(403);
    const made = await rae.post("/v1/admin/catalog/series", { title: "Cartoons, 1928 to 1936", description: "30 min episodes, 3 or 4 shorts each", rightsBasis: "mixed", basisNote: "Before 1931, or not renewed", episodeLengthMs: 1_800_000, colour: "#9A5412" });
    expect(made.status).toBe(200);
    seriesId = made.body.id;
    expect(made.body).toMatchObject({ basisLabel: "Mixed, per item", state: "building", episodesTotal: 0, station: { id: catalogId, callSign: "OCAT" } });
    const shelf = await lee.get("/v1/admin/catalog/shelf");
    expect(shelf.status).toBe(200);
    expect(shelf.body.canEdit).toBe(false);
    expect(shelf.body.publicDomain).toMatchObject({ cutoffYear: 1930, soundRecordingsCutoffYear: 1925 });
    expect(shelf.body.series.map((s: { title: string }) => s.title)).toEqual(["Cartoons, 1928 to 1936"]);
    // The program it's offered as lives on the catalog station.
    expect((await h.services.library.programsByIds([made.body.programId])).get(made.body.programId)?.stationId).toBe(catalogId);
  });

  it("pre-fills the checklist from the public-domain rules", async () => {
    const choices = await rae.get(`/v1/admin/catalog/series/${seriesId}/library`);
    expect(choices.body.map((c: { title: string }) => c.title)).toEqual(["Harbor Lights Frolic", "River Rhythms", "Steam and Song", "The Paddle Wheel Parade"]);

    const before = await rae.post(`/v1/admin/catalog/series/${seriesId}/items`, { libraryItemId: library["River Rhythms"], source: "1929, original print, Internet Archive", publishedYear: 1929 });
    expect(before.status).toBe(200);
    expect(before.body.publicDomain).toMatchObject({ verdict: "public_domain", cutoffYear: 1930, line: "Published 1929, before 1931" });
    const lines = Object.fromEntries(before.body.checklist.map((l: { line: string }) => [l.line, l]));
    expect(lines.published.title).toBe("Published 1929, before 1931");
    expect(lines.renewal).toMatchObject({ state: "not_needed", prefilled: true, detail: "Published before 1931: no renewal search needed" });
    expect(lines.source).toMatchObject({ state: "todo", title: "Source is an original, not a restoration" });

    const later = await rae.post(`/v1/admin/catalog/series/${seriesId}/items`, { libraryItemId: library["Harbor Lights Frolic"], source: "1932, original 35 mm print, Library of Congress", publishedYear: 1932 });
    const renewal = later.body.checklist.find((l: { line: string }) => l.line === "renewal");
    expect(later.body.publicDomain.verdict).toBe("needs_renewal_search");
    expect(later.body.checklist.find((l: { line: string }) => l.line === "published").title).toBe("Published 1932, with a copyright notice");
    expect(renewal).toMatchObject({ state: "todo", title: "Copyright not renewed", help: "Renewal would have been due in 1959 or 1960. Search the Copyright Office renewal records for the title and studio" });

    // The same file twice in a series is refused.
    expect((await rae.post(`/v1/admin/catalog/series/${seriesId}/items`, { libraryItemId: library["River Rhythms"], source: "Again", publishedYear: 1929 })).status).toBe(409);
  });

  it("reads the cut-off from Settings, and moves it every January 1", async () => {
    const at = (iso: string) => h.services.settings.valueAt("rights.public_domain_us", new Date(iso));
    const { cutoffYear } = await import("../src/v1/modules/settings/rules.js");
    expect(cutoffYear(await at("2026-12-31T23:59:00Z"), new Date("2026-12-31T23:59:00Z"))).toBe(1930);
    expect(cutoffYear(await at("2027-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z"))).toBe(1931);
  });
});

describe("the two-person rights check", () => {
  let harbor: string;

  it("needs evidence on every line before the first check", async () => {
    harbor = (await rae.get(`/v1/admin/catalog/series/${seriesId}`)).body.items.find((i: { title: string }) => i.title === "Harbor Lights Frolic").id;
    const early = await rae.post(`/v1/admin/catalog/items/${harbor}/send`);
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe("evidence_missing");
    expect(early.body.error.message).toBe('"Source is an original, not a restoration" isn\'t answered yet.');

    // A yes with no evidence isn't enough.
    await rae.put(`/v1/admin/catalog/items/${harbor}/checks/source`, { state: "ok", detail: "Library of Congress scan of the original print" });
    const bare = await rae.post(`/v1/admin/catalog/items/${harbor}/send`);
    expect(bare.body.error.message).toBe('"Source is an original, not a restoration" has no evidence: attach a file or write down the record.');

    const withFile = await rae.post(`/v1/admin/catalog/items/${harbor}/checks/source/evidence`).attach("file", Buffer.from("%PDF-1.4 loc record"), "loc-record.pdf");
    expect(withFile.status).toBe(200);
    const source = withFile.body.checklist.find((l: { line: string }) => l.line === "source");
    expect(source.evidence).toEqual([expect.objectContaining({ fileName: "loc-record.pdf", uploadedBy: { userId: rae.id, name: "Rae T." }, contentId: expect.stringMatching(/^b[a-z2-7]{58}$/) })]);
    // Kept by content ID for as long as the item is on the shelf.
    const [ref] = await h.db.select().from(schema.contentRefs).where(and(eq(schema.contentRefs.cid, source.evidence[0].contentId), eq(schema.contentRefs.owner, "catalog_evidence" as never)));
    expect(ref).toBeTruthy();
    expect((await rae.post(`/v1/admin/catalog/items/${harbor}/checks/source/evidence`).attach("file", Buffer.from("MZ"), "tool.exe")).status).toBe(422);

    await answerAll(harbor, rae);
    // Someone off the rights team can't answer or send.
    expect((await lee.put(`/v1/admin/catalog/items/${harbor}/checks/renewal`, { state: "ok", record: "x" })).status).toBe(403);
    expect((await lee.post(`/v1/admin/catalog/items/${harbor}/send`)).status).toBe(403);
    const sent = await rae.post(`/v1/admin/catalog/items/${harbor}/send`);
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ state: "second_check", basis: "not_renewed", basisLine: "Not renewed. Copyright Office records searched", firstCheck: { by: { name: "Rae T." } }, canSecondCheck: false });
    // Sent: the checklist is fixed until the second checker sends it back.
    expect((await rae.put(`/v1/admin/catalog/items/${harbor}/checks/soundtrack`, { state: "ok", record: "changed" })).status).toBe(409);
  });

  it("takes the second check from a different rights reviewer or admin only", async () => {
    const same = await rae.post(`/v1/admin/catalog/items/${harbor}/second-check`, { decision: "confirm" });
    expect(same.status).toBe(403);
    expect(same.body.error.code).toBe("same_person");
    expect((await lee.post(`/v1/admin/catalog/items/${harbor}/second-check`, { decision: "confirm" })).status).toBe(403);
    expect((await dee.get(`/v1/admin/catalog/items/${harbor}`)).body.canSecondCheck).toBe(true);

    // Sent back for more evidence: the first check starts again.
    const back = await dee.post(`/v1/admin/catalog/items/${harbor}/second-check`, { decision: "return", note: "Add the renewal search itself" });
    expect(back.body).toMatchObject({ state: "checking", firstCheck: null });
    await rae.post(`/v1/admin/catalog/items/${harbor}/checks/renewal/evidence`).attach("file", Buffer.from("renewal search, none found"), "renewal-search.txt");
    await rae.post(`/v1/admin/catalog/items/${harbor}/send`);
    const confirmed = await dee.post(`/v1/admin/catalog/items/${harbor}/second-check`, { decision: "confirm" });
    expect(confirmed.body).toMatchObject({ state: "passed", firstCheck: { by: { name: "Rae T." } }, secondCheck: { by: { name: "Dee A." } } });

    // The database holds the line too: the second check is never the first checker's.
    await expect(h.db.update(schema.shelfItems).set({ secondCheckedBy: rae.id }).where(eq(schema.shelfItems.id, harbor))).rejects.toThrow();
  });

  it("puts only double-checked items in episodes", async () => {
    const river = (await rae.get(`/v1/admin/catalog/series/${seriesId}`)).body.items.find((i: { title: string }) => i.title === "River Rhythms").id;
    const refused = await rae.put(`/v1/admin/catalog/series/${seriesId}/episodes/1`, { itemIds: [harbor, river] });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("not_passed");
    // Nor in the database.
    const [episode] = await h.db.insert(schema.shelfEpisodes).values({ seriesId, number: 99 }).returning();
    await expect(h.db.insert(schema.shelfEpisodeItems).values({ episodeId: episode.id, itemId: river, position: 1 })).rejects.toThrow();
    await h.db.delete(schema.shelfEpisodes).where(eq(schema.shelfEpisodes.id, episode.id));
  });
});

describe("episodes, and rebuilding them when an item fails", () => {
  let river: string;
  let paddle: string;
  let steam: string;
  let harbor: string;
  const ep: Record<number, string> = {};

  it("composes each episode once, as an item of the series on the catalog station", async () => {
    const items = (await dee.get(`/v1/admin/catalog/series/${seriesId}`)).body.items as Array<{ id: string; title: string }>;
    harbor = items.find((i) => i.title === "Harbor Lights Frolic")!.id;
    // River Rhythms was added above; finish its checks, and add the other two.
    river = items.find((i) => i.title === "River Rhythms")!.id;
    await answerAll(river, rae);
    await rae.post(`/v1/admin/catalog/items/${river}/send`);
    await dee.post(`/v1/admin/catalog/items/${river}/second-check`, { decision: "confirm" });
    paddle = await passed("The Paddle Wheel Parade", 1933);
    steam = await passed("Steam and Song", 1930);

    for (const [n, ids] of [
      [1, [river, paddle]],
      [2, [steam]],
      [3, [paddle, steam, harbor]]
    ] as const) {
      const res = await rae.put(`/v1/admin/catalog/series/${seriesId}/episodes/${n}`, { itemIds: ids });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("draft");
      ep[n] = res.body.id;
    }
    const rebuilt = await rae.post(`/v1/admin/catalog/series/${seriesId}/rebuild`);
    expect(rebuilt.body.episodes.map((e: { number: number; toVersion: number }) => [e.number, e.toVersion])).toEqual([
      [1, 1],
      [2, 1],
      [3, 1]
    ]);
    await h.services.shelf.settle();
    await h.services.library.settle();
    const series = (await dee.get(`/v1/admin/catalog/series/${seriesId}`)).body;
    expect(series.episodes.map((e: { number: number; status: string; version: number }) => [e.number, e.status, e.version])).toEqual([
      [1, "ready", 1],
      [2, "ready", 1],
      [3, "ready", 1]
    ]);
    expect(series.episodesReady).toBe(3);
    const one = series.episodes[0];
    expect(one.items.map((i: { title: string; checkedBy: string[] }) => [i.title, i.checkedBy])).toEqual([
      ["River Rhythms", ["Rae T.", "Dee A."]],
      ["The Paddle Wheel Parade", ["Rae T.", "Dee A."]]
    ]);
    // A library item of the series' program on the catalog station, its rights confirmed, one file.
    const ref = (await h.services.library.itemsByIds([one.libraryItemId])).get(one.libraryItemId)!;
    expect(ref).toMatchObject({ stationId: catalogId, programId: series.programId, episodeNumber: 1, rightsConfirmed: true, status: "ready" });
    expect(ref.durationMs).toBeGreaterThan(2_500);
    expect(await fileVersions(one.libraryItemId)).toHaveLength(1);

    // Nothing changed: nothing is composed again.
    const again = await rae.post(`/v1/admin/catalog/series/${seriesId}/rebuild`);
    expect(again.body).toMatchObject({ episodes: [], unchanged: 3 });
  });

  it("pulls a failed item from every episode and re-prepares only what changed", async () => {
    const series = (await dee.get(`/v1/admin/catalog/series/${seriesId}`)).body;
    const libraryOf = (n: number) => series.episodes.find((e: { number: number }) => e.number === n).libraryItemId as string;
    const before = { 1: await fileVersions(libraryOf(1)), 2: await fileVersions(libraryOf(2)), 3: await fileVersions(libraryOf(3)) };
    const since = new Date();
    await new Promise((r) => setTimeout(r, 20));

    const failed = await rae.post(`/v1/admin/catalog/items/${paddle}/fail`, { reason: "Renewal found in 1957" });
    expect(failed.status).toBe(200);
    expect(failed.body.item).toMatchObject({ state: "failed", failed: { reason: "Renewal found in 1957", by: { name: "Rae T." } } });
    expect(failed.body.item.episodes).toEqual([
      { episodeId: ep[1], number: 1, removed: true },
      { episodeId: ep[3], number: 3, removed: true }
    ]);
    // Only the episodes it was in are composed again.
    expect(failed.body.rebuild).toMatchObject({ reason: "Renewal found in 1957", item: { id: paddle, title: "The Paddle Wheel Parade" }, unchanged: 1 });
    expect(failed.body.rebuild.episodes.map((e: { number: number; fromVersion: number; toVersion: number }) => [e.number, e.fromVersion, e.toVersion])).toEqual([
      [1, 1, 2],
      [3, 1, 2]
    ]);
    await h.services.shelf.settle();
    await h.services.library.settle();

    const after = { 1: await fileVersions(libraryOf(1)), 2: await fileVersions(libraryOf(2)), 3: await fileVersions(libraryOf(3)) };
    // Episodes 1 and 3: a new version of their file, a new content ID. Episode 2: untouched.
    expect(after[1]).toHaveLength(2);
    expect(after[3]).toHaveLength(2);
    expect(after[1][1]!.contentId).not.toBe(before[1][0]!.contentId);
    expect(after[3][1]!.contentId).not.toBe(before[3][0]!.contentId);
    expect(after[2]).toEqual(before[2]);
    // Prepare once: only the changed episodes are up for preparing (carriers air them next time).
    const preparable = await h.services.library.preparableSince(since, 50);
    expect(preparable.map((r) => r.id).sort()).toEqual([libraryOf(1), libraryOf(3)].sort());
    expect((await h.services.library.currentContent([libraryOf(1)])).get(libraryOf(1))).toBe(after[1][1]!.contentId);

    const now = (await dee.get(`/v1/admin/catalog/series/${seriesId}`)).body;
    const three = now.episodes.find((e: { number: number }) => e.number === 3);
    expect(three).toMatchObject({ status: "ready", version: 2 });
    expect(three.items.map((i: { title: string; position: number | null; removedReason: string | null }) => [i.title, i.position, i.removedReason])).toEqual([
      ["Steam and Song", 1, null],
      ["Harbor Lights Frolic", 2, null],
      ["The Paddle Wheel Parade", null, "Renewal found in 1957"]
    ]);
    expect(now.rebuilds[0]).toMatchObject({ reason: "Renewal found in 1957", by: { name: "Rae T." }, unchanged: 1 });
    // It can't go back in.
    expect((await rae.put(`/v1/admin/catalog/series/${seriesId}/episodes/2`, { itemIds: [steam, paddle] })).status).toBe(422);
  });

  it("counts what's ready and what's waiting on the shelf", async () => {
    const shelf = await dee.get("/v1/admin/catalog/shelf");
    expect(shelf.body.stats).toMatchObject({ itemsPassed: 3, awaitingSecondCheck: 0 });
    expect(shelf.body.stats.readyMs).toBeGreaterThan(0);
    expect(shelf.body.series[0]).toMatchObject({ episodesReady: 3, episodesTotal: 3, state: "building" });
    const rows = await h.db.execute(sql`select count(*)::int as n from catalog.shelf_rebuilds`);
    // The first composition and the failure: a rebuild that changed nothing isn't recorded.
    expect((rows as unknown as { rows: Array<{ n: number }> }).rows[0]!.n).toBe(2);
  });
});
