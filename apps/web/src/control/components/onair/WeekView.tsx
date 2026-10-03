// A246: the Week view (opencast-schedule 03): seven broadcast days side by side, each headed with
// its day, the template that made it and "edited" in amber when it was changed by hand. Programs
// sit in their source's colour (the station's own and live in the station's, live with a "● Live"
// mark; carried in their maker's), a block runs down a day's edge, dead air is striped amber (the
// only amber in the week) and planned off air striped grey, and today has the now line. Whole days,
// scrolled to the evening (or now); choosing a day opens it in the Day view.

import { useLayoutEffect, useRef } from "react";
import { clock } from "@opencast/ui";
import { STATION_TZ } from "../../../lib/clock";
import type { WeekColumn } from "./dayRows";

/** One hour's height, in px. */
const HOUR_PX = 44;
const DAY_PX = HOUR_PX * 24;
/** The labels down the side: every two hours from 6:00 am. */
const HOURS = Array.from({ length: 12 }, (_, i) => 6 + i * 2);

export function WeekView({ columns, onOpenDay }: { columns: WeekColumn[]; onOpenDay: (date: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const nowAt = columns.find((c) => c.nowAt !== null)?.nowAt ?? null;
  useLayoutEffect(() => {
    // Opens at now on this week (a little above it), else at 4:00 pm, as the frame crops it.
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = nowAt !== null ? Math.max(0, nowAt * DAY_PX - 120) : 10 * HOUR_PX;
  }, [nowAt]);
  return (
    <div className="cc-wk" role="region" aria-label="The week">
      <div className="cc-wk__grid cc-wk__head">
        <span aria-hidden="true" />
        {columns.map((c) => (
          <button key={c.date} type="button" className={c.today ? "cc-wk__hd cc-wk__hd--today" : "cc-wk__hd"} onClick={() => onOpenDay(c.date)} aria-current={c.today ? "date" : undefined}>
            <b>{c.label}</b>
            <small>
              {c.template ?? "No template"}
              {c.edited && <span className="cc-wk__edited"> · edited</span>}
            </small>
            <span className="oc-sr-only">. Open the day</span>
          </button>
        ))}
      </div>
      <div className="cc-wk__scroll" ref={scroller} tabIndex={0} aria-label="The week's hours">
        <div className="cc-wk__grid" style={{ height: DAY_PX }}>
          <div className="cc-wk__tcol" aria-hidden="true">
            {HOURS.map((h) => (
              <span key={h} style={{ top: (h - 6) * HOUR_PX }}>
                {h % 12 === 0 ? (h === 12 ? "12 pm" : "12 am") : `${h % 12} ${h % 24 < 12 ? "am" : "pm"}`}
              </span>
            ))}
          </div>
          {columns.map((c) => (
            <div key={c.date} className="cc-wk__col" role="list" aria-label={c.label}>
              {c.bands.map((b) => (
                <span key={b.id} className="cc-wk__band" style={{ top: b.top * DAY_PX, height: b.height * DAY_PX, background: b.colour ?? "var(--ink-70)" }} title={b.name} aria-hidden="true" />
              ))}
              {c.events.map((e) => {
                const at = clock(e.at, { timeZone: STATION_TZ });
                const words = e.kind === "gap" ? `Dead air, ${at}` : e.kind === "off" ? `Off air, ${at}` : `${e.title}, ${at}${e.kind === "live" ? ", live" : ""}`;
                return (
                  <button
                    key={e.id}
                    type="button"
                    role="listitem"
                    className={`cc-wk__ev cc-wk__ev--${e.kind}`}
                    style={{ top: e.top * DAY_PX, height: Math.max(14, e.height * DAY_PX - 2), ...(e.colour && (e.kind === "program" || e.kind === "live") ? { background: e.colour } : {}) }}
                    onClick={() => onOpenDay(c.date)}
                    aria-label={words}
                    title={words}
                  >
                    <span className="cc-wk__t">{e.title}</span>
                    {e.height * DAY_PX > 26 && <small>{e.kind === "live" ? "● Live" : at}</small>}
                  </button>
                );
              })}
              {c.nowAt !== null && <span className="cc-wk__now" style={{ top: c.nowAt * DAY_PX }} aria-hidden="true" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
