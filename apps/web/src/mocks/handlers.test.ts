// The one mock world answers each endpoint once: where two areas' mocks both have an endpoint, the
// shared answer (overlaps.ts) comes first.
import { describe, expect, it } from "vitest";
import type { HttpHandler } from "msw";
import { handlers as controlHandlers } from "../control/mocks/handlers";
import { handlers as deskHandlers } from "../desk/mocks/handlers";
import { handlers as viewerHandlers } from "../viewer/mocks/handlers";
import { handlers } from "./handlers";
import { OVERLAPS, overlapHandlers } from "./overlaps";
import { path } from "./respond";

const keyOf = (h: HttpHandler) => `${String(h.info.method)} ${String(h.info.path)}`;

describe("the one mock world", () => {
  it("answers every endpoint two areas share from the shared answer, first", () => {
    const areas = { viewer: viewerHandlers, control: controlHandlers, desk: deskHandlers };
    const owners = new Map<string, Set<string>>();
    for (const [area, list] of Object.entries(areas))
      for (const h of list) {
        if (overlapHandlers.includes(h)) continue;
        const k = keyOf(h);
        owners.set(k, (owners.get(k) ?? new Set()).add(area));
      }
    const shared = [...owners].filter(([, a]) => a.size > 1).map(([k]) => k).sort();
    // getMe is one handler every area lists, so it isn't counted here.
    expect(shared).toHaveLength(OVERLAPS.length - 1);
    const expected = OVERLAPS.map((e) => `${e.method} ${path(e)}`);
    for (const k of shared) expect(expected, `${k} is answered by more than one area`).toContain(k);
    for (const k of shared) expect(keyOf(handlers.find((h) => keyOf(h) === k)!)).toBe(k);
    for (const k of shared) expect(overlapHandlers).toContain(handlers.find((h) => keyOf(h) === k));
  });
});
