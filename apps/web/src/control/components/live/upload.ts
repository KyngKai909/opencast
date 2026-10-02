// Sending a file (follow-up Phase 4): straight from the browser to object storage in parts, with
// progress, pause, resume and retry (@opencast/ui/upload: Uppy and its S3 multipart plugin), through
// the API's upload endpoints (`uploadsApi`). The library, replacing an item's file, a radio station's
// relay background and a production order's delivery all send files this way. The old multipart
// form endpoints still answer, but nothing here uses them any more.

import { useDirectUpload, uploadClient, type CallEndpoint, type DirectUploadOptions } from "@opencast/ui/upload";
import { call } from "../../../api/client";
import { config } from "../../../config";

/** The uploader's calls to the API, with the app's own client. */
export const uploads = uploadClient(call as CallEndpoint, config.apiBase);

/**
 * A direct-upload widget's state (`items`, `add`, pause, resume, retry, remove). Kept across reloads
 * against the real API (Golden Retriever); the mocks forget uploads on a reload, so not there.
 */
export function useUpload(options: Omit<DirectUploadOptions, "client">) {
  return useDirectUpload({ client: uploads, resume: !config.mock, ...options });
}
