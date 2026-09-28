// spots for a business: listing, creating, uploading, checks, matching stations, submitting,
// pausing and resuming, ending. The Spots area owns this file.

import { http, type HttpHandler } from "msw";
import { spotsApi } from "@opencast/contracts";
import { roleOn } from "../access";
import { getDb } from "../db";
import { needsUser, path, reply } from "../respond";

export const spotsHandlers: HttpHandler[] = [
  http.get(path(spotsApi.listSpots), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "see");
    if (r instanceof Response) return r;
    return reply(spotsApi.listSpots.response, getDb().spots.filter((s) => s.businessId === id));
  })
];
