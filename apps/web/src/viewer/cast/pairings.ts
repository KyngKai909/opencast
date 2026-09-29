// TVs this phone has paired with by a code from the TV (a guest's phone, B2's pairPhone): kept on
// the device, signed in or out, so a paired TV is in "Watch on" next time. The phone token is the
// bearer for that TV's remote only. The TV unpairing the phone (an `ended` with `unpaired`, or a
// 401 on the token) forgets it.

import type { PairedPhone } from "@opencast/contracts";

const KEY = "oc-tv-pairings";

export type Pairing = PairedPhone;

export function loadPairings(): Pairing[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(list)) return [];
    return list.filter(
      (p): p is Pairing => !!p && typeof p === "object" && typeof p.tvId === "string" && typeof p.tvName === "string" && typeof p.phoneToken === "string" && !!p.phoneToken
    );
  } catch {
    return [];
  }
}

function save(list: Pairing[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Private windows: the pairing lasts this visit only.
  }
}

/** Keeps a pairing, replacing an earlier one with the same TV. */
export function savePairing(p: Pairing) {
  save([p, ...loadPairings().filter((x) => x.tvId !== p.tvId)]);
}

export function pairingFor(tvId: string): Pairing | null {
  return loadPairings().find((p) => p.tvId === tvId) ?? null;
}

export function forgetPairing(tvId: string) {
  const list = loadPairings();
  if (list.some((p) => p.tvId === tvId)) save(list.filter((p) => p.tvId !== tvId));
}

/** The pair code as typed: four digits. */
export function normalisePairCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 4);
}

/** The copy when the code isn't four digits yet. */
export const PAIR_CODE_SHORT = "The code on the TV has four numbers.";

/**
 * Pairs this phone with the TV showing the code (pairPhone, with the phone's name) and keeps the
 * pairing on the device. Errors are the API's words (404 `code_not_found`, 429 `too_many_tries`).
 */
export async function pairWithCode(
  raw: string,
  name: string,
  pair: (body: { code: string; name: string }) => Promise<Pairing>
): Promise<{ ok: true; pairing: Pairing } | { ok: false; error: string }> {
  const code = normalisePairCode(raw);
  if (code.length !== 4) return { ok: false, error: PAIR_CODE_SHORT };
  try {
    const pairing = await pair({ code, name: name.trim().slice(0, 60) || "a phone" });
    savePairing(pairing);
    return { ok: true, pairing };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "Something went wrong. Try again." };
  }
}
