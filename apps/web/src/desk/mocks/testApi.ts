// Tests only: call the mock handlers as the API would be called, as someone.
import { getResponse, type HttpHandler } from "msw";

export const WHO: Record<string, string> = { dee: "dee@opencast.example", other: "someone@example.com" };

export function apiFor(handlers: HttpHandler[]) {
  return async function api(method: string, path: string, o: { as?: string | null; body?: unknown; query?: Record<string, string> } = {}) {
    const url = new URL(`http://localhost/v1${path}`);
    for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v);
    const as = o.as === undefined ? "dee" : o.as;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (as) headers.authorization = `Bearer mock-access-token:${WHO[as] ?? as}`;
    const req = new Request(url, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
    const res = await getResponse(handlers, req);
    if (!res) throw new Error(`No mock for ${method} ${path}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, json: (await res.json()) as any };
  };
}
