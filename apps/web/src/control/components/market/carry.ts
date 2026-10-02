// Carrying a program, and approving a request, with a toast and Undo instead of a confirmation.
// Neither can be taken back once sent (a carry that needs no approval is approved and placed at
// once; decideRequest is final; only a request still waiting can be withdrawn, C4), so the change
// is sent when the toast goes, or when the next one replaces it; Undo stops it being sent.

import type { ReactNode } from "react";
import { type CarriageTerm, catalogApi, type Slot } from "@opencast/contracts";
import { clock, TOAST_TIMEOUT, useToast } from "@opencast/ui";
import { call } from "../../../api/client";
import { STATION_TZ } from "../../../lib/clock";
import { useRefreshMarket } from "./api";
import { localDate, localSlot } from "./time";

type Commit = () => Promise<void>;

let pending: { run: () => void } | null = null;

/** Sends whatever is waiting now (another toast is about to replace its Undo). */
export function flushPending() {
  pending?.run();
}

/**
 * Shows `message` with Undo and sends `commit` when the toast goes. A later toast sends this one
 * first. If the toast is held open (hover, focus) past a margin, it's sent anyway.
 */
export function useDelayedSend() {
  const toast = useToast();
  return (message: ReactNode, commit: Commit, onFail: (message: string) => void, onUndo?: () => void) => {
    flushPending();
    let state: "waiting" | "sent" | "undone" = "waiting";
    const run = () => {
      if (state !== "waiting") return;
      state = "sent";
      clearTimeout(safety);
      if (pending?.run === run) pending = null;
      commit().catch((e: unknown) => onFail(e instanceof Error ? e.message : "Something went wrong. Try again."));
    };
    const safety = setTimeout(run, TOAST_TIMEOUT + 10_000);
    pending = { run };
    toast.show({
      message,
      onExpire: run,
      onUndo: () => {
        if (state !== "waiting") return;
        state = "undone";
        clearTimeout(safety);
        if (pending?.run === run) pending = null;
        onUndo?.();
      }
    });
  };
}

export interface CarryPlan {
  offerId: string;
  carrierStationId: string;
  term: CarriageTerm;
  slots: Slot[];
  /** Slots that air the week's episode again (C4). */
  repeatSlots?: Slot[];
  startsOn: string;
  weeks: number;
  replaceExisting: boolean;
  audioOnly?: boolean;
}

/**
 * Asks to carry, and when no approval is needed (or it's another airing of something carried),
 * puts it on the log. Returns the request, so an "Asked" state can be shown.
 */
export async function carry(plan: CarryPlan) {
  const r = await call(
    catalogApi.requestCarriage,
    { params: { offerId: plan.offerId }, body: { carrierStationId: plan.carrierStationId, term: plan.term, slots: plan.slots, repeatSlots: plan.repeatSlots, startsOn: plan.startsOn, audioOnly: plan.audioOnly ?? false } }
  );
  if (r.status === "approved" && r.agreementId) {
    await call(catalogApi.placeInLog, { params: { agreementId: r.agreementId }, body: { from: plan.startsOn, weeks: plan.weeks, replaceExisting: plan.replaceExisting } });
  }
  return r;
}

/** A plan for one airing tonight, in a dead-air gap. */
export function gapPlan(offerId: string, stationId: string, term: CarriageTerm, gapStartsAt: string, audioOnly = false): CarryPlan {
  return { offerId, carrierStationId: stationId, term, slots: [localSlot(gapStartsAt)], startsOn: localDate(gapStartsAt), weeks: 1, replaceExisting: false, audioOnly };
}

/** "Slow Hours is in your log tonight at 11:40 pm" */
export function gapMessage(title: string, gapStartsAt: string): string {
  return `${title} is in your log tonight at ${clock(gapStartsAt, { timeZone: STATION_TZ })}`;
}

/** Carry into a gap with Undo; on failure, the error in a toast. */
export function useCarryIntoGap() {
  const send = useDelayedSend();
  const refresh = useRefreshMarket();
  const toast = useToast();
  return (title: string, plan: CarryPlan, gapStartsAt: string) =>
    send(
      gapMessage(title, gapStartsAt),
      async () => {
        await carry(plan);
        refresh();
      },
      (m) => toast.show({ message: m })
    );
}
