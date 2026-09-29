// Your market's dial, in channel order (home 01.1, 02.1): the band switch, the category chips and
// one row per station. A row tunes in and opens the tuned-in page; its ident opens the station preview.

import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { Button, ChipRow, Dial, DialRow, Segmented, type DialNow } from "@opencast/ui";
import type { DialRowX } from "../../api/ext";
import { CHIP_ALL, chipOptions, filterRows, stationsText } from "./logic";
import { useAppLink, useOpenStation, useTuneAndWatch } from "./nav";
import "./MarketDial.css";

/** What a dial row says is on: the airing, or Off air until it signs on again. */
export function dialNow(r: DialRowX, detail?: ReactNode): DialNow {
  if (!r.onAir || !r.now) return { title: "", offAir: true, until: r.next?.startsAt, detail };
  return {
    title: r.now.title,
    until: r.now.endsAt,
    live: r.now.live,
    listed: r.now.kind === "listed",
    carriedFrom: r.now.carriedFrom?.callSign ?? undefined,
    detail
  };
}

/** One station's row, wired: a click tunes in, the ident opens the preview. */
export function StationRow({ row, variant, at, timeZone, detail }: { row: DialRowX; variant: "web" | "phone" | "radio"; at: Date; timeZone: string; detail?: string }) {
  const tuneAndWatch = useTuneAndWatch();
  const openStation = useOpenStation();
  const s = row.station;
  return (
    <DialRow
      variant={variant}
      station={{ channel: s.channel ?? "", callSign: s.callSign ?? "", name: s.name, colour: s.colour ?? "#33507A" }}
      now={dialNow(row, detail)}
      next={variant === "web" && row.next ? { at: row.next.startsAt, title: row.next.title, live: row.next.live } : undefined}
      at={at}
      timeZone={timeZone}
      onTune={() => tuneAndWatch(s)}
      onOpenStation={() => openStation(s)}
    />
  );
}

/** Quiet ruled rows while the dial loads. */
export function DialWaiting({ rows = 6 }: { rows?: number }) {
  return (
    <div className="vw-dial-wait" aria-busy="true" aria-label="The dial">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="vw-dial-wait__row" />
      ))}
    </div>
  );
}

export interface MarketDialProps {
  marketName: string;
  rows: DialRowX[] | undefined;
  error?: string | null;
  phone: boolean;
  chip: string;
  onChip: (chip: string) => void;
  at: Date;
  timeZone: string;
}

export function MarketDial({ marketName, rows, error, phone, chip, onChip, at, timeZone }: MarketDialProps) {
  const navigate = useNavigate();
  const link = useAppLink();
  const toRadio = (v: string) => v === "radio" && navigate("/radio");
  const shown = rows ? filterRows(rows, chip) : [];
  const chipLabel = rows ? chipOptions(rows).find((c) => c.value === chip)?.label : undefined;

  const body = error ? (
    <p className="vw-dial-msg" role="alert">
      {error}
    </p>
  ) : !rows ? (
    <DialWaiting />
  ) : rows.length === 0 ? (
    <p className="vw-dial-msg">No stations on the TV band yet.</p>
  ) : shown.length === 0 ? (
    <p className="vw-dial-msg">
      Nothing on the dial is {chip === "live" ? "live" : `in ${chipLabel ?? chip}`} right now.{" "}
      <button type="button" className="vw-dial-msg__all" onClick={() => onChip(CHIP_ALL)}>
        Show all stations
      </button>
    </p>
  ) : (
    <Dial header={!phone} label={`${marketName}, TV band`} className={phone ? "vw-dial--phone" : undefined}>
      {shown.map((r) => (
        <StationRow key={r.station.id} row={r} variant={phone ? "phone" : "web"} at={at} timeZone={timeZone} />
      ))}
    </Dial>
  );

  if (phone) {
    return (
      <section className="vw-sec vw-sec--phone" aria-labelledby="vw-dial-h">
        <div className="vw-sec-h">
          <h3 id="vw-dial-h">{marketName}</h3>
          <div className="vw-sec-h__end">
            <Segmented label="Band" value="tv" onChange={toRadio} options={[{ value: "tv", label: "TV" }, { value: "radio", label: "Radio" }]} />
          </div>
        </div>
        {body}
      </section>
    );
  }

  return (
    <section className="vw-sec" aria-labelledby="vw-dial-h">
      <div className="vw-sec-h">
        <h3 id="vw-dial-h">{marketName}</h3>
        {rows && <span className="vw-sec-h__sub">Your market, {stationsText(rows.length)} on the TV band</span>}
        <div className="vw-sec-h__end">
          <Segmented label="Band" value="tv" onChange={toRadio} options={[{ value: "tv", label: "TV band" }, { value: "radio", label: "Radio band" }]} />
          <Button variant="ghost" size="sm" {...link("/guide")}>
            Full guide
          </Button>
        </div>
      </div>
      {rows && rows.length > 0 && <ChipRow label="Filter the dial" options={chipOptions(rows)} value={chip} onChange={onChip} className="vw-dial-chips" />}
      {body}
    </section>
  );
}
