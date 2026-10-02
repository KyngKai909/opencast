// The station on screen: `/control/:callSign/...` (or a studio's `/control/:handle/...`) resolved against the
// signed-in person's memberships, with their role. The API is scoped by station id; the routes
// by the station's slug (its call sign, "beat", or a family member's "beat-12-2": station/slug.ts),
// so every page reads `useStation().id` for its calls.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useParams } from "react-router";
import { accountsApi, type Membership, type StationIdent } from "@opencast/contracts";
import { useApi } from "../../api/hooks";
import { useAuth } from "../../auth/AuthProvider";
import { can, type Ability, type Role } from "./abilities";
import { controlSlug, findByStationRef, stationLabel, stationPath } from "./slug";

export function useMe() {
  const auth = useAuth();
  return useApi(accountsApi.getMe, {}, { enabled: auth.signedIn, staleTime: 60_000 });
}

export type StationMembership = Extract<Membership, { kind: "station" }>;

/** The person's stations and studios, in the switcher's order: owned first, then by channel. */
export function useMyStations(): StationMembership[] {
  const me = useMe();
  return useMemo(() => {
    const list = (me.data?.memberships ?? []).filter((m): m is StationMembership => m.kind === "station");
    const rank = { owner: 0, operator: 1, host: 2 } as const;
    return [...list].sort((a, b) => rank[a.role] - rank[b.role] || (a.station.channel ?? "").localeCompare(b.station.channel ?? "", undefined, { numeric: true }));
  }, [me.data]);
}

/** The route's segment for a station: its slug ("beat", a family member's "beat-12-2"), or a studio's handle. */
export const stationSlug = controlSlug;

export interface StationState {
  station: StationIdent;
  id: string;
  role: Role;
  /** A studio: a station with no channel (the studio shell, no on-air pages). */
  studio: boolean;
  /** "/control/beat" (a family member's "/control/beat-12-2"): prefix for this station's routes. */
  base: string;
  /** How the station is named where only its call sign would show: "BEAT", a family member's "BEAT 12.2", a studio's name. */
  label: string;
  can(ability: Ability): boolean;
}

const Ctx = createContext<StationState | null>(null);

/** Resolves `:callSign` for the pages under it. Null while loading or when it isn't theirs. */
export function useResolvedStation(): { state: StationState | null; loading: boolean } {
  const { callSign = "" } = useParams();
  const me = useMe();
  const mine = useMyStations();
  const m = findByStationRef(mine, callSign, (x) => x.station);
  const state = useMemo<StationState | null>(
    () =>
      m
        ? {
            station: m.station,
            id: m.station.id,
            role: m.role,
            studio: m.station.kind === "studio",
            base: stationPath(m.station),
            label: stationLabel(m.station),
            can: (a: Ability) => can(m.role, a)
          }
        : null,
    [m]
  );
  return { state, loading: me.isLoading };
}

export function StationProvider({ value, children }: { value: StationState; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The station on screen. Only under a station route. */
export function useStation(): StationState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStation needs a station route above it");
  return s;
}
