// POST /contact, as the site needs it (SITE-SPEC §7). It isn't in packages/contracts yet: it's
// request D3 in docs/contract-requests.md. Declared here with the contracts' own helper so the
// client and the mock read it the same way; until it lands the mock answers it, and with a real
// API the site falls back to opening a mailto: to the desk.
import { z } from "zod";
import { endpoint } from "@contracts/core";

export const ContactDesk = z.enum(["stations", "makers", "advertisers", "public", "press", "rights"]);

export const contactApi = {
  send: endpoint({
    method: "POST",
    path: "/contact",
    auth: "public",
    summary: "Proposed (D3): a message for one of the desks. Rate-limited like the waitlist.",
    body: z.object({
      desk: ContactDesk,
      name: z.string().trim().min(1).max(80),
      email: z.email(),
      message: z.string().trim().min(1).max(4000),
      /** The desk's own fields (number and call sign, a link, business name…), as typed. */
      fields: z.record(z.string(), z.string().max(400)).default({})
    }),
    response: z.object({ desk: ContactDesk, receivedAt: z.string() }),
    status: 201
  })
};
