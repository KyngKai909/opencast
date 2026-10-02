// Direct uploads in the apps' mock mode (contracts of 2026-09-30, follow-up Phase 4), for Mock Service
// Worker: part URLs on the local protocol's path, each part's PUT answered with its ETag (exposed, as
// a bucket's CORS rule would), the parts listed for a resume, and "Checking" for a moment once every
// part is in. Then each app finishes the file its own way, usually with the work its mock's old form
// endpoint does, so what an upload makes is what that mock already makes. The same file twice is
// "stored once". Used by master control's and the business app's mocks.

import { http, HttpResponse, type HttpHandler } from "msw";
import {
  CreateUpload,
  LOCAL_UPLOAD_PART_PATH,
  UPLOAD_MAX_BYTES,
  UPLOAD_PARALLEL_PARTS,
  UPLOAD_SIGN_BATCH,
  uploadPartCount,
  uploadPartSize,
  uploadsApi,
  type UploadPurpose,
  type UploadView
} from "@opencast/contracts";

/** How long the mock is "Checking" once every part is in. */
export const MOCK_CHECKING_MS = 600;
/** Parts' bytes are kept (to hand the file on) up to this much per upload; bigger ones are counted, not kept. */
const KEEP_BYTES = 64 * 1024 * 1024;

export interface MockUploadOptions {
  /** Who's asking, or the 401 to answer. */
  who(request: Request): { id: string } | Response;
  /** The role check at `createUpload`, or null to let it through (the finishing endpoint checks again). */
  check?(request: Request, purpose: UploadPurpose): Response | null;
  /**
   * What the file becomes, as the person who sent it (`request` carries their sign-in): usually the
   * mock's old form endpoint's own work, given the file. `res` is that answer; not ok fails the
   * upload with its error.
   */
  finish(purpose: UploadPurpose, file: File, request: Request): Promise<{ res: Response; state: "preparing" | "done"; result: UploadView["result"] }>;
  /** Answers errors in the app's shape. */
  fail(status: number, code: string, message: string): Response;
}

interface MockUpload {
  id: string;
  personId: string;
  purpose: UploadPurpose;
  filename: string;
  contentType: string;
  bytes: number;
  partSize: number;
  partCount: number;
  state: UploadView["state"];
  parts: Map<number, { etag: string; size: number; blob: Blob | null }>;
  checkingSince: number;
  finishing: Promise<void> | null;
  contentId: string | null;
  duplicate: boolean;
  result: UploadView["result"];
  error: UploadView["error"];
  createdAt: string;
  updatedAt: string;
}

const parse = <S extends { parse(x: unknown): unknown }>(schema: S, data: unknown) => schema.parse(data) as never;

/** A stand-in content ID from the name, size and type (the mock doesn't hash): the same file twice gets the same one. */
function mockContentId(u: MockUpload): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const seed = `${u.filename}:${u.bytes}:${u.contentType}`;
  let h = 2166136261;
  let out = "bafkrei";
  for (let i = 0; out.length < 59; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i % seed.length) ^ i, 16777619) >>> 0;
    out += alphabet[h % 32];
  }
  return out;
}

