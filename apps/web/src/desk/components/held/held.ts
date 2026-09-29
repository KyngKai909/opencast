// Held earnings' words (network-desk 07.1): each station's line, its status, and the figures.
import { money } from "@opencast/ui";
import { dayMonth, dayWord } from "../../lib/dates";
import type { StageLook } from "../pipeline/stages";
import type { HeldEarnings } from "@opencast/contracts";
import type { HeldStation } from "../../api/types";

/** What a row holds: deposited and owed together, so the rows add up to the total. */
export function rowHeld(s: Pick<HeldStation, "heldMicros" | "owedNotYetDepositedMicros">): number {
  return s.heldMicros + s.owedNotYetDepositedMicros;
}

export function heldFigures(h: HeldEarnings) {
  // A125: the API counts the rows holding money; counted here from the rows when it doesn't say.
  const withMoney = h.stationsHoldingMoney ?? h.stations.filter((s) => rowHeld(s) > 0).length;
  const invitations = h.stations.filter((s) => s.status === "invited" || s.status === "claim_link_sent").length;
  const years = h.unclaimedPeriodDays ? h.unclaimedPeriodDays / 365 : null;
  return {
    total: money(h.totalHeldMicros),
    heldAcross: `Held across ${withMoney} ${withMoney === 1 ? "station" : "stations"}`,
    invitations,
    moved: money(h.everMovedToOpencastMicros),
    period: years === null ? null : Number.isInteger(years) ? `${years} ${years === 1 ? "year" : "years"}` : `${h.unclaimedPeriodDays} days`
  };
}

/** "102.0 CRAT, for Marcus Reyes" */
export function stationTitle(s: HeldStation): string {
  return `${s.station.channel ?? ""} ${s.station.callSign ?? s.station.name}, for ${s.creator}`.trim();
}

/** "On air since August 12, with permission"; "On air since September 20, under CC BY 4.0"; "Signs on Monday". */
export function stationDetail(s: HeldStation, timeZone: string, now: Date): string {
  if (s.onAirSince) return `On air since ${dayMonth(s.onAirSince, timeZone)}, ${s.rightsBasis === "licence" ? (s.licenceName ? `under ${s.licenceName}` : "under a licence") : "with permission"}`;
  if (s.signOnAt) {
    const d = dayWord(s.signOnAt, timeZone, now);
    return `Signs on ${d === "today" ? "today" : d}`;
  }
  return "Not scheduled to sign on yet";
}

export function statusOf(s: HeldStation, timeZone: string): { text: string; look: StageLook } {
  switch (s.status) {
    case "claim_link_sent":
      return { text: "Claim link sent", look: "wait" };
    case "invited":
      return { text: s.invitedAt ? `Invited ${dayMonth(s.invitedAt, timeZone, { short: true })}` : "Invited", look: "wait" };
    case "not_on_air_yet":
      return { text: "Not on air yet", look: "plain" };
    case "on_air":
      return { text: "On air, not invited", look: "plain" };
    case "claim_pending":
      return { text: "Claim being checked", look: "wait" };
    case "claimed":
      return { text: "Claimed", look: "plain" };
    case "stopped":
      return { text: "Stopped", look: "no" };
  }
}

/** "0x5ee2…a41d" */
export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
