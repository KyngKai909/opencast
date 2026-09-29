// Calls the API from the contracts: each endpoint's method, path and schemas come from
// @opencast/contracts, so a call can't drift from what the API mounts. Responses are parsed
// with the endpoint's response schema (extended with fields the apps have asked for, see
// docs/contract-requests.md), so a wrong shape fails loudly here, not three screens later.
//
// A TV holds two tokens (B2), and each endpoint says which it takes:
// - `device` endpoints (the TV's own: codes, the relay, pairing): the device token from
//   registerTv, or the TV session token (both are accepted; the device token first, since it
//   outlives a sign-out);
// - endpoints marked `tvSession` (getMe, presets, reminders…): the TV session token, signed in;
// - everything else: no token. A TV session is refused (403) by any other `user` endpoint, and
//   `public` or `optional` ones don't need one.

import { API_PREFIX, buildPath, ErrorResponse, type EndpointDef } from "@opencast/contracts";
import type { z } from "zod";
import { config } from "../config";

export interface Tokens {
  /** The TV's device token (registerTv). */
  device: string | null;
  /** The TV session token (the code sign-in). */
  session: string | null;
}

export type TokenSource = () => Tokens | Promise<Tokens>;
let getTokens: TokenSource = () => ({ device: null, session: null });

/** TV mode hands the client its tokens (read on every call, so signing in takes effect at once). */
export function setTokenSource(t: TokenSource) {
  getTokens = t;
}

export interface AuthHandlers {
  /** A 401 `tv_signed_out`: the TV session was ended elsewhere. */
  onSessionEnded?: () => void;
  /** A 401 on a device endpoint with the device token: the API doesn't know this TV. Resolve true once registered again. */
  onDeviceUnknown?: () => Promise<boolean>;
}
let handlers: AuthHandlers = {};

export function setAuthHandlers(h: AuthHandlers) {
  handlers = h;
}

/** Which token an endpoint gets (see the top of the file). */
export function tokenFor(endpoint: Pick<EndpointDef, "auth" | "tvSession">, tokens: Tokens): string | null {
  if (endpoint.auth === "device") return tokens.device ?? tokens.session;
  if (endpoint.tvSession) return tokens.session;
  return null;
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

/** The endpoint's full URL. */
export function urlFor(endpoint: EndpointDef, args: CallArgs = {}): string {
  const path = buildPath(endpoint.path, args.params ?? {});
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(args.query ?? {})) if (v !== undefined && v !== null) qs.set(k, String(v));
  return `${config.apiBase}${API_PREFIX}${path}${qs.size ? `?${qs}` : ""}`;
}

/**
 * Sends a request with the right token, and handles what a TV's tokens can answer: a signed-out
 * session is dropped, an unknown device registers again (once) and the request is retried.
 */
export async function send(endpoint: EndpointDef, args: CallArgs = {}, init: { signal?: AbortSignal; accept?: string } = {}): Promise<Response> {
  const attempt = async () => {
    const tokens = await getTokens();
    const token = tokenFor(endpoint, tokens);
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (init.accept) headers.accept = init.accept;
    if (args.body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(urlFor(endpoint, args), { method: endpoint.method, headers, body: args.body === undefined ? undefined : JSON.stringify(args.body), signal: init.signal });
    return { res, usedDevice: !!token && token === tokens.device };
  };
  let { res, usedDevice } = await attempt();
  if (res.status === 401) {
    const code = await errorCode(res);
    if (code === "tv_signed_out") handlers.onSessionEnded?.();
    else if (usedDevice && endpoint.auth === "device" && handlers.onDeviceUnknown && (await handlers.onDeviceUnknown())) ({ res } = await attempt());
  }
  return res;
}

async function errorCode(res: Response): Promise<string | null> {
  const json = await res
    .clone()
    .json()
    .catch(() => null);
  const e = ErrorResponse.safeParse(json);
  return e.success ? e.data.error.code : null;
}

/** The API's error from a failed response, in its words. */
export async function apiError(res: Response): Promise<ApiError> {
  const json = await res.json().catch(() => null);
  const e = ErrorResponse.safeParse(json);
  if (e.success) return new ApiError(res.status, e.data.error.code, e.data.error.message, e.data.error.fields);
  // A 404 without the API's error body is a route the API doesn't mount: a proposed endpoint
  // (api/ext*, docs/contract-requests.md) that hasn't landed. Trying again wouldn't help.
  if (res.status === 404) return new ApiError(404, "not_available", "This isn't available yet.");
  return new ApiError(res.status, "error", "Something went wrong. Try again.");
}

/** Calls an endpoint. `schema` overrides the response schema (an extended one). */
export async function call<E extends EndpointDef, S extends z.ZodType = E["response"]>(endpoint: E, args: CallArgs = {}, schema?: S): Promise<z.infer<S>> {
  const res = await send(endpoint, args);
  if (res.status === 204) return undefined as z.infer<S>;
  if (!res.ok) throw await apiError(res);
  const json = await res.json().catch(() => null);
  const parsed = ((schema ?? endpoint.response) as z.ZodType).safeParse(json);
  if (!parsed.success) {
    console.error(`${endpoint.method} ${endpoint.path}: the response doesn't match its contract`, parsed.error.issues);
    throw new ApiError(500, "bad_response", "Something went wrong. Try again.");
  }
  return parsed.data as z.infer<S>;
}
