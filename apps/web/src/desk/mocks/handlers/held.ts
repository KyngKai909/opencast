// Held earnings: every claimable station's balance in the escrow contract.
import { http, type HttpHandler } from "msw";
import { networkApi } from "@opencast/contracts";
import { advance, heldView } from "../db";
import { needsAdmin, path, reply } from "../respond";

export const heldHandlers: HttpHandler[] = [
  http.get(path(networkApi.heldEarnings), ({ request }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    advance();
    return reply(networkApi.heldEarnings.response, heldView());
  })
];
