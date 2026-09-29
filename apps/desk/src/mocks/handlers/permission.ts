// The link a permission request carries. In mock mode the desk and the viewer are two origins with
// two mocks, so the token carries the page itself: "mk." and the page's facts as base64url JSON.
// The viewer's mock (apps/viewer/src/mocks/handlers/permission.ts) reads it back. The real API's
// tokens are random; nothing in the apps depends on this format outside the mocks.

import type { DbCreator, DbWork } from "../fixtures/creators";

export interface PermissionSeed {
  /** displayName, personName, sourcePlatform */
  d: string;
  p: string | null;
  s: string;
  /** proposed band and channel */
  b: "tv" | "radio" | null;
  c: string | null;
  n: string | null;
  /** works: id, title, duration ms, included, left-out reason, group, noun */
  w: Array<[string, string, number | null, boolean, string | null, string | null, string | null]>;
  /** the market's name */
  m: string;
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function mockToken(c: DbCreator, works: DbWork[], included: ReadonlySet<string>, proposed: { band: "tv" | "radio"; channel: string } | null, note: string | null, marketName: string): string {
  const seed: PermissionSeed = {
    d: c.displayName,
    p: c.personName,
    s: c.sourcePlatform,
    b: proposed?.band ?? c.proposedOptions?.band ?? null,
    c: proposed?.channel ?? null,
    n: note,
    w: works.map((w) => [w.id, w.title, w.durationMs, included.has(w.id), w.leftOutReason, w.groupLabel, w.noun ?? null]),
    m: marketName
  };
  return `mk.${toBase64Url(JSON.stringify(seed))}`;
}
