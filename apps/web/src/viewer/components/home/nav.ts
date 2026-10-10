// Moving around from home and the radio band without reloading the page (the player keeps
// playing): links that navigate in the app, tuning in, and opening the station preview.

import { useCallback, type MouseEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { StationIdent } from "@opencast/contracts";
import { useTune } from "../../player/PlayerRoot";

/** An <a href> that navigates inside the app on a plain click, and still opens a new tab with a modifier. */
export function useAppLink() {
  const navigate = useNavigate();
  return useCallback(
    (href: string) => ({
      href,
      onClick: (e: MouseEvent) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(href);
      }
    }),
    [navigate]
  );
}

type Station = Pick<StationIdent, "id" | "callSign"> & { slug?: string };

/** The tuned-in page for a station (A229: a station sharing X.1's call sign has its channel in it). */
export function watchHref(s: Station): string {
  return `/watch/${s.slug ?? s.callSign?.toLowerCase() ?? s.id}`;
}

/** Tunes in and opens the tuned-in page (a dial row, the hero's Tune in). */
export function useTuneAndWatch() {
  const tune = useTune("dial");
  const navigate = useNavigate();
  return useCallback(
    (s: Station) => {
      void tune(s.id);
      navigate(watchHref(s));
    },
    [tune, navigate]
  );
}

/** Opens the station preview over the page you're on: ?station=CIVC. */
export function useOpenStation() {
  const [, setParams] = useSearchParams();
  return useCallback(
    (s: Station) =>
      setParams((p) => {
        p.set("station", s.slug ?? s.callSign ?? s.id);
        return p;
      }),
    [setParams]
  );
}
