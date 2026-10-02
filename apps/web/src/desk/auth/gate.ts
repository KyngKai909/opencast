// Who gets the desk: signed in, and the API says you're on the Opencast team: an admin (Me.isAdmin),
// or since 2026-09-29 a rights reviewer or market lead (Me.deskRoles). Every desk endpoint is
// `auth: "admin"` or `auth: "desk"` as well, so the gate is for the words, not the only lock.

import type { Me } from "@opencast/contracts";

export type Gate = "loading" | "sign-in" | "not-admin" | "desk" | "error";

export interface GateInput {
  /** Sign-in has decided whether someone is signed in. */
  ready: boolean;
  signedIn: boolean;
  /** `accounts.getMe`: undefined while loading. */
  me: Pick<Me, "isAdmin" | "deskRoles"> | undefined;
  /** The HTTP status getMe failed with, if it did. */
  meError?: number | null;
}

export function gateFor({ ready, signedIn, me, meError }: GateInput): Gate {
  if (!ready) return "loading";
  if (!signedIn) return "sign-in";
  // A token the API no longer takes: sign in again.
  if (meError === 401) return "sign-in";
  if (meError === 403) return "not-admin";
  if (meError) return "error";
  if (!me) return "loading";
  return me.isAdmin || (me.deskRoles?.length ?? 0) > 0 ? "desk" : "not-admin";
}

/** The two letters in the header's avatar: "Dee A." reads "DA". */
export function initialsOf(name: string | null | undefined, email?: string | null): string {
  const source = (name ?? email ?? "").trim();
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase());
  return letters.join("") || "?";
}
