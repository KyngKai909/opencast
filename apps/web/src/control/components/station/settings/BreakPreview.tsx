// A246, Break rules (opencast-schedule 05, .prev): the next hour rebuilt with the rules as set,
// before anything is saved. `previewBreakRule` answers what the log would show after saving the
// draft: each program, and each break drawn to scale in air order, with what airs between
// programs (Up next) after it. The draft is sent a moment after the last change (debounced), and
// the last answer stays on screen while the next one comes. An arrow moves the hour (to a day
// ahead). Breaks that keep what they have (spots placed, or under way) say so.

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { logApi, type BreakRow, type BreakRule, type BreakRulePreview, type LogEntry } from "@opencast/contracts";
import { BreakStrip, IconButton, clock, clockRange, type BreakStripPart } from "@opencast/ui";
import { call } from "../../../../api/client";
import { STATION_TZ } from "../../../../lib/clock";
import { breakKindOf, breakOwner, rowLength } from "../../onair/dayRows";

const HOUR = 3_600_000;
/** How long the preview waits after a change before asking. */
export const PREVIEW_DEBOUNCE_MS = 400;
/** How far ahead the arrows go. */
const MAX_AHEAD_HOURS = 23;

/** The value, once it's stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** The hour to preview: the next whole hour from now, `ahead` hours on. */
export function previewWindow(now: number, ahead = 0): { from: string; to: string } {
  const from = Math.ceil(now / HOUR) * HOUR + ahead * HOUR;
  return { from: new Date(from).toISOString(), to: new Date(from + HOUR).toISOString() };
}

/** A program's line: "Late Crate, ep. 14". */
function programTitle(e: Pick<LogEntry, "title" | "episodeTitle">): string {
  return e.episodeTitle && /^ep\. /.test(e.episodeTitle) && !e.title.endsWith(e.episodeTitle) ? `${e.title}, ${e.episodeTitle}` : e.title;
}

/** A break's parts in air order, as the preview's row draws them: inside the break, then between programs. */
export function previewParts(rows: BreakRow[], owner: string | null): { inBreak: BreakStripPart[]; between: BreakStripPart[] } {
  const shown = rows.filter((r) => r.lengthMs > 0 && !(r.element && !r.element.fits) && !(r.block && !r.block.fits));
  const part = (r: BreakRow): BreakStripPart => {
    const kind = breakKindOf(r);
    const label = kind === "barter" ? `${owner ?? "Maker"} barter` : kind === "spots" ? "Spot" : kind === "credit" ? "Credit" : kind === "id" ? "ID" : kind === "upnext" ? "Up next" : "";
    return { kind, length: r.lengthMs, label };
  };
  return { inBreak: shown.filter((r) => r.element?.position !== "between").map(part), between: shown.filter((r) => r.element?.position === "between").map(part) };
}

type Item = { at: string; key: string } & ({ kind: "program"; entry: LogEntry } | { kind: "break"; slot: BreakRulePreview["breaks"][number] });

export interface BreakPreviewProps {
  stationId: string;
  /** The draft, as it stands. */
  rule: BreakRule;
  dirty: boolean;
  now: number;
}

export function BreakPreview({ stationId, rule, dirty, now }: BreakPreviewProps) {
  const [ahead, setAhead] = useState(0);
  const win = useMemo(() => previewWindow(now, ahead), [now, ahead]);
  const body = useDebounced(useMemo(() => ({ rule, from: win.from, to: win.to }), [rule, win.from, win.to]), PREVIEW_DEBOUNCE_MS);
  const preview = useQuery({
    queryKey: ["break-rule-preview", stationId, body],
    queryFn: () => call(logApi.previewBreakRule, { params: { stationId }, body }),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000
  });
  const data = preview.data;
  const items: Item[] = data
    ? [
        ...data.entries.filter((e) => e.kind !== "off_air" && e.startsAt < data.to && e.endsAt > data.from).map((entry): Item => ({ kind: "program", at: entry.startsAt, key: entry.id, entry })),
        ...data.breaks.map((slot): Item => ({ kind: "break", at: slot.startsAt, key: `brk:${slot.startsAt}`, slot }))
      ].sort((a, b) => a.at.localeCompare(b.at) || (a.kind === "program" ? -1 : 1))
    : [];
  const title = `Preview: ${clockRange(win.from, win.to, { timeZone: STATION_TZ })}`;

  return (
    <section className="cc-prev" aria-labelledby="cc-prev-h" aria-busy={preview.isFetching}>
      <div className="cc-prev__head">
        <h2 className="cc-prev__h" id="cc-prev-h">
          {title}
        </h2>
        <span className="cc-prev__arrows">
          <IconButton icon="chev" label="An hour earlier" size="sm" className="cc-prev__arw cc-prev__arw--l" disabled={ahead === 0} onClick={() => setAhead((a) => Math.max(0, a - 1))} />
          <IconButton icon="chev" label="An hour later" size="sm" className="cc-prev__arw" disabled={ahead >= MAX_AHEAD_HOURS} onClick={() => setAhead((a) => Math.min(MAX_AHEAD_HOURS, a + 1))} />
        </span>
      </div>
      <p className="cc-prev__sub">{dirty ? "Rebuilt with the rules as set. Nothing is saved yet" : "Rebuilt with the rules as saved"}</p>
      {preview.isError && !data ? (
        <p className="cc-error" role="alert">
          The preview can't be built. {(preview.error as Error).message}
        </p>
      ) : !data ? (
        <p className="cc-prev__empty">Building the preview…</p>
      ) : items.length === 0 ? (
        <p className="cc-prev__empty">Nothing on the log this hour.</p>
      ) : (
        <ol className={preview.isFetching ? "cc-prev__rows cc-prev__rows--busy" : "cc-prev__rows"} aria-label="The hour, rebuilt">
          {items.map((it) => {
            if (it.kind === "program") {
              const e = it.entry;
              return (
                <li key={it.key} className="cc-prev__row">
                  <span className="cc-prev__t">{clock(e.startsAt, { timeZone: STATION_TZ, suffix: false, seconds: new Date(e.startsAt).getUTCSeconds() > 0 })}</span>
                  <span className="cc-prev__pgm">
                    {programTitle(e)} {e.kind === "live" ? <span className="cc-prev__q">live</span> : e.carriedFrom ? <span className="cc-prev__q">carried</span> : null}
                  </span>
                </li>
              );
            }
            const s = it.slot;
            const owner = breakOwner(s, data!.entries);
            const parts = previewParts(s.rows ?? [], owner);
            return (
              <li key={it.key} className={s.keeps ? "cc-prev__row cc-prev__row--brk cc-prev__row--keeps" : "cc-prev__row cc-prev__row--brk"}>
                <span className="cc-prev__t">{clock(s.startsAt, { timeZone: STATION_TZ, suffix: false, seconds: true })}</span>
                <span className="cc-prev__brk">
                  <BreakStrip parts={parts.inBreak} variant="mini" className="cc-prev__strip" />
                  {parts.between.map((p, i) => (
                    <span key={i} className={`cc-prev__between oc-brk--${p.kind}`} title="Between programs">
                      {p.label || "Bumper"} {rowLength(p.length)}
                    </span>
                  ))}
                </span>
                {s.keeps && <small className="cc-prev__keeps">Keeps what it has</small>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
