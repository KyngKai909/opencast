// accounts: who's signed in (Me.isAdmin decides the desk), and the Opencast team (A6, proposed).
import { http, type HttpHandler } from "msw";
import { listTeam, TeamMemberX } from "../../api/ext";
import { team } from "../fixtures/people";
import { needsAdmin, path, reply } from "../respond";
import { meHandler } from "../../../mocks/me";
import { z } from "zod";

export const accountsHandlers: HttpHandler[] = [
  // Who am I (Me.isAdmin decides the desk): the one answer for every area (src/mocks/me.ts).
  meHandler,
  http.get(path(listTeam), ({ request }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    return reply(z.array(TeamMemberX), team().map((t) => ({ id: t.id, name: t.displayName ?? t.email, email: t.email })));
  })
];
