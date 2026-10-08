// The selected slot's line under the board (network-desk 01.1 .row2): what's on it, and where to go
// from here. Opening a slot with subchannels lists them (9.1, 9.2, 9.3). A234: a station sharing
// X.1's call sign whose owners no longer include anyone who owns X.1 says so on its line.

import { Button, clock, KeyValueList, type KeyValueRow } from "@opencast/ui";
import { now } from "../../../lib/clock";
import { dayMonth, dayWord } from "../../lib/dates";
import { ownersApartDetail, ownersApartOn, slotNumber } from "./board";
import "./SlotDetail.css";
import { controlPath } from "../../../areas";
import { deskPath } from "../../../areas";
import type { CallSignOwnersApart, Creator, StationIdent } from "@opencast/contracts";
import type { BoardSlot } from "../../api/types";

export interface SlotDetailProps {
  slot: BoardSlot;
  band: "tv" | "radio";
  marketSlug: string;
  timeZone: string;
  /** The claimable station's creator, from the pipeline (N7's creatorId, or by station). */
  creator: Creator | undefined;
  /** A234: the board's stations sharing X.1's call sign whose owners no longer match X.1's. */
  ownersApart?: CallSignOwnersApart[];
}

export function controlHref(callSign: string | null | undefined): string {
  return controlPath(callSign ? `/${callSign}/monitor` : "");
}

function openInControl(callSign: string | null | undefined, label = "Open in master control") {
  return (
    <Button size="sm" href={controlHref(callSign)} target="_blank" rel="noopener">
      {label}
    </Button>
  );
}

/** The station's page on the desk (added 2026-10-07): who made it, its people, uploads and log. */
function openFile(s: StationIdent | undefined) {
  return s ? (
    <Button size="sm" href={deskPath(`/analytics/stations/${s.id}?view=people`)}>
      Station file
    </Button>
  ) : null;
}

/** A station's part of master control's address: a family member's carries its channel ("beat-12-2", A229). */
const controlRef = (s: StationIdent | undefined) => (s?.sharesCallSign && s.slug ? s.slug : s?.callSign);

export function slotLines(p: SlotDetailProps): KeyValueRow[] {
  const { slot, band, creator, timeZone, marketSlug, ownersApart } = p;
  const first = slot.stations[0];
  const heading = first && slot.stations.length === 1 ? `${first.channel} ${first.callSign ?? first.name}, selected` : `${slotNumber(slot, band)}, selected`;
  switch (slot.state) {
    case "claimable": {
      const who = creator?.displayName ?? first?.name ?? "The creator";
      let detail: string;
      if (slot.signOnAt) {
        const day = dayWord(slot.signOnAt, timeZone, now());
        const signs = `signs on ${day} at ${clock(slot.signOnAt, { timeZone })}`;
        const why = creator?.licenceName ? `${who}'s work is published under ${creator.licenceName}` : creator?.answeredAt ? `${who} said yes ${dayMonth(creator.answeredAt, timeZone)}` : `${who}'s station`;
        detail = `Claimable. ${why}. Recipe set, ${signs}`;
      } else if (slot.status) {
        detail = `Claimable. ${who}'s station is being set up`;
      } else {
        detail = `Claimable, on air. ${who}'s station, waiting to be claimed`;
      }
      const pipelineHref = deskPath(creator ? `/markets/${marketSlug}/pipeline/${creator.id}/setup` : `/markets/${marketSlug}/pipeline`);
      return [{ title: heading, detail, actions: (<>{openInControl(first?.callSign)}{openFile(first)}<Button size="sm" href={pipelineHref}>Pipeline</Button></>) }];
    }
    case "station": {
      const line = { title: heading, detail: `Independent station. ${first?.name ?? ""}${first?.homeCity ? `, ${first.homeCity}` : ""}`, actions: (<>{openInControl(controlRef(first))}{openFile(first)}</>) };
      if (slot.stations.length < 2) return [line];
      // Subchannels: each its own line, and a station whose owners no longer match X.1's says so (A234).
      const apart = ownersApartOn(ownersApart, slot);
      return [
        // Each subchannel opens its own master control below.
        { title: heading, detail: `Independent stations. ${first?.name ?? ""}${first?.homeCity ? `, ${first.homeCity}` : ""}` },
        ...slot.stations.map((s) => {
          const a = apart.get(s.id);
          return {
            title: `${s.channel} ${s.callSign ?? s.name}`,
            detail: a ? `${s.name}. No longer shares an owner with ${a.head.channel} ${a.head.callSign}. ${ownersApartDetail(a, timeZone)}` : s.name,
            actions: (<>{openInControl(controlRef(s), `Open ${s.channel}`)}{openFile(s)}</>)
          };
        })
      ];
    }
    case "catalog":
      return [{ title: heading, detail: `Opencast catalog. ${first?.name ?? ""}`, actions: openInControl(first?.callSign) }];
    case "listed":
      return [
        {
          title: heading,
          detail: slot.stations.length > 1 ? `External city streams: ${slot.stations.map((s) => `${s.channel} ${s.callSign}`).join(", ")}` : `External city stream. ${first?.name ?? ""}`,
          actions: (
            <Button size="sm" href={deskPath(`/markets/${marketSlug}/listed`)}>
              External sources
            </Button>
          )
        },
        ...(slot.stations.length > 1 ? slot.stations.map((s) => ({ title: `${s.channel} ${s.callSign}`, detail: s.name })) : [])
      ];
    case "held":
      return [
        {
          title: heading,
          detail: `Held for the waitlist. ${slot.heldFor ?? "Someone"} asked for this number, so nothing else goes on it`,
          actions: (
            <Button size="sm" href={deskPath("/reserved-call-signs")}>
              Reserved call signs
            </Button>
          )
        }
      ];
    case "open":
      return [{ title: heading, detail: "Open. No station, and nobody on the waitlist has asked for it" }];
  }
  return [];
}

export function SlotDetail(p: SlotDetailProps) {
  return <KeyValueList variant="rows" className="nd-slot-detail" items={slotLines(p)} />;
}

/** Nothing selected yet. */
export function SlotHint() {
  return <KeyValueList variant="rows" className="nd-slot-detail" items={[{ title: "Choose a channel", detail: "See what's on it, who it's for, and where to go next" }]} />;
}
