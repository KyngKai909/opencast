// Mock responses are parsed with the endpoint's response schema before they're sent, so the
// mocks can't drift from the contracts.

import { HttpResponse } from "msw";
import type { EndpointDef } from "@opencast/contracts";
import type { z } from "zod";

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
