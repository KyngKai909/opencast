// The business on screen: `/:businessId/...` resolved against the signed-in person's
// memberships, with their role. Every page reads `useBusiness().id` for its calls.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useParams } from "react-router";
import { accountsApi, type Membership } from "@opencast/contracts";
import { useApi } from "../api/hooks";
import { useAuth } from "../auth/AuthProvider";
import { can, type Ability, type Role } from "./abilities";

export function useMe() {
  const auth = useAuth();
  return useApi(accountsApi.getMe, {}, { enabled: auth.signedIn, staleTime: 60_000 });
}

export type BusinessMembership = Extract<Membership, { kind: "business" }>;

/** The person's businesses, owned first. */
export function useMyBusinesses(): BusinessMembership[] {
  const me = useMe();
  return useMemo(() => {
    const list = (me.data?.memberships ?? []).filter((m): m is BusinessMembership => m.kind === "business");
    const rank = { owner: 0, manager: 1, viewer: 2 } as const;
    return [...list].sort((a, b) => rank[a.role] - rank[b.role] || a.business.name.localeCompare(b.business.name));
  }, [me.data]);
}

export interface BusinessState {
  business: { id: string; name: string };
  id: string;
  role: Role;
  /** "/<id>": prefix for this business's routes. */
  base: string;
  can(ability: Ability): boolean;
}

const Ctx = createContext<BusinessState | null>(null);

/** Resolves `:businessId` for the pages under it. Null while loading or when it isn't theirs. */
export function useResolvedBusiness(): { state: BusinessState | null; loading: boolean } {
  const { businessId = "" } = useParams();
  const me = useMe();
  const mine = useMyBusinesses();
  const m = mine.find((x) => x.business.id === businessId);
  const state = useMemo<BusinessState | null>(
    () => (m ? { business: m.business, id: m.business.id, role: m.role, base: `/${m.business.id}`, can: (a: Ability) => can(m.role, a) } : null),
    [m]
  );
  return { state, loading: me.isLoading };
}

export function BusinessProvider({ value, children }: { value: BusinessState; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The business on screen. Only under a business route. */
export function useBusiness(): BusinessState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useBusiness needs a business route above it");
  return s;
}
