// What the station page, program page and search do when you act: tune in (and go to the tuned-in
// page), follow a link without reloading (the player keeps playing), and open an overlay over the
// page you're on (pledge, share), so Esc and Back return to it.

import { useCallback, type MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import type { StationIdent } from "@opencast/contracts";
import { useTune } from "../../player/PlayerRoot";

type Tunable = Pick<StationIdent, "id" | "callSign" | "handle"> & { slug?: string };

/** The tuned-in page's path for a station: /watch/beat (A229: /watch/rivc-15-2 for a station sharing X.1's call sign). */
export function watchPath(s: Tunable): string {
  return `/watch/${s.slug ?? s.callSign?.toLowerCase() ?? s.handle ?? s.id}`;
}

/** The station page's path: /beat (A229: /rivc-15-2). */
export function stationPath(s: Pick<StationIdent, "id" | "callSign" | "handle"> & { slug?: string }): string {
  return `/${s.handle ?? s.slug ?? s.callSign?.toLowerCase() ?? s.id}`;
}

/** Tunes the player to a station and opens the tuned-in page. */
export function useTuneIn() {
  const tune = useTune();
  const navigate = useNavigate();
  return useCallback(
    (s: Tunable) => {
      void tune(s.id);
      navigate(watchPath(s));
    },
    [tune, navigate]
  );
}

/** href and onClick for an <a> (or a Button with href) that navigates inside the app. */
export function useLink() {
  const navigate = useNavigate();
  return useCallback(
    (to: string) => ({
      href: to,
      onClick: (e: MouseEvent) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }
    }),
    [navigate]
  );
}

/** Opens an overlay over the current page: ?modal=pledge&station=BEAT. */
export function useOpenOverlay() {
  const navigate = useNavigate();
  const loc = useLocation();
  return useCallback(
    (params: Record<string, string>) => {
      const p = new URLSearchParams(loc.search);
      for (const [k, v] of Object.entries(params)) p.set(k, v);
      navigate({ pathname: loc.pathname, search: `?${p}` });
    },
    [navigate, loc.pathname, loc.search]
  );
}

/** Back where you came from, or the dial when the page was opened directly. */
export function useBack() {
  const navigate = useNavigate();
  const loc = useLocation();
  return useCallback(() => (loc.key !== "default" ? navigate(-1) : navigate("/")), [navigate, loc.key]);
}
