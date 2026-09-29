// Calls the API from the contracts: each endpoint's method, path and schemas come from
// @opencast/contracts, so a call can't drift from what the API mounts. Responses are parsed
// with the endpoint's response schema (extended with fields the apps have asked for, see
// docs/contract-requests.md), so a wrong shape fails loudly here, not three screens later.

import { API_PREFIX, buildPath, ErrorResponse, type EndpointDef } from "@opencast/contracts";
import type { z } from "zod";
import { config } from "../config";

export type Token = () => Promise<string | null>;
let getToken: Token = async () => null;

/** Sign-in hands the client a way to get the current access token. */
export function setTokenSource(t: Token) {
  getToken = t;
}

/** The current access token, for requests `call` can't make (the remote relay's event streams). */
export const accessToken: Token = () => getToken();

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
  if (args.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(url, { method: endpoint.method, headers, body: args.body === undefined ? undefined : JSON.stringify(args.body) });
  if (res.status === 204) return undefined as z.infer<S>;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = ErrorResponse.safeParse(json);
    throw e.success ? new ApiError(res.status, e.data.error.code, e.data.error.message, e.data.error.fields) : new ApiError(res.status, "error", "Something went wrong. Try again.");
  }
  const parsed = ((schema ?? endpoint.response) as z.ZodType).safeParse(json);
  if (!parsed.success) {
    console.error(`${endpoint.method} ${endpoint.path}: the response doesn't match its contract`, parsed.error.issues);
    throw new ApiError(500, "bad_response", "Something went wrong. Try again.");
  }
  return parsed.data as z.infer<S>;
}
