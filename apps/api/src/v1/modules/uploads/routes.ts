import express, { type Router } from "express";
import { LOCAL_UPLOAD_PART_PATH, uploadsApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

export function uploadsRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { uploads } = services;
  r.handle(api.createUpload, ({ user, body }) => uploads.create(user, body));
  r.handle(api.signUploadParts, ({ user, params, body }) => uploads.sign(user, params.uploadId, body.partNumbers));
  r.handle(api.listUploadParts, ({ user, params }) => uploads.parts(user, params.uploadId));
  r.handle(api.completeUpload, ({ user, params, body }) => uploads.complete(user, params.uploadId, body.parts));
  r.handle(api.abortUpload, async ({ user, params }) => {
    await uploads.abort(user, params.uploadId);
    return { ok: true as const };
  });
  r.handle(api.getUpload, ({ user, params }) => uploads.view(user, params.uploadId));
}

/**
 * The local protocol's part PUT (`LOCAL_UPLOAD_PART_PATH`, development and tests; 404 in
 * production): the part's bytes stream to disk as they come, with no body parser in front (mounted
 * before the JSON one). Signed like an S3 part URL, so it needs no sign-in header. Answers with the
 * part's ETag, exposed to the browser as a bucket's CORS rule would.
 */
export function localUploadPartRoute(router: Router, { services }: ModuleContext) {
  router.put(LOCAL_UPLOAD_PART_PATH, async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const query = req.query as { expires?: string; signature?: string };
      const { etag } = await services.uploads.acceptLocalPart(String(req.params.uploadId), Number(req.params.partNumber), { expires: query.expires, signature: query.signature }, req);
      res.set({ ETag: etag, "Access-Control-Expose-Headers": "ETag" }).status(200).end();
    } catch (error) {
      // The uploader went away mid-part (a dropped connection, a closed tab): nothing to answer, and
      // the part is sent again when it resumes.
      if ((error as { code?: string }).code === "ECONNRESET" || req.destroyed) return;
      // The rest of the part isn't wanted.
      req.resume();
      next(error);
    }
  });
}
