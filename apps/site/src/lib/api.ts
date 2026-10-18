// Calls the API from the contracts: each endpoint's method, path and schemas come from
// packages/contracts (one file at a time, `@contracts/<file>`), so a call can't drift from what
// the API mounts. Responses are parsed with the endpoint's schema. With no PUBLIC_API_URL, calls
// are answered by the in-page mocks (src/mocks), so the site runs with no API.
import "./zod";
import { buildPath, ErrorResponse, type EndpointDef } from "@contracts/core";
import type { z } from "zod";
import { API_URL } from "../data/links";

/** The contracts' `API_PREFIX` (index.ts), which can't be imported without the whole package. */
const API_PREFIX = "/v1";

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

/** What a mock answers: the status and the JSON. */
export interface MockReply {
  status: number;
  json: unknown;
}

export const mocked = () => !API_URL;

export async function call<E extends EndpointDef>(endpoint: E, args: CallArgs = {}): Promise<z.infer<E["response"]>> {
  const path = buildPath(endpoint.path, args.params ?? {});
  let status: number, json: unknown;
  if (mocked()) {
    const { answer } = await import("../mocks/index");
    ({ status, json } = await answer(endpoint, path, args.body));
  } else {
    const init: RequestInit = { method: endpoint.method };
    if (args.signal) init.signal = args.signal;
    if (args.body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(args.body);
    }
    let res: Response;
    try {
      res = await fetch(`${API_URL}${API_PREFIX}${path}`, init);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      throw new NetworkError("offline");
    }
    status = res.status;
    json = await res.json().catch(() => null);
  }
  if (status >= 400) {
    const e = ErrorResponse.safeParse(json);
    throw e.success ? new ApiError(status, e.data.error.code, e.data.error.message, e.data.error.fields) : new ApiError(status, "error", "Something went wrong. Try again.");
  }
  const parsed = (endpoint.response as z.ZodType).safeParse(json);
  if (!parsed.success) {
    console.error(`${endpoint.method} ${endpoint.path}: the response doesn't match its contract`, parsed.error.issues);
    throw new ApiError(500, "bad_response", "Something went wrong. Try again.");
  }
  return parsed.data as z.infer<E["response"]>;
}
