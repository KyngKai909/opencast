// The catalog's shelf (desk-catalog 01 to 03): series, items with their checklists and evidence, the
// two-person check, episodes and rebuilds. The same rules as the API: rights reviewers and admins
// change things; the second check is someone else's; only double-checked items go into episodes;
// an item that fails comes out of every episode, and only those episodes are rebuilt.
import { http, type HttpHandler } from "msw";
import { catalogShelfApi, type ChecklistLineName, type LineState, type ShelfBasis } from "@opencast/contracts";
import { now } from "../../../lib/clock";
import { cantSendBecause, itemView, nextId, prefillChecks, rebuildSeries, saveSettings, sendBasis, seriesView, settingsDb, shelfView, type MockItem } from "../settingsDb";
import { bodyOf, fail, lacks, needsDesk, path, reply } from "../respond";

const findSeries = (id: string) => settingsDb().series.find((s) => s.id === id);
const findItem = (id: string) => settingsDb().items.find((i) => i.id === id);

export const shelfHandlers: HttpHandler[] = [
  http.get(path(catalogShelfApi.getShelf), ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    return reply(catalogShelfApi.getShelf.response, shelfView(p));
  }),

  http.post(path(catalogShelfApi.createSeries), async ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "rights");
    if (no) return no;
    const body = await bodyOf<{ title?: string; description?: string; rightsBasis?: ShelfBasis; basisNote?: string; notes?: string; mediaKind?: "video" | "audio"; episodeLengthMs?: number; colour?: string; coming?: boolean }>(request);
    if (!body?.title?.trim()) return fail(400, "bad_request", "Check the form: say what it's called.", { title: "Required" });
    const s = {
      id: nextId(),
      title: body.title.trim(),
      description: body.description?.trim() || null,
      colour: body.colour ?? "#33507A",
      mediaKind: body.mediaKind ?? "video",
      episodeLengthMs: body.episodeLengthMs ?? null,
      rightsBasis: body.rightsBasis ?? "mixed",
      basisNote: body.basisNote?.trim() || null,
      notes: body.notes?.trim() || null,
      state: body.coming ? ("coming" as const) : ("building" as const),
      offered: false,
      programId: nextId(),
      carriers: []
    };
    settingsDb().series.push(s);
    saveSettings();
    return reply(catalogShelfApi.createSeries.response, seriesView(s, p));
  }),

  http.get(path(catalogShelfApi.getSeries), ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const s = findSeries(String(params.seriesId));
    if (!s) return fail(404, "not_found", "That series wasn't found.");
    return reply(catalogShelfApi.getSeries.response, seriesView(s, p));
  }),

  http.get(path(catalogShelfApi.libraryChoices), ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const s = findSeries(String(params.seriesId));
    if (!s) return fail(404, "not_found", "That series wasn't found.");
    const d = settingsDb();
    const taken = new Set(d.items.map((i) => i.libraryItemId));
    return reply(
      catalogShelfApi.libraryChoices.response,
      d.library.filter((l) => l.mediaKind === s.mediaKind && !taken.has(l.libraryItemId)).map((l) => ({ libraryItemId: l.libraryItemId, title: l.title, contentId: l.contentId, lengthMs: l.lengthMs, mediaKind: l.mediaKind }))
    );
  }),

  http.post(path(catalogShelfApi.addItem), async ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "rights");
    if (no) return no;
    const s = findSeries(String(params.seriesId));
    if (!s) return fail(404, "not_found", "That series wasn't found.");
    const body = await bodyOf<{ libraryItemId?: string; title?: string; source?: string; workKind?: "film" | "sound_recording"; publishedYear?: number; country?: string; usGovernment?: boolean }>(request);
    const d = settingsDb();
    const file = d.library.find((l) => l.libraryItemId === body?.libraryItemId);
    if (!file) return fail(404, "not_found", "That library item wasn't found.");
    if (d.items.some((i) => i.seriesId === s.id && i.contentId === file.contentId)) return fail(409, "already_on_shelf", "That file is already an item in this series.");
    if (!body?.source?.trim()) return fail(400, "bad_request", "Check the form: say where it's from.", { source: "Required" });
    const item: MockItem = {
      id: nextId(),
      seriesId: s.id,
      title: body.title?.trim() || file.title,
      source: body.source.trim(),
      workKind: body.workKind ?? "film",
      publishedYear: body.publishedYear ?? null,
      country: (body.country ?? "US").toUpperCase(),
      basis: body.usGovernment ? "us_government" : null,
      libraryItemId: file.libraryItemId,
      contentId: file.contentId,
      durationMs: file.lengthMs,
      state: "checking",
      firstCheckedBy: null,
      firstCheckedAt: null,
      secondCheckedBy: null,
      secondCheckedAt: null,
      failedBy: null,
      failedAt: null,
      failedReason: null,
      checks: {},
      evidence: []
    };
    prefillChecks(item);
    d.items.push(item);
    saveSettings();
    return reply(catalogShelfApi.addItem.response, itemView(item, p));
  }),

  http.get(path(catalogShelfApi.getItem), ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const i = findItem(String(params.itemId));
    if (!i) return fail(404, "not_found", "That item wasn't found.");
    return reply(catalogShelfApi.getItem.response, itemView(i, p));
  }),

  http.put(path(catalogShelfApi.setCheck), async ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "rights");
    if (no) return no;
    const i = findItem(String(params.itemId));
    if (!i) return fail(404, "not_found", "That item wasn't found.");
    if (i.state !== "checking") return fail(409, "sent", i.state === "second_check" ? "It's been sent for the second check. The second checker can send it back." : "Its check is finished.");
    const body = await bodyOf<{ state?: LineState; detail?: string | null; record?: string | null }>(request);
    const line = String(params.line) as ChecklistLineName;
    const was = i.checks[line];
    i.checks[line] = {
      state: body?.state ?? "todo",
      detail: body?.detail !== undefined ? body.detail : (was?.detail ?? null),
      record: body?.record !== undefined ? body.record : (was?.record ?? null),
      setBy: p.id,
      setAt: now().toISOString()
    };
    saveSettings();
    return reply(catalogShelfApi.setCheck.response, itemView(i, p));
  }),

  http.post(path(catalogShelfApi.addEvidence), async ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "rights");
    if (no) return no;
    const i = findItem(String(params.itemId));
    if (!i) return fail(404, "not_found", "That item wasn't found.");
    if (i.state !== "checking") return fail(409, "sent", "It's been sent: evidence is added before the first check.");
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return fail(400, "bad_request", "Choose a file to attach.", { file: "Required" });
    if (!/\.(pdf|png|jpe?g|gif|webp|heic|txt)$/i.test(file.name)) return fail(422, "wrong_file_type", "Attach a PDF, a picture or a text file.");
    if (file.size > 20 * 1024 * 1024) return fail(422, "too_big", "Attach a file of 20 MB or less.");
    const id = nextId();
    i.evidence.push({ id, line: String(params.line) as ChecklistLineName, fileName: file.name, contentType: file.type || "application/octet-stream", bytes: file.size, contentId: `bafkreievidence${id.slice(-12)}`, uploadedBy: p.id, at: now().toISOString() });
    saveSettings();
    return reply(catalogShelfApi.addEvidence.response, itemView(i, p));
  }),

  http.post(path(catalogShelfApi.sendForSecondCheck), ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "rights");
    if (no) return no;
    const i = findItem(String(params.itemId));
    if (!i) return fail(404, "not_found", "That item wasn't found.");
    if (i.state !== "checking") return fail(409, "sent", "It's already been sent.");
    const why = cantSendBecause(i);
    if (why) return fail(422, "evidence_missing", why);
    i.basis = sendBasis(i);
    i.state = "second_check";
    i.firstCheckedBy = p.id;
    i.firstCheckedAt = now().toISOString();
    saveSettings();
    return reply(catalogShelfApi.sendForSecondCheck.response, itemView(i, p));
  }),

  http.post(path(catalogShelfApi.secondCheck), async ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "rights");
    if (no) return no;
    const i = findItem(String(params.itemId));
    if (!i) return fail(404, "not_found", "That item wasn't found.");
    if (i.state !== "second_check") return fail(409, "not_sent", "It isn't waiting for a second check.");
    if (i.firstCheckedBy === p.id) return fail(403, "same_person", "You did the first check. Someone else does the second.");
    const body = await bodyOf<{ decision?: "confirm" | "return" | "fail"; note?: string }>(request);
    const at = now().toISOString();
    if (body?.decision === "return") Object.assign(i, { state: "checking", firstCheckedBy: null, firstCheckedAt: null, basis: i.basis === "us_government" ? "us_government" : null });
    else if (body?.decision === "fail") Object.assign(i, { state: "failed", failedBy: p.id, failedAt: at, failedReason: body.note?.trim() || "Failed its second check" });
    else Object.assign(i, { state: "passed", secondCheckedBy: p.id, secondCheckedAt: at });
    saveSettings();
    return reply(catalogShelfApi.secondCheck.response, itemView(i, p));
  }),

  http.post(path(catalogShelfApi.failItem), async ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "rights");
    if (no) return no;
    const i = findItem(String(params.itemId));
    if (!i) return fail(404, "not_found", "That item wasn't found.");
    if (i.state === "failed") return fail(409, "already_failed", "It's already out of the catalog.");
    const body = await bodyOf<{ reason?: string }>(request);
    const reason = body?.reason?.trim();
    if (!reason) return fail(400, "bad_request", "Say why it failed.", { reason: "Required" });
    const at = now().toISOString();
    Object.assign(i, { state: "failed", failedBy: p.id, failedAt: at, failedReason: reason });
    for (const e of settingsDb().episodes) {
      const link = e.items.find((x) => x.itemId === i.id && x.removedAt === null);
      if (!link) continue;
      Object.assign(link, { removedAt: at, removedReason: reason, position: null });
      e.items
        .filter((x) => x.position !== null)
        .sort((a, b) => a.position! - b.position!)
        .forEach((x, n) => (x.position = n + 1));
      e.dirty = true;
    }
    const rebuild = rebuildSeries(findSeries(i.seriesId)!, p, reason, i.id);
    saveSettings();
    return reply(catalogShelfApi.failItem.response, { item: itemView(i, p), rebuild });
  }),

  http.put(path(catalogShelfApi.setEpisode), async ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "rights");
    if (no) return no;
    const s = findSeries(String(params.seriesId));
    if (!s) return fail(404, "not_found", "That series wasn't found.");
    const body = await bodyOf<{ title?: string | null; itemIds?: string[] }>(request);
    const ids = body?.itemIds ?? [];
    const d = settingsDb();
    const items = ids.map((id) => d.items.find((i) => i.id === id));
    if (!ids.length || items.some((i) => !i || i.seriesId !== s.id)) return fail(400, "bad_request", "Those items aren't all in this series.", { itemIds: "Not in the series" });
    const notPassed = items.filter((i) => i!.state !== "passed");
    if (notPassed.length) return fail(422, "not_passed", `Only items checked by two people go into episodes: ${notPassed.map((i) => `"${i!.title}"`).join(", ")} ${notPassed.length === 1 ? "isn't" : "aren't"} yet.`);
    const number = Number(params.number);
    let e = d.episodes.find((x) => x.seriesId === s.id && x.number === number);
    if (!e) {
      e = { id: nextId(), seriesId: s.id, number, title: body?.title ?? null, status: "draft", version: 0, composedAt: null, libraryItemId: null, items: [] };
      d.episodes.push(e);
    } else if (body?.title !== undefined) e.title = body.title;
    e.items = [...e.items.filter((x) => x.removedAt !== null), ...ids.map((itemId, n) => ({ itemId, position: n + 1, removedAt: null, removedReason: null }))];
    e.dirty = true;
    saveSettings();
    return reply(catalogShelfApi.setEpisode.response, seriesView(s, p).episodes.find((x) => x.id === e!.id)!);
  }),

  http.post(path(catalogShelfApi.rebuildEpisodes), ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "rights");
    if (no) return no;
    const s = findSeries(String(params.seriesId));
    if (!s) return fail(404, "not_found", "That series wasn't found.");
    const view = rebuildSeries(s, p, "Rebuilt from the series page", null);
    saveSettings();
    return reply(catalogShelfApi.rebuildEpisodes.response, view);
  })
];
