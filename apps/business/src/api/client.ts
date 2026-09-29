// Calls the API from the contracts: each endpoint's method, path and schemas come from
// @opencast/contracts, so a call can't drift from what the API mounts. Responses are parsed
// with the endpoint's response schema (or one given, like api/ext/spots.ts's reading of a spot), so
// a wrong shape fails loudly here, not three screens later.

import { API_PREFIX, buildPath, ErrorResponse, type EndpointDef } from "@opencast/contracts";
import type { z } from "zod";
import { config } from "../config";

export type Token = () => Promise<string | null>;
let getToken: Token = async () => null;

/**
 * An address the API gave for something it serves itself (a receipt's PDF, a logo, a checkout's
 * webhook address): full once the API has API_PUBLIC_URL (A117); a path on the API before that.
 */
export function apiUrl(u: string): string {
  return u.startsWith("/") && !u.startsWith("//") && /^https?:\/\//.test(config.apiBase) ? `${config.apiBase}${u}` : u;
}

/** Sign-in hands the client a way to get the current access token. */
export function setTokenSource(t: Token) {
  getToken = t;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>
  ) {
    super(message);
  }
}

export interface CallArgs {
  params?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
}

/** Calls an endpoint. `schema` overrides the response schema (an extended one). */
export async function call<E extends EndpointDef, S extends z.ZodType = E["response"]>(endpoint: E, args: CallArgs = {}, schema?: S): Promise<z.infer<S>> {
  const path = buildPath(endpoint.path, args.params ?? {});
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(args.query ?? {})) if (v !== undefined && v !== null) qs.set(k, String(v));
  const url = `${config.apiBase}${API_PREFIX}${path}${qs.size ? `?${qs}` : ""}`;
  const headers: Record<string, string> = {};
  if (endpoint.auth !== "public") {
    const token = await getToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }
  // Multipart endpoints (an upload): the body's fields plus `file`, as form data.
  let body: BodyInit | undefined;
  if (args.body instanceof FormData) body = args.body;
  else if (endpoint.multipart && args.body && typeof args.body === "object") {
    const form = new FormData();
    for (const [k, v] of Object.entries(args.body as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      form.append(k, v instanceof Blob ? v : typeof v === "string" ? v : JSON.stringify(v));
    }
    body = form;
  } else if (args.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(args.body);
  }
  const res = await fetch(url, { method: endpoint.method, headers, body });
  if (res.status === 204) return undefined as z.infer<S>;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = ErrorResponse.safeParse(json);
    if (e.success) throw new ApiError(res.status, e.data.error.code, e.data.error.message, e.data.error.fields);
    // A 404 without the API's error body is a route this API doesn't have (an older API than the
    // contracts, or the mock-only spot actions in api/ext/spots.ts).
    if (res.status === 404) throw new ApiError(404, "not_available", "That isn't available yet.");
    throw new ApiError(res.status, "error", "Something went wrong. Try again.");
  }
  const parsed = ((schema ?? endpoint.response) as z.ZodType).safeParse(json);
  if (!parsed.success) {
    console.error(`${endpoint.method} ${endpoint.path}: the response doesn't match its contract`, parsed.error.issues);
    throw new ApiError(500, "bad_response", "Something went wrong. Try again.");
  }
  return parsed.data as z.infer<S>;
}
