import { uploadsApi, type EndpointDef } from "@opencast/contracts";
import type { UploadClient } from "./uploader";

/** How an app calls an endpoint: its own `call` (token, errors, response parsing). */
export type CallEndpoint = <E extends EndpointDef>(endpoint: E, args?: { params?: Record<string, string | number>; body?: unknown }) => Promise<unknown>;

/**
 * The uploader's API calls, made with an app's own `call`. `apiBase` goes in front of the local
 * protocol's part URLs (paths on the API); bucket URLs are used as they are.
 */
export function uploadClient(call: CallEndpoint, apiBase: string): UploadClient {
  const base = apiBase.replace(/\/+$/, "");
  const api = uploadsApi;
  return {
    create: async (body) => (await call(api.createUpload, { body })) as Awaited<ReturnType<UploadClient["create"]>>,
    sign: async (uploadId, partNumbers) => ((await call(api.signUploadParts, { params: { uploadId }, body: { partNumbers } })) as { parts: Awaited<ReturnType<UploadClient["sign"]>> }).parts,
    list: async (uploadId) => ((await call(api.listUploadParts, { params: { uploadId } })) as { parts: Awaited<ReturnType<UploadClient["list"]>> }).parts,
    complete: async (uploadId, parts) => (await call(api.completeUpload, { params: { uploadId }, body: { parts } })) as Awaited<ReturnType<UploadClient["complete"]>>,
    abort: async (uploadId) => {
      await call(api.abortUpload, { params: { uploadId } });
    },
    get: async (uploadId) => (await call(api.getUpload, { params: { uploadId } })) as Awaited<ReturnType<UploadClient["get"]>>,
    resolveUrl: (url) => (url.startsWith("/") ? `${base}${url}` : url)
  };
}
