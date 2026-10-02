// Things that happen on the clock: reminders, dead-air warnings, deadlines,
// daily caps at midnight, sponsorship months. One tick a minute. Run in one API
// replica only (JOBS=on) until the worker takes them over with its Redis lock.

import type { Deps, Services } from "./context.js";

export interface JobResults {
  reminders: number;
  deadAirChecked: number;
  claimsExpired: number;
  ordersApproved: number;
  unairedReleased: number;
  /** Provider moves sent (and failed, to retry) from the outbox. */
  moves: { sent: number; failed: number };
  chain: { events: number } | null;
  /** Pending transfers from linked Clear wallets, checked again. */
  clearTransfers: { arrived: number; failed: number } | null;
  escrowDeposit: { stations: number; micros: number; txHash: string } | null;
  payouts: { paid: number; micros: number; waiting: number } | null;
  pledgesRenewed: number;
  pool: { micros: number; stations: number; fundMicros: number } | null;
  dailyCapsResumed: number;
  sponsorships: { held: number; paid: number; lapsed: number } | null;
  /** A124: scheduled sign-ons that came due (a claimable station goes on air at its sign-on). */
  signOns: { signedOn: number; notReady: number } | null;
  /** P21: closed businesses whose leftover balance was sent back. */
  closedSwept: number;
  /** Day templates' dates generated this hour (three weeks ahead), or null in other minutes. */
  templates: { stations: number; dates: number } | null;
  /** Reserved call signs, once an hour (added 2026-09-29): reminders sent, holds ended, holds whose station signed on. */
  reservations?: { reminded: number; expired: number; signedOn: number } | null;
  /**
   * Watch data (added 2026-09-29, follow-up Phase 1): airings worked out (every ten minutes), and
   * once a day the sessions, minutes and votes past `watch_data.retention` deleted. Null in other minutes.
   */
  watchData?: { computed: number; finalized: number; votesDeleted: number } | null;
  watchDataPurged?: { sessions: number; minutes: number; votes: number } | null;
  /**
   * Pay-as-you-go (added 2026-09-29, follow-up Phase 2): usage measured (hourly), days and months
   * closed (UTC midnight), grace steps, Clear payments checked again.
   */
  billing?: import("./modules/ledger/billing.js").BillingTickResult | null;
  /**
   * Platform connections (added 2026-09-30, follow-up Phase 3): each connected YouTube and Twitch's
   * viewers this minute, YouTube's viewer geography (hourly), keys re-sealed after a rotation (daily).
   */
  platforms?: import("./modules/platforms/service.js").PlatformsTick | null;
  /** Relay viewers' parts of airings settled, not billed or returned this minute (added 2026-09-30). */
  relayViewers?: { settled: number; notBilled: number; returned: number } | null;
  /** The old translators' plain stream keys moved to sealed storage (added 2026-09-30; hourly, and at the first tick). Null in other minutes. */
  translatorKeys?: { moved: number; waiting: number; failed: number } | null;
  /**
   * Direct uploads (added 2026-09-30, follow-up Phase 4): completions picked up again after a restart,
   * uploads abandoned for 24 hours aborted, and (hourly) multipart uploads left open in the store aborted.
   */
  uploads?: { resumed: number; abandoned: number; orphans: number } | null;
}

