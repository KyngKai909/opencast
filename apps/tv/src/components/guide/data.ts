// The guide's data: both bands' listings from the half hour that's on now (24 hours, the most one
// call gives), and program descriptions for the focused cell, fetched ahead for what's on screen
// and kept (library.getProgram; airings carry no description, inventory raise 24).

import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { libraryApi, stationsApi } from "@opencast/contracts";
import { GuideX } from "../../api/ext";
import { call } from "../../api/client";
import { keyFor, useApi } from "../../api/hooks";
import { now } from "../../lib/clock";
import { useMarketSlug } from "../../tv/data";
import { buildModel, slotFloor, type GuideModel } from "./guideLogic";

const HOURS = 24;

function useBand(slug: string, band: "tv" | "radio", from: string, to: string) {
  return useApi(stationsApi.getGuide, { params: { marketSlug: slug }, query: { band, from, to } }, { schema: GuideX, staleTime: 5 * 60_000, refetchInterval: 5 * 60_000 });
}

export interface GuideData {
  model: GuideModel | null;
  loading: boolean;
  error: Error | null;
}

/** The guide from the half hour it opened in. */
export function useGuideData(): GuideData {
  const slug = useMarketSlug();
  // Fixed while the guide is open, so the window and focus don't jump under the viewer.
  const [range] = useState(() => {
    const from = slotFloor(now().getTime());
    return { from, to: from + HOURS * 3600e3 };
  });
  const fromIso = new Date(range.from).toISOString();
  const toIso = new Date(range.to).toISOString();
  const tv = useBand(slug, "tv", fromIso, toIso);
  const radio = useBand(slug, "radio", fromIso, toIso);
  const model = useMemo(
    () => (tv.data && radio.data ? buildModel(tv.data.rows, radio.data.rows, range.from, range.to) : null),
    [tv.data, radio.data, range]
  );
  return { model, loading: tv.isLoading || radio.isLoading, error: (tv.error ?? radio.error) as Error | null };
}

/** Descriptions of these programs, by id: fetched once each and cached. */
export function useDescriptions(programIds: string[]): Map<string, string | null> {
  const ids = useMemo(() => [...new Set(programIds)].sort(), [programIds]);
  const results = useQueries({
    queries: ids.map((programId) => {
      const args = { params: { programId } };
      return {
        // The same key useApi gives this endpoint, so other screens share the cache.
        queryKey: [...keyFor(libraryApi.getProgram, args), 0],
        queryFn: () => call(libraryApi.getProgram, args),
        staleTime: 30 * 60_000,
        retry: 0
      };
    })
  });
  const m = new Map<string, string | null>();
  results.forEach((r, i) => {
    if (r.data) m.set(ids[i]!, r.data.description);
  });
  return m;
}
