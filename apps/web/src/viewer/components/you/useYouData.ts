// What You reads: reminders, pledges, TVs, the person's station, and the open channels.

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi, ledgerApi, stationsApi, tvApi, type Reminder } from "@opencast/contracts";
import { useToast } from "@opencast/ui";
import { z } from "zod";
import { call } from "../../../api/client";
import { keyFor, useApi } from "../../../api/hooks";
import { PledgesX } from "../../api/ext/you";
import { useAuth } from "../../../auth/AuthProvider";
import { useMe } from "../../data/viewer";
import { getCached, setCached } from "./cache";
import { identText } from "./youRules";

export function useReminders() {
  const auth = useAuth();
  return useApi(accountsApi.listReminders, {}, { enabled: auth.signedIn });
}

export function usePledges() {
  const auth = useAuth();
  return useApi(ledgerApi.listMyPledges, {}, { schema: PledgesX, enabled: auth.signedIn });
}

export function useTvs() {
  const auth = useAuth();
  return useApi(tvApi.listTvs, {}, { enabled: auth.signedIn });
}

/** How many channels are open on each band of the person's market (for "Run a station"). */
export function useOpenChannels(marketSlug: string | null) {
  const auth = useAuth();
  const enabled = auth.signedIn && !!marketSlug;
  const tv = useApi(stationsApi.availableChannels, { params: { marketSlug: marketSlug ?? "" }, query: { band: "tv" } }, { enabled, staleTime: 600e3 });
  const radio = useApi(stationsApi.availableChannels, { params: { marketSlug: marketSlug ?? "" }, query: { band: "radio" } }, { enabled, staleTime: 600e3 });
  const count = (d: typeof tv.data) => d?.channels.filter((c) => c.state === "open").length ?? null;
  return { tv: count(tv.data), radio: count(radio.data), loading: tv.isLoading || radio.isLoading, error: tv.error ?? radio.error };
}

/** A station the person runs (owner, operator or host), with whether it's on air. */
export function useMyStation() {
  const me = useMe();
  const membership = me.data?.memberships.find((m) => m.kind === "station");
  const station = membership?.kind === "station" ? membership.station : null;
  const page = useApi(stationsApi.getStation, { params: { stationRef: station?.id ?? "" } }, { enabled: !!station });
  return station ? { station, role: membership!.kind === "station" ? membership!.role : null, onAir: page.data?.onAir ?? null } : null;
}

/** Removing a reminder: a toast with Undo, which sets it again. */
export function useRemoveReminder() {
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = useCallback(() => void qc.invalidateQueries({ queryKey: keyFor(accountsApi.listReminders).slice(0, 2) }), [qc]);
  return useCallback(
    async (r: Reminder) => {
      const before = getCached<Reminder[]>(qc, accountsApi.listReminders);
      if (before) setCached(qc, accountsApi.listReminders, {}, before.filter((x) => x.id !== r.id));
      try {
        await call(accountsApi.removeReminder, { params: { reminderId: r.id } });
      } catch (e) {
        if (before) setCached(qc, accountsApi.listReminders, {}, before);
        toast.show({ message: (e as Error).message });
        return;
      }
      refresh();
      toast.show({
        message: `Reminder removed for ${r.airing.title}, ${identText(r.airing.station)}`,
        onUndo: async () => {
          const ids = r.airing.listedAiringId ? { listedAiringId: r.airing.listedAiringId } : { logEntryId: r.airing.logEntryId ?? undefined };
          await call(accountsApi.addReminder, { body: { ...ids, switchMeOver: r.switchMeOver } });
          refresh();
        }
      });
    },
    [qc, toast, refresh]
  );
}
