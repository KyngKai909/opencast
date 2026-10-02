// Events modules emit for others to react to (mostly notifications). In-process
// for now; handlers run after the emitting transaction commits, and a failing
// handler never fails the request that emitted.

export interface Events {
  "reminder.due": { userId: string; reminderId: string; title: string; startsAt: string; switchMeOver: boolean };
  /** Added 2026-09-29: the airing a reminder was for came off the log; the reminder moved to the program's next airing (`startsAt`). */
  "reminder.moved": { userId: string; reminderId: string; stationId: string; title: string; startsAt: string };
  /** Added 2026-09-29: the airing a reminder was for (`startsAt`) came off the log, and the program doesn't air again soon: the reminder is cancelled. */
  "reminder.cancelled": { userId: string; reminderId: string; stationId: string; title: string; startsAt: string };
  "station.dead_air_warning": { stationId: string; gapStartsAt: string; minutesBefore: 30 | 12 };
  "station.dead_air_filled": { stationId: string; gapStartsAt: string; gapEndsAt: string };
  "station.signed_on": { stationId: string; first: boolean };
  "station.signal_lost": { stationId: string; liveSourceId: string | null };
  /** A file due within the hour isn't prepared for air (or wasn't, at air). */
  "station.file_not_ready": { stationId: string; itemId: string; title: string; airsAt: string; missedAtAir: boolean };
  "station.signed_off": { stationId: string; permanently: boolean };
  "spot.paused": { spotId: string; businessId: string; reason: "daily_cap" | "budget_spent" | "balance" | "by_hand"; stationIds: string[] };
  "spot.resumed": { spotId: string; businessId: string; stationIds: string[] };
  /** A station put a spot in its rotation (or backup rotation) that wasn't there. */
  "spot.added_to_rotation": { spotId: string; businessId: string; stationId: string; backup: boolean };
  "business.low_balance": { businessId: string; daysLeft: number; /** The last top-up (or "start"): one warning per threshold until the next. */ since: string };
  "sponsorship.requested": { sponsorshipId: string; stationId: string; businessId: string };
  "sponsorship.decided": { sponsorshipId: string; stationId: string; businessId: string; approved: boolean };
  "carriage.requested": { requestId: string; makerStationId: string; carrierStationId: string };
  "carriage.decided": { requestId: string; makerStationId: string; carrierStationId: string; approved: boolean };
  "order.updated": { orderId: string; businessId: string; makerStationId: string; state: string };
  "claim.filed": { claimId: string; stationId: string; itemTitle: string; carrierStationIds: string[] };
  /** An invite was made: its email goes out (resending sends it directly). `sentAt` makes each send its own email. */
  "invite.created": {
    inviteId: string;
    email: string | null;
    phone: string | null;
    teamName: string;
    scope: "station" | "business";
    role: "operator" | "host" | "manager" | "viewer";
    invitedByName: string | null;
    expiresAt: string;
    sentAt: string;
  };
  "code.used": { businessId: string; spotId: string; code: string };
  /**
   * Pay-as-you-go (added 2026-09-29): a step in a station's account the owners are told about:
   * the month's usage, a charge that failed, grace started or ending soon, paused, resumed, a cap
   * reached, a payment to approve in Clear. Worded where it happens; one notice per `dedupeKey`.
   */
  "station.account": {
    stationId: string;
    step: "usage_summary" | "charge_failed" | "grace_started" | "clear_approval" | "grace_ending" | "paused" | "resumed" | "paid" | "cap_reached";
    title: string;
    body: string;
    dedupeKey: string;
  };
  /**
   * Relays (added 2026-09-30, follow-up Phase 3): a station's relay stopped (the station and the
   * Network desk hear; Opencast's own channel is never affected) or is back; a restart for a
   * platform's limit is due for the station to do, or failed; spots aired on a destination Opencast
   * can't mark as paid promotion. Worded where it happens; one notice per `dedupeKey`.
   */
  "station.relay": {
    stationId: string;
    step: "stopped" | "back" | "restart_due" | "restart_failed" | "paid_promotion";
    title: string;
    body: string;
    dedupeKey: string;
    /** The Network desk hears too (a relay that stopped). */
    desk: boolean;
  };
  /**
   * External stations (added 2026-09-30, follow-up Phase 6): one left the dial after its stream was
   * down 5 minutes (`hidden`), or is back on it (`back`). The Network desk hears. Worded where it
   * happens; one notice per `dedupeKey`.
   */
  "external.station": {
    stationId: string;
    sourceId: string;
    step: "hidden" | "back";
    title: string;
    body: string;
    dedupeKey: string;
  };
  /**
   * A234 (added 2026-09-30): a full station sharing X.1's call sign (`stationId`) no longer has an
   * owner in common with X.1 (`headId`), after an owner changed. Once per split (`dedupeKey` carries
   * when it split); nothing is emitted while they stay apart, or when they have an owner in common
   * again. The Network desk hears. Worded where it happens.
   */
  "station.call_sign_owners": {
    stationId: string;
    headId: string;
    step: "split";
    title: string;
    body: string;
    dedupeKey: string;
  };
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
