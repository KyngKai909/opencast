import { z } from "zod";

/**
 * Who can call an endpoint.
 * - `public`: anyone, signed in or not (watching needs no account).
 * - `optional`: anyone; a signed-in caller gets personalised results.
 * - `user`: a signed-in Privy user. Roles on a station or business are checked per request.
 * - `admin`: an Opencast admin (Network desk).
 * - `device`: a TV app (added 2026-09-28): its `deviceToken` from `tv.registerTv`, or its TV
 *   session token once it's signed in, as `Authorization: Bearer`.
 *
 * A TV session token (from `tv.pollTvCode`) is accepted as `user` only by endpoints marked
 * `tvSession: true`, acting as the person who approved the TV; every other `user` or `admin`
 * endpoint answers it 403 `tv_not_allowed`.
 */
export type Auth = "public" | "optional" | "user" | "admin" | "device";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface EndpointDef {
  method: Method;
  /** Express-style path under `/v1`, e.g. `/stations/:stationId`. */
  path: string;
  auth: Auth;
  summary: string;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** The body is multipart form data with a `file` field; `body` describes the other fields. */
  multipart?: boolean;
  response: z.ZodType;
  /** Status for a successful response. Defaults to 200 (201 for POST that creates). */
  status?: number;
  /**
   * Also accepts a TV session token as `user` (added 2026-09-28): the TV acts as the person who
   * signed it in. Only the account endpoints a TV uses carry this.
   */
  tvSession?: boolean;
  /**
   * Server-Sent Events (added 2026-09-28): the response is a `text/event-stream`, not JSON. Each
   * event's name is a key here and its `data` is JSON matching the schema. The server sends a
   * comment (`: ping`) every 25 seconds. `response` describes the events as `{ event, data }`, for
   * documentation and mocks. Browsers' EventSource can't send `Authorization`, so read these with
   * `fetch` and a stream reader (or an EventSource that takes headers).
   */
  events?: Record<string, z.ZodType>;
}

/** Declares an endpoint. The API validates requests against it; the apps build clients and mocks from it. */
export function endpoint<const D extends EndpointDef>(def: D): D {
  return def;
}

export type Params<E extends EndpointDef> = E["params"] extends z.ZodType ? z.infer<E["params"]> : Record<string, never>;
export type Query<E extends EndpointDef> = E["query"] extends z.ZodType ? z.infer<E["query"]> : Record<string, never>;
export type Body<E extends EndpointDef> = E["body"] extends z.ZodType ? z.infer<E["body"]> : undefined;
export type Response<E extends EndpointDef> = z.infer<E["response"]>;

/** Every error has this shape. `code` is stable; `message` is plain words for the person. */
export const ErrorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Field-level problems for a form. */
    fields: z.record(z.string(), z.string()).optional()
  })
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/** Fills a path's `:params`, e.g. `buildPath("/stations/:id", { id })`. */
export function buildPath(path: string, params: Record<string, string | number> = {}): string {
  return path.replace(/:([A-Za-z]+)/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) {
      throw new Error(`Missing path parameter ${key} for ${path}`);
    }
    return encodeURIComponent(String(value));
  });
}