export function createJobs(deps: Deps, services: Services) {
  let lastDay = "";
  let lastMonth = "";
  let lastHour = "";
  let lastWatch = 0;
  let lastTranslatorKeys = 0;
  let lastUploadOrphans = 0;

  async function tick(): Promise<JobResults> {
    const now = deps.clock.now();
    const due = await services.accounts.dueReminders(5);
    for (const reminder of due) {
      deps.bus.emit("reminder.due", {
        userId: reminder.userId,
        reminderId: reminder.id,
        title: reminder.airing.title,
        startsAt: reminder.airing.startsAt,
        switchMeOver: reminder.switchMeOver
      });
      await services.accounts.markReminderNotified(reminder.id);
    }
    const signOns = await services.playout.runDueSignOns().catch((error) => {
      console.error("[jobs] scheduled sign-ons failed", error);
      return null;
    });
    // Day templates: every hour, the dates three weeks ahead are generated (before the dead-air check reads them).
    const hour = now.toISOString().slice(0, 13);
    let templates: JobResults["templates"] = null;
    let reservations: JobResults["reservations"] = null;
    if (hour !== lastHour) {
      lastHour = hour;
      templates = await services.log.templates.generateAll().catch((error) => {
        console.error("[jobs] day templates failed", error);
        return null;
      });
      reservations = await services.waitlist.sweep().catch((error) => {
        console.error("[jobs] reserved call signs failed", error);
        return null;
      });
    }
    const onAir = await services.playout.onAirStations();
    await services.log.checkDeadAir(onAir);
    const claimsExpired = await services.trust.expireOverdue();
    const ordersApproved = await services.spots.autoApproveOrders();
    // Held airings that never aired (a missing file, a station signed off): the money goes back.
    const unairedReleased = await services.spots.releaseUnaired();
    // The escrow contract's news (claims approved, cancelled, paid; releases to the fund).
    const chain = await services.ledger.syncChain().catch((error) => {
      console.error("[jobs] escrow sync failed", error);
      return null;
    });
    // Transfers from Clear wallets that weren't mined yet when they were confirmed.
    const clearTransfers = await services.ledger.recheckClearTransfers().catch((error) => {
      console.error("[jobs] checking Clear transfers failed", error);
      return null;
    });
    // Watch data: each program airing's numbers, every ten minutes (collected only; nothing reads them to pay).
    let watchData: JobResults["watchData"] = null;
    if (now.getTime() - lastWatch >= 10 * 60_000) {
      lastWatch = now.getTime();
      watchData = await services.audience.watch.aggregate().catch((error) => {
        console.error("[jobs] watch data failed", error);
        return null;
      });
    }
    // Pay-as-you-go: usage measured every hour; at each UTC day's end the day is closed (accrued),
    // and at a month's end its bills (earnings first, then Clear or the card, else grace).
    const billing = await services.billing.tick().catch((error) => {
      console.error("[jobs] pay-as-you-go failed", error);
      return null;
    });
    // Relays (follow-up Phase 3): the viewers each connected platform reports this minute, then the
    // relay parts of airings settled as their numbers (and YouTube's location data) come in.
    const platforms = await services.platforms.tick().catch((error) => {
      console.error("[jobs] platform viewers failed", error);
      return null;
    });
    const relayViewers = await services.spots.settleRelayViewers().catch((error) => {
      console.error("[jobs] relay viewers failed", error);
      return null;
    });
    // The old translators' stream keys, out of plain text into the platforms module's sealed storage.
    let translatorKeys: JobResults["translatorKeys"] = null;
    if (now.getTime() - lastTranslatorKeys >= 3_600_000) {
      lastTranslatorKeys = now.getTime();
      translatorKeys = await services.stations.moveTranslatorKeys().catch((error) => {
        console.error("[jobs] moving translator keys failed", (error as Error).message);
        return null;
      });
    }
    // Direct uploads: completions nobody holds any more, and uploads nobody finished.
    const orphans = now.getTime() - lastUploadOrphans >= 3_600_000;
    if (orphans) lastUploadOrphans = now.getTime();
    const uploads = await services.uploads.sweep({ orphans }).catch((error) => {
      console.error("[jobs] uploads failed", error);
      return null;
    });
    // Last: whatever the ledger wrote this minute goes to the provider.
    const moves = await services.ledger.sendMoves();

    // Midnight: daily caps come back by themselves (Los Angeles time for now; per market later).
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
    let dailyCapsResumed = 0;
    let escrowDeposit: JobResults["escrowDeposit"] = null;
    let payouts: JobResults["payouts"] = null;
    let pledgesRenewed = 0;
    let closedSwept = 0;
    let pool: JobResults["pool"] = null;
    let watchDataPurged: JobResults["watchDataPurged"] = null;
    if (lastDay && day !== lastDay) {
      // Viewing sessions past the retention rule (30 days) go; each airing's numbers stay.
      watchDataPurged = await services.audience.watch.purge().catch((error) => {
        console.error("[jobs] watch data purge failed", error);
        return null;
      });
      dailyCapsResumed = await services.spots.resumeDailyCaps();
      // Mondays: claimable stations' earnings go into the escrow contract, in one batch.
      const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short" }).format(now);
      if (weekday === "Mon") {
        escrowDeposit = await services.ledger.escrowWeekly().catch((error) => {
          console.error("[jobs] weekly escrow deposit failed", error);
          return null;
        });
        // Last week's statements for stations.
        await services.ledger.issueStatements("week", new Date(Date.parse(`${day}T00:00:00Z`) - 7 * 86_400_000)).catch((error) => console.error("[jobs] statements failed", error));
      }
      // Payday: weekly (Mondays) unless the schedule says monthly (the 1st).
      const schedule = (await services.ledger.config()).payoutSchedule;
      if ((schedule === "weekly" && weekday === "Mon") || (schedule === "monthly" && day.endsWith("-01"))) {
        payouts = await services.ledger.runPayouts().catch((error) => {
          console.error("[jobs] payouts failed", error);
          return null;
        });
      }
      pledgesRenewed = await services.ledger.renewPledges();
      // P21: what's left of a closed business's balance, once its held airings have aired, goes back.
      closedSwept = await services.ledger.sweepClosedBusinesses().catch((error) => {
        console.error("[jobs] closed businesses failed", error);
        return 0;
      });
    }
    lastDay = day;

    const month = day.slice(0, 7);
    let sponsorships: JobResults["sponsorships"] = null;
    if (month !== lastMonth) {
      sponsorships = await services.spots.rollSponsorships();
      if (lastMonth) {
        // Last month: the pool is shared out, and businesses get their statements.
        const previous = new Date(`${lastMonth}-01T00:00:00Z`);
        pool = await services.ledger.distributePool(previous).catch((error) => {
          console.error("[jobs] pool failed", error);
          return null;
        });
        await services.ledger.issueStatements("month", previous).catch((error) => console.error("[jobs] statements failed", error));
      }
      lastMonth = month;
    }
    return { reminders: due.length, deadAirChecked: onAir.length, claimsExpired, ordersApproved, unairedReleased, moves, chain, clearTransfers, escrowDeposit, payouts, pledgesRenewed, pool, dailyCapsResumed, sponsorships, signOns, closedSwept, templates, reservations, watchData, watchDataPurged, billing, platforms, relayViewers, translatorKeys, uploads };
  }

  let timer: NodeJS.Timeout | undefined;
  return {
    tick,
    start(intervalMs = 60_000) {
      const run = () => tick().catch((error) => console.error("[jobs] tick failed", error));
      void run();
      timer = setInterval(run, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
    }
  };
}
