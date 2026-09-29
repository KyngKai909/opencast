// Mock responses are parsed with the endpoint's (extended) response schema before they're sent, so
// mocks can't drift from the contracts. Every desk endpoint is `auth: "admin"`: needsAdmin answers
// 401 signed out and 403 for anyone who isn't on the Opencast team.

import { HttpResponse } from "msw";
import type { EndpointDef } from "@opencast/contracts";
import type { z } from "zod";
import { MOCK_TOKEN_PREFIX } from "../auth/mockToken";
import { personByEmail, type MockPerson } from "./fixtures/people";

/** The MSW path for an endpoint (Express-style params are MSW's too). */
export function path(e: EndpointDef): string {
  return `*/v1${e.path}`;
}

export function reply<S extends z.ZodType>(schema: S, data: z.input<S>, status = 200) {
  const r = schema.safeParse(data);
  if (!r.success) {
    console.error("Mock response doesn't match its contract", r.error.issues, data);
    return HttpResponse.json({ error: { code: "mock_contract", message: "The mock broke its contract (see the console)." } }, { status: 500 });
  }
  return HttpResponse.json(r.data as never, { status });
}

export function fail(status: number, code: string, message: string, fields?: Record<string, string>) {
  return HttpResponse.json({ error: { code, message, ...(fields ? { fields } : {}) } }, { status });
}

/** Who the request is from (the mock sign-in's email), or null when signed out. */
export function personOf(request: Request): MockPerson | null {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token.startsWith(MOCK_TOKEN_PREFIX)) return null;
  return personByEmail(token.slice(MOCK_TOKEN_PREFIX.length));
}

/** The person, or the 401 to return. */
export function needsUser(request: Request): MockPerson | Response {
  return personOf(request) ?? fail(401, "unauthorized", "Sign in to do that.");
}

/** Someone on the Opencast team, or the 401 or 403 to return. */
export function needsAdmin(request: Request): MockPerson | Response {
  const p = personOf(request);
  if (!p) return fail(401, "unauthorized", "Sign in to do that.");
  if (!p.isAdmin) return fail(403, "forbidden", "Network desk is for the Opencast team.");
  return p;
}

/** The request's JSON body, or null. */
export async function bodyOf<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
