// Invite codes on this device (added 2026-10-07): a /join link keeps its code here until the person
// has signed in and it's redeemed, so the code survives the sign-in round trip. Storage can be
// missing or blocked (a private window): then the person types the code instead.

const KEY = "oc-invite-code";

export function keepCode(code: string): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // Not kept; they can type it.
  }
}

export function keptCode(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetCode(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

/** The link to send: opencast's /join/XXXX-XXXX. */
export function joinLink(code: string): string {
  return `${window.location.origin}/join/${code}`;
}

/** What the API's refusals mean, in a sentence. */
export const REDEEM_ERRORS: Record<string, string> = {
  not_found: "That code isn't one of ours. Check it and try again.",
  invite_used: "That code has already been used. Ask for another.",
  invite_revoked: "That code was taken back. Ask for another.",
  invite_expired: "That code has expired. Ask for another."
};
