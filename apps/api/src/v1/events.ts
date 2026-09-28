// Events modules emit for others to react to (mostly notifications). In-process
// for now; handlers run after the emitting transaction commits, and a failing
// handler never fails the request that emitted.

export interface Events {
  "reminder.due": { userId: string; reminderId: string; title: string; startsAt: string; switchMeOver: boolean };
  "station.dead_air_warning": { stationId: string; gapStartsAt: string; minutesBefore: 30 | 12 };
  "station.dead_air_filled": { stationId: string; gapStartsAt: string; gapEndsAt: string };
  "station.signed_on": { stationId: string; first: boolean };
  "station.signal_lost": { stationId: string; liveSourceId: string | null };
  /** A file due within the hour isn't in the worker cache (or wasn't, at air). */
  "station.file_not_ready": { stationId: string; itemId: string; title: string; airsAt: string; missedAtAir: boolean };
  "station.signed_off": { stationId: string; permanently: boolean };
  "spot.paused": { spotId: string; businessId: string; reason: "daily_cap" | "budget_spent" | "balance"; stationIds: string[] };
  "spot.resumed": { spotId: string; businessId: string; stationIds: string[] };
  "business.low_balance": { businessId: string; daysLeft: number; /** The last top-up (or "start"): one warning per threshold until the next. */ since: string };
  "sponsorship.requested": { sponsorshipId: string; stationId: string; businessId: string };
  "sponsorship.decided": { sponsorshipId: string; stationId: string; businessId: string; approved: boolean };
  "carriage.requested": { requestId: string; makerStationId: string; carrierStationId: string };
  "carriage.decided": { requestId: string; makerStationId: string; carrierStationId: string; approved: boolean };
  "order.updated": { orderId: string; businessId: string; makerStationId: string; state: string };
  "claim.filed": { claimId: string; stationId: string; itemTitle: string; carrierStationIds: string[] };
  "invite.created": { inviteId: string; email: string | null; phone: string | null; teamName: string };
  "code.used": { businessId: string; spotId: string; code: string };
}

type Handler<K extends keyof Events> = (payload: Events[K]) => Promise<void> | void;

export class EventBus {
  private handlers = new Map<keyof Events, Array<Handler<never>>>();
  private pending: Promise<unknown>[] = [];

  on<K extends keyof Events>(event: K, handler: Handler<K>) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as Handler<never>);
    this.handlers.set(event, list);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]) {
    for (const handler of this.handlers.get(event) ?? []) {
      const run = Promise.resolve()
        .then(() => (handler as Handler<K>)(payload))
        .catch((error) => console.error(`[events] ${String(event)} handler failed`, error));
      this.pending.push(run);
    }
  }

  /** Waits for handlers started so far (tests, graceful shutdown). */
  async settle() {
    while (this.pending.length) {
      const batch = this.pending.splice(0);
      await Promise.all(batch);
    }
  }
}
