// Watching and menus: fields the TV's watching screen needs that the contracts don't have yet.
// Each names its request in docs/contract-requests.md; the screens hide what depends on them
// when the API leaves them out.

import { z } from "zod";
import { DialRowX, DialX } from "../ext";

/**
 * S13: stand by as a state. A live block waiting for its signal: the worker airs its own
 * stand-by slate, and only when the dial says "standby" does the TV draw the stand-by layout
 * (colour bars, a way out) over it. Absent or "ok": the TV draws nothing over the stream.
 */
export const Signal = z.enum(["ok", "standby"]);
export type Signal = z.infer<typeof Signal>;

export const DialRowWatchingX = DialRowX.extend({ signal: Signal.optional() });
export type DialRowWatchingX = z.infer<typeof DialRowWatchingX>;

export const DialWatchingX = DialX.extend({ rows: z.array(DialRowWatchingX) });
export type DialWatchingX = z.infer<typeof DialWatchingX>;
