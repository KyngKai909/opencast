// Endpoints more than one area's mock answers, answered once. The three areas were built as three
// apps with three mocks; in one app they're one mock world, and an endpoint has one answer, with
// what every area needs. Each area's own handler stays where it is (its tests call it); these come
// first in the worker (handlers.ts), and ask the areas' handlers in turn:
//
//   getMe                the union (me.ts): the viewer's profile, master control's roles, isAdmin
//   listMarkets          the viewer's: the three markets with their centres and station counts
//   getStation           the viewer's station page; a claimable station's "Run by" from master
//                        control's claims; master control's for the stations only it knows (a new one)
//   getProgram           the viewer's programs, then master control's library programs
//   availableChannels    master control's for the Inland Empire (its channels, taken as stations
//                        sign on), the viewer's for the other markets
//   checkCallSign        free only if neither master control's stations nor the desk's holds have it
//   getPrefs, setPrefs   master control's for a station's (scope "station"), the viewer's otherwise
//   startHandover        master control's claims, then the viewer's permission pages' (Claim now)
//   getPermissionPage    the viewer's (the frames' links and the desk's "mk." links, in full), then
//                        the desk's own requests
//   answerPermission     the desk's request and the viewer's page both hear it: a creator's yes
//                        reaches the pipeline
//   heldEarnings         the desk's (admin)

import { getResponse, http, HttpResponse, type HttpHandler } from "msw";
import { accountsApi, libraryApi, networkApi, notificationsApi, stationsApi, waitlistApi, type EndpointDef } from "@opencast/contracts";
import { handlers as controlHandlers } from "../control/mocks/handlers";
import { handlers as deskHandlers } from "../desk/mocks/handlers";
import { handlers as viewerHandlers } from "../viewer/mocks/handlers";
import { meHandler } from "./me";
import { path } from "./respond";

type Area = "viewer" | "control" | "desk";
const AREAS: Record<Area, HttpHandler[]> = { viewer: viewerHandlers, control: controlHandlers, desk: deskHandlers };

/** An area's handler for an endpoint. */
function handlerOf(area: Area, e: EndpointDef): HttpHandler {
  const h = AREAS[area].find((x) => x.info.method === e.method && x.info.path === path(e));
  if (!h) throw new Error(`No ${area} mock for ${e.method} ${e.path}`);
  return h;
}

/** An area's answer to the request (a copy of it: the body can be read again), or null when it passes it on. */
async function answerOf(area: Area, e: EndpointDef, request: Request): Promise<Response | null> {
  return (await getResponse([handlerOf(area, e)], request.clone())) ?? null;
}

const found = (r: Response | null): r is Response => !!r && r.status !== 404;

/** The first area whose answer isn't a 404, else the last answer. */
function firstFound(e: EndpointDef, areas: Area[]): HttpHandler {
  return http[e.method.toLowerCase() as "get"](path(e), async ({ request }) => {
    let last: Response | null = null;
    for (const a of areas) {
      last = await answerOf(a, e, request);
      if (found(last)) return last;
    }
    return last ?? undefined;
  });
}

async function json(r: Response): Promise<Record<string, unknown>> {
  return (await r.clone().json()) as Record<string, unknown>;
}

export const overlapHandlers: HttpHandler[] = [
  meHandler,

  http.get(path(stationsApi.listMarkets), async ({ request }) => (await answerOf("viewer", stationsApi.listMarkets, request)) ?? undefined),

  http.get(path(stationsApi.getStation), async ({ request }) => {
    const v = await answerOf("viewer", stationsApi.getStation, request);
    if (!found(v)) return (await answerOf("control", stationsApi.getStation, request)) ?? v ?? undefined;
    if (!v.ok) return v;
    const page = await json(v);
    // A claimable station is run for whoever its claim names, and says so once it's claimed.
    if ((page.station as { kind?: string } | undefined)?.kind === "claimable") {
      const c = await answerOf("control", stationsApi.getStation, request);
      if (c?.ok) page.claimable = (await json(c)).claimable ?? page.claimable;
    }
    return HttpResponse.json(page, { status: v.status });
  }),

  firstFound(libraryApi.getProgram, ["viewer", "control"]),

  http.get(path(stationsApi.availableChannels), async ({ request, params }) => {
    const area: Area = String(params.marketSlug) === "inland-empire" ? "control" : "viewer";
    return (await answerOf(area, stationsApi.availableChannels, request)) ?? undefined;
  }),

  http.get(path(waitlistApi.checkCallSign), async ({ request }) => {
    const c = await answerOf("control", waitlistApi.checkCallSign, request);
    const d = await answerOf("desk", waitlistApi.checkCallSign, request);
    if (!c?.ok || !d?.ok) return c ?? d ?? undefined;
    const a = await json(c);
    const b = await json(d);
    return HttpResponse.json({ ...a, available: !!a.available && !!b.available });
  }),

  http.get(path(notificationsApi.getPrefs), async ({ request }) => {
    const scope = new URL(request.url).searchParams.get("scope");
    return (await answerOf(scope === "station" ? "control" : "viewer", notificationsApi.getPrefs, request)) ?? undefined;
  }),

  http.put(path(notificationsApi.setPrefs), async ({ request }) => {
    const body = (await request.clone().json().catch(() => null)) as { scope?: string } | null;
    return (await answerOf(body?.scope === "station" ? "control" : "viewer", notificationsApi.setPrefs, request)) ?? undefined;
  }),

  firstFound(networkApi.startHandover, ["control", "viewer"]),

  firstFound(networkApi.getPermissionPage, ["viewer", "desk"]),

  http.post(path(networkApi.answerPermission), async ({ request }) => {
    const d = await answerOf("desk", networkApi.answerPermission, request);
    const v = await answerOf("viewer", networkApi.answerPermission, request);
    return (found(v) ? v : found(d) ? d : (v ?? d)) ?? undefined;
  }),

  http.get(path(networkApi.heldEarnings), async ({ request }) => (await answerOf("desk", networkApi.heldEarnings, request)) ?? undefined)
];

/** The endpoints above, for handlers.test.ts: every other endpoint has one area's mock only. */
export const OVERLAPS: EndpointDef[] = [
  accountsApi.getMe,
  stationsApi.listMarkets,
  stationsApi.getStation,
  libraryApi.getProgram,
  stationsApi.availableChannels,
  waitlistApi.checkCallSign,
  notificationsApi.getPrefs,
  notificationsApi.setPrefs,
  networkApi.startHandover,
  networkApi.getPermissionPage,
  networkApi.answerPermission,
  networkApi.heldEarnings
];
