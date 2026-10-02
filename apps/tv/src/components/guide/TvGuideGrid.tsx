// The guide grid at ten feet (tv 03.1 .gg): six stations, two hours in five-minute columns, the now
// line, one focused cell. Built here rather than with @opencast/ui's GuideGrid: that grid has no TV
// size (its type is 12 to 15px), writes its own cell lines ("Began 8:00", a span for what's on
// now) where the TV frame writes "Until 9:00" and "External, until 9:15", stacks the call sign over
// the channel where the TV puts the channel first, and takes pointer clicks with a selected
// state, not a focus that follows time. Placement and the now line are the package's
// (guideCells, NowLine). An external station (follow-up Phase 6) has the dashed "External" tag
// under its call sign, and its time with nothing listed reads its name and "Live, nothing listed".

import { useEffect, useRef } from "react";
import { clock, cx, guideCells, guideSlots, LiveText, NowLine, Tag } from "@opencast/ui";
import type { StationIdentX } from "../../api/ext";
import { cellLine, cellTitle, isExternal, SPAN, type Cell, type GuideRow } from "./guideLogic";
import "./TvGuideGrid.css";

export interface TvGuideGridProps {
  rows: GuideRow[];
  /** The first half hour on screen. */
  from: number;
  now: number;
  timeZone?: string;
  focusedKey: string | null;
  /** A pointer click (the remote never needs it). */
  onCell?: (row: number, cell: Cell) => void;
}

function heads(from: number, timeZone?: string): string[] {
  const slots = guideSlots(from, from + SPAN);
  const period = (d: Date) => clock(d, { timeZone }).slice(-2);
  return slots.map((d, i) => clock(d, { timeZone, suffix: i === 0 || period(d) !== period(slots[i - 1]!) }));
}

function CellView({ cell, station, colStart, colEnd, now, timeZone, focused, onClick }: { cell: Cell; station: StationIdentX; colStart: number; colEnd: number; now: number; timeZone?: string; focused: boolean; onClick?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The DOM follows focus too, for screen readers.
    if (focused) ref.current?.focus({ preventScroll: true });
  }, [focused]);
  const isNow = cell.start <= now && now < cell.end;
  const line = cellLine(cell, now, timeZone);
  const title = cellTitle(cell, station);
  return (
    <div
      ref={ref}
      role="gridcell"
      tabIndex={-1}
      aria-selected={focused}
      className={cx("tvg-cell", isNow && "tvg-cell--now", !cell.airing && !cell.nothingListed && "tvg-cell--off", focused && "tv-focus")}
      style={{ gridColumn: `${colStart} / ${colEnd}` }}
      onClick={onClick}
    >
      <b>
        {isNow && <span className="oc-sr-only">On now: </span>}
        {title}
      </b>
      {(line.live || line.text) && (
        <small>
          {line.live && (
            <>
              <LiveText className="tvg-live" />
              {line.text ? ", " : ""}
            </>
          )}
          {line.text}
        </small>
      )}
    </div>
  );
}

export function TvGuideGrid({ rows, from, now, timeZone, focusedKey, onCell }: TvGuideGridProps) {
  const to = from + SPAN;
  const wide = rows.some((r) => (r.station.channel ?? "").length > 4);
  return (
    <div className={cx("tvg-grid", wide && "tvg-grid--wide")} role="grid" aria-label="Guide">
      <div className="tvg-grid__head" role="row" aria-hidden="true">
        <div />
        {heads(from, timeZone).map((h, i) => (
          <div key={i}>{h}</div>
        ))}
      </div>
      {rows.map((r, ri) => {
        const programs = r.cells.map((c) => ({ id: c.key, title: c.airing?.title ?? (c.nothingListed ? r.station.name : ""), start: c.start, end: c.end }));
        const placed = guideCells(programs, from, to, now);
        return (
          <div key={r.station.id} className="tvg-grid__row" role="row" aria-label={[r.station.channel, r.station.callSign].filter(Boolean).join(" ")}>
            <div className="tvg-grid__st" role="rowheader">
              <span className="tvg-grid__ch oc-mono">{r.station.channel}</span>
              {isExternal(r.station) ? (
                <span className="tvg-grid__id">
                  <span className="tvg-grid__cs oc-cs">{r.station.callSign ?? r.station.name}</span>
                  <Tag variant="listed" className="tvg-tag">
                    External
                  </Tag>
                </span>
              ) : (
                <span className="tvg-grid__cs oc-cs">{r.station.callSign ?? r.station.name}</span>
              )}
            </div>
            {placed
              .filter((p) => p.colEnd > p.colStart)
              .map((p) => {
                const cell = r.cells.find((c) => c.key === p.program.id)!;
                return (
                  <CellView
                    key={cell.key}
                    cell={cell}
                    station={r.station}
                    colStart={p.colStart}
                    colEnd={p.colEnd}
                    now={now}
                    timeZone={timeZone}
                    focused={cell.key === focusedKey}
                    onClick={onCell ? () => onCell(ri, cell) : undefined}
                  />
                );
              })}
          </div>
        );
      })}
      <NowLine at={now} from={from} to={to} timeZone={timeZone} className="tvg-now" />
    </div>
  );
}

/** Quiet rows while the listings load. */
export function TvGuideGridPlaceholder({ from, timeZone }: { from: number; timeZone?: string }) {
  return (
    <div className="tvg-grid tvg-grid--loading" aria-busy="true" aria-label="Loading the guide">
      <div className="tvg-grid__head" aria-hidden="true">
        <div />
        {heads(from, timeZone).map((h, i) => (
          <div key={i}>{h}</div>
        ))}
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="tvg-grid__row" aria-hidden="true">
          <div className="tvg-grid__st">
            <span className="tvg-grid__ph tvg-grid__ph--st" />
          </div>
          <div className="tvg-grid__ph" style={{ gridColumn: `2 / ${i % 2 ? 8 : 14}` }} />
          <div className="tvg-grid__ph" style={{ gridColumn: `${i % 2 ? 8 : 14} / 26` }} />
        </div>
      ))}
    </div>
  );
}
