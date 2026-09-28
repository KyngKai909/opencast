// live sources, hosts, speakers, listings (with library.ts, which this area also owns).
// The Live and programming area owns this file.

import { http, type HttpHandler } from "msw";
import { stationsApi } from "@opencast/contracts";
import { getDb } from "../db";
import { needsUser, path, reply } from "../respond";

export const liveHandlers: HttpHandler[] = [
  http.get(path(stationsApi.listLiveSources), ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    return reply(stationsApi.listLiveSources.response, getDb().liveSources);
  })
];
