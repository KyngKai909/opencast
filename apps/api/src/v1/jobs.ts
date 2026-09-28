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
  escrowDeposit: { stations: number; micros: number; txHash: string } | null;
  dailyCapsResumed: number;
  sponsorships: { held: number; paid: number; lapsed: number } | null;
}

export function createJobs(deps: Deps, services: Services) {
  let lastDay = "";
  let lastMonth = "";

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
    // Last: whatever the ledger wrote this minute goes to the provider.
    const moves = await services.ledger.sendMoves();

    // Midnight: daily caps come back by themselves (Los Angeles time for now; per market later).
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
    let dailyCapsResumed = 0;
    let escrowDeposit: JobResults["escrowDeposit"] = null;
    if (lastDay && day !== lastDay) {
      dailyCapsResumed = await services.spots.resumeDailyCaps();
      // Mondays: claimable stations' earnings go into the escrow contract, in one batch.
      const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short" }).format(now);
      if (weekday === "Mon") {
        escrowDeposit = await services.ledger.escrowWeekly().catch((error) => {
          console.error("[jobs] weekly escrow deposit failed", error);
          return null;
        });
      }
    }
    lastDay = day;

    const month = day.slice(0, 7);
    let sponsorships: JobResults["sponsorships"] = null;
    if (month !== lastMonth) {
      sponsorships = await services.spots.rollSponsorships();
      lastMonth = month;
    }
    return { reminders: due.length, deadAirChecked: onAir.length, claimsExpired, ordersApproved, unairedReleased, moves, chain, escrowDeposit, dailyCapsResumed, sponsorships };
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
