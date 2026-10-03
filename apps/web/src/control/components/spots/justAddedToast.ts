// C.3's toast, for what was just added to the rotation ("Orange Street Coffee added. It starts in
// the 8:59 pm break."), with Undo putting the rotation back; when the toast goes, the run settles.
// A246: it moved from the Breaks page (now the Schedule) to the spot market's rotation tab, where
// the rotation is (docs/schedule-map.md, decision 4). The first break a new spot is in comes from
// the avails' contents, as Breaks read them.

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { clock, useToast } from "@opencast/ui";
import { now, STATION_TZ } from "../../../lib/clock";
import { useAvails, useMarket, useSetRotation } from "./data";
import { justAdded, settle, subscribe } from "./justAdded";

export function useJustAddedToast(stationId: string) {
  const toast = useToast();
  const avails = useAvails(stationId);
  const market = useMarket(stationId);
  const setRotation = useSetRotation();
  const run = useSyncExternalStore(subscribe, () => JSON.stringify(justAdded(stationId)));
  const added = useMemo(() => (run === "null" ? null : justAdded(stationId)), [run, stationId]);
  const toasted = useRef<string | null>(null);

  useEffect(() => {
    if (!added || !added.added.length || !avails.data || !market.data || toasted.current === run) return;
    toasted.current = run;
    const before = new Set(added.before);
    const t = now().toISOString();
    const first = [...avails.data.breaks]
      .sort((a, b) => a.breakStartsAt.localeCompare(b.breakStartsAt))
      .find((b) => b.breakStartsAt > t && (b.contents ?? []).some((c) => c.kind === "spot" && !before.has(c.id)));
    const names = added.added.map((id) => market.data.find((m) => m.spot.id === id)?.business.name ?? "The spot");
    const n = added.added.length;
    const when = first ? clock(first.breakStartsAt, { timeZone: STATION_TZ }) : null;
    const message =
      n === 1
        ? when
          ? `${names[0]} added. It starts in the ${when} break.`
          : `${names[0]} added. It airs when there's open time.`
        : when
          ? `${n} spots added. They start in the ${when} break.`
          : `${n} spots added. They air when there's open time.`;
    const previous = added.previousMain;
    toast.show({
      message,
      timeout: 8000,
      onUndo: () => {
        setRotation.mutate({ params: { stationId, kind: "main" }, body: { spotIds: previous } }, { onSettled: () => settle(stationId) });
      },
      onExpire: () => settle(stationId)
    });
  }, [added, run, avails.data, market.data, stationId, setRotation, toast]);
}
