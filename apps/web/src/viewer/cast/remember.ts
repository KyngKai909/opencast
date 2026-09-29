// Your TVs lists the Chromecasts and AirPlay TVs this account has used (B2's recordCastTarget): the
// server can't see them, so the phone says so after a cast starts or mirroring connects. Signed in
// only; a TV app is the account's already. CastSync watches the session and calls this.

import type { CastSession } from "./session";

export interface CastTargetRecord {
  kind: "chromecast" | "airplay";
  name: string;
}

/** The TV to remember when the session goes from `prev` to `next`: a cast that started, or mirroring that connected. */
export function castTargetToRemember(prev: CastSession, next: CastSession): CastTargetRecord | null {
  if (next.status === "casting" && prev.status !== "casting" && next.target.kind === "chromecast" && !next.target.picker) {
    return { kind: "chromecast", name: next.target.name.trim().slice(0, 60) };
  }
  if (next.status === "mirroring" && prev.status !== "mirroring" && next.target.kind === "airplay") {
    // Mirroring whose TV didn't say its name ("the TV") has nothing to remember.
    const name = next.target.id.slice("airplay:".length).trim();
    return name ? { kind: "airplay", name: name.slice(0, 60) } : null;
  }
  return null;
}

/** Records it when signed in; a failure only means the list misses it this time. */
export async function rememberCastTarget(
  prev: CastSession,
  next: CastSession,
  signedIn: boolean,
  record: (target: CastTargetRecord) => Promise<unknown>
): Promise<CastTargetRecord | null> {
  if (!signedIn) return null;
  const target = castTargetToRemember(prev, next);
  if (!target || !target.name) return null;
  try {
    await record(target);
    return target;
  } catch {
    return null;
  }
}
