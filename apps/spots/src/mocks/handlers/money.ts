// ledger for a business: the balance, movements, funding, adding and taking out money, deposits.
// The Money area owns this file.

import { http, type HttpHandler } from "msw";
import { ledgerApi } from "@opencast/contracts";
import { roleOn } from "../access";
import { balanceOf } from "../db";
import { needsUser, path, reply } from "../respond";

export const moneyHandlers: HttpHandler[] = [
  http.get(path(ledgerApi.getBalance), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "see");
    if (r instanceof Response) return r;
    return reply(ledgerApi.getBalance.response, balanceOf(id));
  })
];