export function mockUploadHandlers(options: MockUploadOptions): HttpHandler[] {
  const uploads = new Map<string, MockUpload>();
  const stored = new Set<string>();
  const { fail } = options;
  const json = (schema: { parse(x: unknown): unknown }, data: unknown, status = 200) => HttpResponse.json(parse(schema, data), { status });
  const at = (e: { path: string }) => `*/v1${e.path}`;

  const view = (u: MockUpload): UploadView => ({
    id: u.id,
    purpose: u.purpose.kind,
    filename: u.filename,
    bytes: u.bytes,
    contentType: u.contentType,
    state: u.state,
    partSize: u.partSize,
    partCount: u.partCount,
    contentId: u.contentId,
    duplicate: u.duplicate,
    result: u.result,
    error: u.error,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    completedAt: u.state === "uploading" ? null : u.updatedAt
  });
  const partUrl = (id: string, n: number) => `/v1${LOCAL_UPLOAD_PART_PATH.replace(":uploadId", id).replace(":partNumber", String(n))}?expires=${Math.floor(Date.now() / 1000) + 3600}&signature=mock`;
  const signed = (u: MockUpload, numbers: number[]) => numbers.map((partNumber) => ({ partNumber, url: partUrl(u.id, partNumber), expiresAt: new Date(Date.now() + 3600_000).toISOString() }));
  const own = (request: Request, id: string): MockUpload | Response => {
    const p = options.who(request);
    if (p instanceof Response) return p;
    const u = uploads.get(id);
    if (!u || u.personId !== p.id) return fail(404, "not_found", "That upload wasn't found.");
    return u;
  };
  const body = async (request: Request): Promise<unknown> => request.json().catch(() => null);

  async function finish(request: Request, u: MockUpload) {
    const kept = [...u.parts.entries()].sort(([a], [b]) => a - b).map(([, p]) => p.blob);
    const blob = kept.length && kept.every(Boolean) ? new Blob(kept as Blob[], { type: u.contentType }) : new Blob([new Uint8Array(Math.min(u.bytes, 1024))], { type: u.contentType });
    const file = new File([blob], u.filename, { type: u.contentType });
    const done = await options.finish(u.purpose, file, request);
    if (!done.res.ok) {
      const answer = (await done.res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
      u.state = "failed";
      u.error = answer?.error ? { code: answer.error.code, message: answer.error.message } : { code: "failed", message: "That upload couldn't be finished." };
      return;
    }
    u.contentId = mockContentId(u);
    u.duplicate = stored.has(u.contentId);
    stored.add(u.contentId);
    u.state = done.state;
    u.result = done.result;
  }

  return [
    http.post(at(uploadsApi.createUpload), async ({ request }) => {
      const p = options.who(request);
      if (p instanceof Response) return p;
      const parsed = CreateUpload.safeParse(await body(request.clone()));
      if (!parsed.success) return fail(400, "bad_request", "Check the form.");
      const { purpose, filename, size, contentType } = parsed.data;
      const denied = options.check?.(request, purpose);
      if (denied) return denied;
      if (size > UPLOAD_MAX_BYTES[purpose.kind]) return fail(422, "too_big", "That file is too big for this.");
      const t = new Date().toISOString();
      const u: MockUpload = {
        id: crypto.randomUUID(),
        personId: p.id,
        purpose,
        filename,
        contentType: contentType || "application/octet-stream",
        bytes: size,
        partSize: uploadPartSize(size),
        partCount: uploadPartCount(size),
        state: "uploading",
        parts: new Map(),
        checkingSince: 0,
        finishing: null,
        contentId: null,
        duplicate: false,
        result: null,
        error: null,
        createdAt: t,
        updatedAt: t
      };
      uploads.set(u.id, u);
      return json(
        uploadsApi.createUpload.response,
        {
          id: u.id,
          key: `uploads/${u.id}`,
          protocol: "local",
          partSize: u.partSize,
          partCount: u.partCount,
          parallel: UPLOAD_PARALLEL_PARTS,
          parts: signed(u, Array.from({ length: Math.min(u.partCount, UPLOAD_SIGN_BATCH) }, (_, i) => i + 1)),
          state: "uploading",
          expiresAt: new Date(Date.now() + 86400e3).toISOString()
        },
        201
      );
    }),

    http.post(at(uploadsApi.signUploadParts), async ({ request, params }) => {
      const u = own(request, String(params.uploadId));
      if (u instanceof Response) return u;
      if (u.state !== "uploading") return fail(409, "not_uploading", "That upload isn't taking parts any more.");
      const asked = uploadsApi.signUploadParts.body.safeParse(await body(request));
      if (!asked.success || asked.data.partNumbers.some((n) => n > u.partCount)) return fail(422, "no_such_part", "That upload doesn't have that part.");
      return json(uploadsApi.signUploadParts.response, { parts: signed(u, asked.data.partNumbers) });
    }),

    http.get(at(uploadsApi.listUploadParts), ({ request, params }) => {
      const u = own(request, String(params.uploadId));
      if (u instanceof Response) return u;
      if (u.state !== "uploading") return fail(409, "not_uploading", "That upload isn't taking parts any more.");
      return json(uploadsApi.listUploadParts.response, { parts: [...u.parts].map(([partNumber, part]) => ({ partNumber, etag: part.etag, size: part.size })) });
    }),

    // A part's bytes, to its signed URL (no sign-in header, as with a bucket).
    http.put(`*/v1${LOCAL_UPLOAD_PART_PATH}`, async ({ request, params }) => {
      const u = uploads.get(String(params.uploadId));
      const n = Number(params.partNumber);
      if (!u || new URL(request.url).searchParams.get("signature") !== "mock") return fail(403, "signature", "That part URL has expired or isn't signed.");
      if (u.state !== "uploading") return fail(409, "not_uploading", "That upload isn't taking parts any more.");
      const blob = await request.blob();
      const etag = `"mock-${u.id.slice(0, 8)}-${n}-${blob.size}"`;
      u.parts.set(n, { etag, size: blob.size, blob: u.bytes <= KEEP_BYTES ? blob : null });
      return new HttpResponse(null, { status: 200, headers: { ETag: etag, "Access-Control-Expose-Headers": "ETag" } });
    }),

    http.post(at(uploadsApi.completeUpload), async ({ request, params }) => {
      const u = own(request, String(params.uploadId));
      if (u instanceof Response) return u;
      if (u.state === "failed" || u.state === "aborted") return fail(409, "not_uploading", "That upload was cancelled or couldn't be finished. Upload the file again.");
      if (u.state === "uploading") {
        const given = uploadsApi.completeUpload.body.safeParse(await body(request));
        const etags = new Map((given.success ? given.data.parts : []).map((p) => [p.partNumber, p.etag]));
        for (let n = 1; n <= u.partCount; n++) {
          if (!u.parts.has(n) || etags.get(n) !== u.parts.get(n)!.etag) return fail(409, "parts_missing", `Part ${n} of ${u.partCount} isn't in yet. Resume the upload.`);
        }
        u.state = "checking";
        u.checkingSince = Date.now();
        u.updatedAt = new Date().toISOString();
      }
      return json(uploadsApi.completeUpload.response, view(u));
    }),

    http.delete(at(uploadsApi.abortUpload), ({ request, params }) => {
      const u = own(request, String(params.uploadId));
      if (u instanceof Response) return u;
      if (u.state === "uploading") {
        u.state = "aborted";
        u.parts.clear();
      }
      return json(uploadsApi.abortUpload.response, { ok: true });
    }),

    http.get(at(uploadsApi.getUpload), async ({ request, params }) => {
      const u = own(request, String(params.uploadId));
      if (u instanceof Response) return u;
      if (u.state === "checking" && Date.now() - u.checkingSince >= MOCK_CHECKING_MS) {
        u.finishing ??= finish(request, u).then(() => {
          u.parts.clear();
          u.updatedAt = new Date().toISOString();
        });
        await u.finishing;
      }
      return json(uploadsApi.getUpload.response, view(u));
    })
  ];
}
