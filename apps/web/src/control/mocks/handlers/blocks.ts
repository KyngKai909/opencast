// A244: programming blocks (`listBlocks`, `getBlock`, `createBlock`, `updateBlock`,
// `uploadBlockLogo`, `archiveBlock`), as the API answers them, on the blocks' own saved state
// (../blocks.ts). Names are the station's own (409 `block_name_taken`), colours hold 4.5:1 against
// white, and a block on the log can't be archived until it's off it (409 `block_on_log`, or
// `?takeOffLog=true`: its spans ahead come off dates nobody edited).

import { http } from "msw";
import { blocksApi } from "@opencast/contracts";
import { stationColourPasses } from "@opencast/ui";
import { now } from "../../../lib/clock";
import { blockById, blocksOf, blocksState, blockView, saveBlocks, type MockBlock } from "../blocks";
import { fail, path, reply } from "../respond";
import { roleOn } from "./log";
import { getDb } from "../db";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** As the API checks a bumper order: a role once a position, four at most, an N with "every N programs". */
function sequenceProblemsOf(seq: unknown): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const p of ["open", "close", "between"] as const) {
    const rule = (seq as Record<string, { roles?: string[]; every?: string; n?: number }>)[p];
    if (!rule) continue;
    const roles = rule.roles ?? [];
    if (roles.length > 4) out[`sequences.${p}.roles`] = "At most four";
    if (new Set(roles).size !== roles.length) out[`sequences.${p}.roles`] = "Each role once";
    if (rule.every === "n_programs" && !rule.n) out[`sequences.${p}.n`] = "Required";
  }
  return Object.keys(out).length ? out : null;
}

function fields(body: Record<string, unknown>, id?: string, stationId?: string): Partial<MockBlock> | Response {
  const out: Partial<MockBlock> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name || name.length > 60) return fail(400, "bad_request", "Name it, in 60 characters at most.", { name: "1 to 60 characters" });
    if (blocksOf(stationId!).some((b) => b.id !== id && b.name.toLowerCase() === name.toLowerCase())) return fail(409, "block_name_taken", `You already have a block called ${name}.`);
    out.name = name;
  }
  if (body.description !== undefined) out.description = (body.description as string | null)?.trim() || null;
  if (body.colour !== undefined) {
    const colour = body.colour as string | null;
    if (colour && !stationColourPasses(colour)) return fail(400, "bad_request", "That colour doesn't hold 4.5:1 against white. Choose a darker one.", { colour: "Needs 4.5:1" });
    out.colour = colour;
  }
  for (const k of ["bug", "intro", "outro"] as const) if (body[k] !== undefined) (out as Record<string, unknown>)[k] = body[k];
  if (body.sequences !== undefined) {
    const problems = body.sequences ? sequenceProblemsOf(body.sequences) : null;
    if (problems) return fail(400, "bad_request", "Each bumper role can be in a position once, four at most.", problems);
    out.sequences = (body.sequences as MockBlock["sequences"]) ?? null;
  }
  if (body.removeLogo) out.logoUrl = null;
  return out;
}

export const blockHandlers = [
  http.get(path(blocksApi.listBlocks), ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    return reply(blocksApi.listBlocks.response, { blocks: blocksOf(r.station.ident.id).map((b) => blockView(b)) });
  }),

  http.get(path(blocksApi.getBlock), ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const b = blockById(String(params.blockId));
    if (!b || b.stationId !== r.station.ident.id || b.archivedAt) return fail(404, "not_found", "That block wasn't found.");
    return reply(blocksApi.getBlock.response, blockView(b, true));
  }),

  http.post(path(blocksApi.createBlock), async ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body?.name) return fail(400, "bad_request", "Name it.", { name: "Required" });
    const set = fields(body, undefined, r.station.ident.id);
    if (set instanceof Response) return set;
    const at = now().toISOString();
    const b: MockBlock = { id: crypto.randomUUID(), stationId: r.station.ident.id, name: set.name!, description: null, colour: null, logoUrl: null, bug: "logo", intro: true, outro: true, sequences: null, createdAt: at, updatedAt: at, archivedAt: null, ...set };
    blocksState().blocks.push(b);
    saveBlocks();
    return reply(blocksApi.createBlock.response, blockView(b, true), 201);
  }),

  http.patch(path(blocksApi.updateBlock), async ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const b = blockById(String(params.blockId));
    if (!b || b.stationId !== r.station.ident.id || b.archivedAt) return fail(404, "not_found", "That block wasn't found.");
    const set = fields(((await request.json().catch(() => null)) as Record<string, unknown> | null) ?? {}, b.id, b.stationId);
    if (set instanceof Response) return set;
    Object.assign(b, set, { updatedAt: now().toISOString() });
    saveBlocks();
    return reply(blocksApi.updateBlock.response, blockView(b, true));
  }),

  http.post(path(blocksApi.uploadBlockLogo), async ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const b = blockById(String(params.blockId));
    if (!b || b.stationId !== r.station.ident.id || b.archivedAt) return fail(404, "not_found", "That block wasn't found.");
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return fail(400, "bad_request", "Choose the logo.", { file: "Required" });
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return fail(422, "not_an_image", "Choose a PNG, JPEG or WebP image.");
    // The mock keeps it as a data URL (the API stores it by content ID).
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (const x of bytes) bin += String.fromCharCode(x);
    b.logoUrl = `data:${file.type};base64,${btoa(bin)}`;
    b.updatedAt = now().toISOString();
    saveBlocks();
    return reply(blocksApi.uploadBlockLogo.response, blockView(b, true));
  }),

  http.delete(path(blocksApi.archiveBlock), ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const b = blockById(String(params.blockId));
    if (!b || b.stationId !== r.station.ident.id || b.archivedAt) return fail(404, "not_found", "That block wasn't found.");
    const takeOff = new URL(request.url).searchParams.get("takeOffLog") === "true";
    const t = now().toISOString();
    const s = blocksState();
    const ahead = s.spans.filter((x) => x.blockId === b.id && x.startsAt > t);
    if (ahead.length && !takeOff) return fail(409, "block_on_log", `${b.name} is on the log ${plural(ahead.length, "more time")}. Take it off the log first.`);
    // Dates edited by hand keep theirs.
    const edited = new Set(getDb().templates.flatMap((tpl) => tpl.dates.filter((d) => d.edited).map((d) => d.date)));
    const kept = ahead.filter((x) => edited.has(x.startsAt.slice(0, 10)));
    s.spans = s.spans.filter((x) => !ahead.includes(x) || kept.includes(x));
    s.templateBlocks = s.templateBlocks.filter((tb) => tb.blockId !== b.id);
    b.archivedAt = t;
    saveBlocks();
    return reply(blocksApi.archiveBlock.response, { ok: true, removed: ahead.length - kept.length, kept: kept.length });
  })
];
