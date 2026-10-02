// Calls the API from the contracts: each endpoint's method, path and schemas come from
// @opencast/contracts, so a call can't drift from what the API mounts. Responses are parsed with
// the endpoint's response schema. The site only calls public endpoints, so there's no token.

import { API_PREFIX, buildPath, ErrorResponse, type EndpointDef } from "@opencast/contracts";
import type { z } from "zod";
import { config } from "../config";

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

/** The request never got an answer: offline, or the API is down. */
export class NetworkError extends Error {}

export interface CallArgs {
  params?: Record<string, string | number>;
  body?: unknown;
  signal?: AbortSignal;
}

export async function call<E extends EndpointDef>(endpoint: E, args: CallArgs = {}): Promise<z.infer<E["response"]>> {
  const url = `${config.apiBase}${API_PREFIX}${buildPath(endpoint.path, args.params ?? {})}`;
  const init: RequestInit = { method: endpoint.method, signal: args.signal };
  if (args.body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(args.body);
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new NetworkError("offline");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = ErrorResponse.safeParse(json);
    throw e.success ? new ApiError(res.status, e.data.error.code, e.data.error.message, e.data.error.fields) : new ApiError(res.status, "error", "Something went wrong. Try again.");
  }
  const parsed = (endpoint.response as z.ZodType).safeParse(json);
  if (!parsed.success) {
    console.error(`${endpoint.method} ${endpoint.path}: the response doesn't match its contract`, parsed.error.issues);
    throw new ApiError(500, "bad_response", "Something went wrong. Try again.");
  }
  return parsed.data as z.infer<E["response"]>;
}
