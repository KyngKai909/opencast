// Clear as a Privy global wallet. Clear's Privy app is the provider and Opencast's is the
// requester: "Connect Clear" in the apps calls Privy's cross-app linking (`linkCrossAppAccount`
// with Clear's provider app ID), the person approves on a page Clear hosts, and their Clear
// wallet becomes a linked account (type `cross_app`) on their Opencast Privy user. The API then
// reads that linked account from Privy's REST API with Opencast's app secret. Nothing about a
// Clear account is visible to Opencast until the person links it.
//
// What Opencast may do with it is Clear's setting in its own Privy dashboard, not something the
// API can detect, so it's configuration (CLEAR_WALLET_ACCESS): read-only (verify the address and
// pay out to it; funding happens inside Clear) or full (also request a transfer from it, which
// the person confirms on Clear's page).

import { getAddress, isAddress } from "viem";

export type ClearAccess = "read_only" | "full";

/** The person's Clear cross-app account, as Privy reports it. */
export interface ClearCrossAppAccount {
  /** Their user ID in Clear's Privy app. */
  subject: string;
  /** Their Clear embedded wallet, checksummed. */
  address: string;
}

export interface ClearLinkLookup {
  /** Clear's provider app ID (CLEAR_PRIVY_PROVIDER_APP_ID), or null when Clear isn't configured. */
  readonly providerAppId: string | null;
  /** What Clear has granted Opencast in its Privy dashboard (CLEAR_WALLET_ACCESS). */
  readonly access: ClearAccess;
  /** The person's Clear account from Privy, or null when they haven't linked Clear. Throws when Privy can't be read. */
  find(privyDid: string): Promise<ClearCrossAppAccount | null>;
}

export class ClearLookupUnavailable extends Error {}

interface PrivyLinkedAccount {
  type?: string;
  subject?: string;
  provider_app_id?: string;
  provider_app?: { id?: string };
  embedded_wallets?: Array<{ address?: string }>;
}

/** Picks Clear's cross-app account (with its embedded wallet) out of a Privy user's linked accounts. */
export function clearAccountFrom(linkedAccounts: PrivyLinkedAccount[], providerAppId: string): ClearCrossAppAccount | null {
  for (const account of linkedAccounts) {
    if (account.type !== "cross_app") continue;
    if ((account.provider_app_id ?? account.provider_app?.id) !== providerAppId) continue;
    const address = account.embedded_wallets?.map((w) => w.address).find((a): a is string => Boolean(a && isAddress(a)));
    if (!address || !account.subject) continue;
    return { subject: account.subject, address: getAddress(address) };
  }
  return null;
}

export function parseClearAccess(value: string | undefined): ClearAccess {
  if (!value || value === "read_only") return "read_only";
  if (value === "full") return "full";
  console.warn(`[v1] CLEAR_WALLET_ACCESS is "${value}": expected read_only or full. Using read_only.`);
  return "read_only";
}

/** Reads the person's Privy user with Opencast's app secret. */
export function privyClearLookup(config: {
  privyAppId: string;
  privyAppSecret?: string;
  providerAppId: string | null;
  access: ClearAccess;
  fetch?: typeof fetch;
}): ClearLinkLookup {
  const doFetch = config.fetch ?? fetch;
  return {
    providerAppId: config.providerAppId,
    access: config.access,
    async find(privyDid) {
      if (!config.providerAppId) throw new ClearLookupUnavailable("Connecting Clear isn't set up on this server.");
      if (!config.privyAppSecret) throw new ClearLookupUnavailable("Connecting Clear needs PRIVY_APP_SECRET on this server.");
      const response = await doFetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(privyDid)}`, {
        headers: {
          authorization: `Basic ${Buffer.from(`${config.privyAppId}:${config.privyAppSecret}`).toString("base64")}`,
          "privy-app-id": config.privyAppId
        }
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Privy answered ${response.status} reading the user`);
      const user = (await response.json()) as { linked_accounts?: PrivyLinkedAccount[] };
      return clearAccountFrom(user.linked_accounts ?? [], config.providerAppId);
    }
  };
}

/** For tests and local development: Clear accounts by Privy DID, and the access, set by hand. */
export interface FakeClearLookup extends ClearLinkLookup {
  providerAppId: string | null;
  access: ClearAccess;
  accounts: Map<string, ClearCrossAppAccount>;
}

export function fakeClearLookup(options: { providerAppId?: string | null; access?: ClearAccess } = {}): FakeClearLookup {
  const fake: FakeClearLookup = {
    providerAppId: options.providerAppId === undefined ? "clear-provider-app" : options.providerAppId,
    access: options.access ?? "read_only",
    accounts: new Map(),
    async find(privyDid) {
      if (!fake.providerAppId) throw new ClearLookupUnavailable("Connecting Clear isn't set up on this server.");
      return fake.accounts.get(privyDid) ?? null;
    }
  };
  return fake;
}

export function clearLookupFromEnv(env: NodeJS.ProcessEnv): ClearLinkLookup {
  return privyClearLookup({
    privyAppId: env.PRIVY_APP_ID ?? "unset",
    privyAppSecret: env.PRIVY_APP_SECRET || undefined,
    providerAppId: env.CLEAR_PRIVY_PROVIDER_APP_ID?.trim() || null,
    access: parseClearAccess(env.CLEAR_WALLET_ACCESS?.trim())
  });
}
