// Fields the business app's screens need that the contracts don't have yet, as optional
// extensions of the contract schemas. Each names its request in docs/contract-requests.md. The
// mocks fill them in; against the real API they're absent until the request lands, and the
// screens hide what depends on them (or fall back). Each area keeps its own in api/ext/<area>.ts.

import { Business } from "@opencast/contracts";
import { z } from "zod";

/** P11: the logo mark shown until a logo is uploaded (the shell's "OSC" square). */
export const BusinessX = Business.extend({ logoMark: z.object({ initials: z.string(), colour: z.string() }).optional() });
export type BusinessX = z.infer<typeof BusinessX>;
