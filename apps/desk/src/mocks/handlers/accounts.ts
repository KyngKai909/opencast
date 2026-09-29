// accounts: who's signed in (Me.isAdmin decides the desk), and the Opencast team (A6, proposed).
import { http, type HttpHandler } from "msw";
import { accountsApi, Me } from "@opencast/contracts";
import { listTeam, TeamMemberX } from "../../api/ext";
import { team } from "../fixtures/people";
import { IE } from "../fixtures/markets";
import { needsAdmin, needsUser, path, reply } from "../respond";
import { z } from "zod";

export const accountsHandlers: HttpHandler[] = [
  http.get(path(accountsApi.getMe), ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    return reply(Me, {
      id: p.id,
      displayName: p.displayName,
      email: p.email,
      market: IE,
      isAdmin: p.isAdmin,
      identities: [{ kind: "email", value: p.email, verifiedAt: "2026-06-01T19:00:00.000Z" }],
      memberships: [],
      settings: {},
      clear: null
    });
  }),
  http.get(path(listTeam), ({ request }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    return reply(z.array(TeamMemberX), team().map((t) => ({ id: t.id, name: t.displayName ?? t.email, email: t.email })));
  })
];
