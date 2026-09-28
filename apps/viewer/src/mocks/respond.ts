// Mock responses are parsed with the endpoint's (extended) response schema before they're
// sent, so mocks can't drift from the contracts.

import { HttpResponse } from "msw";
import type { EndpointDef } from "@opencast/contracts";
import type { z } from "zod";

export const MOCK_TOKEN = "mock-access-token";

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

export function fail(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status });
}

/** Null when the request carries the mock sign-in; otherwise the 401 to return. */
export function needsUser(request: Request) {
  return request.headers.get("authorization") === `Bearer ${MOCK_TOKEN}` ? null : fail(401, "unauthorized", "Sign in to do that.");
}
