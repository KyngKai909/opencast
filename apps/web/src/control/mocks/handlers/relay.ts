// Relays (follow-up Phase 3; relayApi in contracts/relay.ts): the Translators page's relay mode,
// "During breaks, relays show", "Station bug on relays", "Save relays as YouTube videos", relay
// hours and cost this month, and each platform's next restart. Fixtures in ../fixtures/relay.ts;
// the platforms come from the platforms mock (handlers/platforms.ts), the month from the Station
// account's (fixtures/account.ts). Owners and operators see and change it; hosts and strangers
// get the other master control mocks' 403.

import { http, type HttpHandler } from "msw";
import { relayApi, RelaySettings } from "@opencast/contracts";
import { getDb, membership } from "../db";
import { stationAccount } from "../fixtures/account";
import { availableMicros } from "../fixtures/earnings";
import { mockRelay, relayRestarts, relayView, type MockPlatform } from "../fixtures/relay";
import { bodyOf, fail, path, reply } from "../respond";
import { roleOn } from "./log";
import { mockPlatformsOf } from "./platforms";

function platformsOf(stationId: string): MockPlatform[] {
  return mockPlatformsOf(stationId)
    .filter((c) => c.status === "connected" && c.hasStreamKey)
    .map((c) => ({ platformId: c.id, kind: c.kind, name: c.name, connected: c.method === "signed_in" }));
}

function view(stationId: string, personId: string) {
  const owner = membership(stationId, personId)?.role === "owner";
  const link = getDb().clearLinks[personId];
  const account = stationAccount(stationId, { owner, clear: owner && link ? { address: link.address, access: link.access } : null, earningsAvailableMicros: availableMicros(stationId) });
  return relayView(stationId, platformsOf(stationId), account);
}

export const relayHandlers: HttpHandler[] = [
  http.get(path(relayApi.getRelay), ({ request, params }) => {
    const id = String(params.stationId);
    const r = roleOn(request, id, ["owner", "operator"]);
    if (r instanceof Response) return r;
    return reply(relayApi.getRelay.response, view(id, r.person.id));
  }),

  http.patch(path(relayApi.updateRelay), async ({ request, params }) => {
    const id = String(params.stationId);
    const r = roleOn(request, id, ["owner", "operator"]);
    if (r instanceof Response) return r;
    const parsed = RelaySettings.partial().safeParse((await bodyOf(request)) ?? {});
    if (!parsed.success) return fail(400, "bad_request", "That isn't a relay setting.");
    const relay = mockRelay(id, platformsOf(id));
    relay.settings = { ...relay.settings, ...Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) };
    // Spots off relays: nothing more to mark or remind about.
    if (relay.settings.breakHandling === "station_id_slate") relay.paid = {};
    return reply(relayApi.updateRelay.response, view(id, r.person.id));
  }),

  http.get(path(relayApi.listRelayRestarts), ({ request, params }) => {
    const id = String(params.stationId);
    const r = roleOn(request, id, ["owner", "operator"]);
    if (r instanceof Response) return r;
    const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? 50) || 50));
    return reply(relayApi.listRelayRestarts.response, relayRestarts(id, platformsOf(id), limit));
  }),

  http.post(path(relayApi.dismissPaidPromotionReminder), ({ request, params }) => {
    const id = String(params.stationId);
    const r = roleOn(request, id, ["owner", "operator"]);
    if (r instanceof Response) return r;
    const relay = mockRelay(id, platformsOf(id));
    const platformId = String(params.platformId);
    if (!platformsOf(id).some((p) => p.platformId === platformId)) return fail(404, "not_found", "That platform wasn't found.");
    if (relay.paid[platformId] === "remind") delete relay.paid[platformId];
    return reply(relayApi.dismissPaidPromotionReminder.response, { ok: true });
  })
];
