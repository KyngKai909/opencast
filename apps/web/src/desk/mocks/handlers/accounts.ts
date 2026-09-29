// accounts: who's signed in (Me.isAdmin decides the desk), and the Opencast team (A6).
import { http, type HttpHandler } from "msw";
import { team } from "../fixtures/people";
import { needsAdmin, path, reply } from "../respond";
import { meHandler } from "../../../mocks/me";
import { accountsApi } from "@opencast/contracts";

export const accountsHandlers: HttpHandler[] = [
  // Who am I (Me.isAdmin decides the desk): the one answer for every area (src/mocks/me.ts).
  meHandler,
  http.get(path(accountsApi.listOpencastTeam), ({ request }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    return reply(accountsApi.listOpencastTeam.response, team().map((t) => ({ id: t.id, name: t.displayName ?? t.email, email: t.email })));
  })
];
