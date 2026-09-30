// A listed source's checks (network-desk 05.1 .ok-t): a tick in ink-70 when it's fine, the warning
// sign in standby when someone needs to look. Words always, never colour alone.
import { Icon } from "@opencast/ui";
import type { ListedSource } from "@opencast/contracts";
import "./SourceStatus.css";

export function Ok({ children, warn }: { children: string; warn?: boolean }) {
  return (
    <span className={`nd-ok${warn ? " nd-ok--warn" : ""}`}>
      <Icon name={warn ? "warn" : "check"} size={14} />
      {children}
    </span>
  );
}

/** The Channel column: "9.1 RDLS", or "Not on the dial" while it isn't. */
export function channelText(s: ListedSource): string | null {
  return s.listingState === "listed" && s.station.channel ? `${s.station.channel} ${s.station.callSign ?? ""}`.trim() : null;
}

/** The Listings column. One wording for a synced calendar (inventory 11: the frame has two). */
export function listingsCell(s: ListedSource) {
  if (s.listingState !== "listed") return <span className="nd-ok__quiet">{s.listingState === "checking" ? "Checking" : "Not on the dial"}</span>;
  if (s.calendarSync === "synced") return <Ok>Synced from the agenda calendar</Ok>;
  if (s.calendarSync === "calendar_not_found") return <Ok warn>Calendar not found</Ok>;
  return <span className="nd-ok__quiet">No calendar yet</span>;
}

export function embeddingCell(s: ListedSource) {
  return s.embedTerms === "allowed" ? <Ok>Allowed</Ok> : <Ok warn>Terms unclear</Ok>;
}
