// Sending a file: library.upload and the proposed replaceFile (L6) are multipart, which the JSON
// client doesn't do. Same path, token and error shape as api/client.ts.

import { API_PREFIX, buildPath, ErrorResponse, type EndpointDef } from "@opencast/contracts";
import type { z } from "zod";
import { ApiError } from "../../api/client";
import { config } from "../../config";

export async function sendFile<E extends EndpointDef, S extends z.ZodType = E["response"]>(
  endpoint: E,
  params: Record<string, string>,
  file: File,
  fields: Record<string, string | undefined>,
  getToken: () => Promise<string | null>,
  schema?: S
): Promise<z.infer<S>> {
  const body = new FormData();
  body.set("file", file);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) body.set(k, v);
  const token = await getToken();
  const res = await fetch(`${config.apiBase}${API_PREFIX}${buildPath(endpoint.path, params)}`, {
    method: endpoint.method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = ErrorResponse.safeParse(json);
    throw e.success ? new ApiError(res.status, e.data.error.code, e.data.error.message) : new ApiError(res.status, "error", "Something went wrong. Try again.");
  }
  const parsed = ((schema ?? endpoint.response) as z.ZodType).safeParse(json);
  if (!parsed.success) throw new ApiError(500, "bad_response", "Something went wrong. Try again.");
  return parsed.data as z.infer<S>;
}
