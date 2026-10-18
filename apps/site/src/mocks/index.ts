// The in-page mocks, loaded only when there's no PUBLIC_API_URL: each endpoint the site calls,
// answered with the endpoint's own schemas so a mock can't drift from the contracts. A short
// delay makes the sending states visible.
import type { EndpointDef } from "@contracts/core";
import type { MockReply } from "../lib/api";
import * as waitlist from "./waitlist";
import { contactApi } from "../api/contact";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function answer(endpoint: EndpointDef, path: string, body: unknown): Promise<MockReply> {
  await wait(endpoint.method === "GET" ? 150 : 450);
  if (endpoint.method === "POST" && endpoint.path === "/waitlist") return waitlist.join(body);
  if (endpoint.method === "GET" && endpoint.path === "/call-signs/:callSign") return waitlist.checkCallSign(decodeURIComponent(path.split("/").pop() ?? ""));
  if (endpoint.method === "POST" && endpoint.path === "/contact") {
    const parsed = contactApi.send.body.safeParse(body);
    if (!parsed.success) return { status: 400, json: { error: { code: "bad_request", message: "Check the form.", fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "body", i.message])) } } };
    return { status: 201, json: { desk: parsed.data.desk, receivedAt: new Date().toISOString() } };
  }
  return { status: 404, json: { error: { code: "not_found", message: `No mock for ${endpoint.method} ${endpoint.path}.` } } };
}
