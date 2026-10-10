import { useId, useLayoutEffect, useRef, useState } from "react";
import { cx } from "../lib/cx";
import { clock, clockRange, type TimeInput } from "../lib/format";

export interface ChartPoint {
  at: TimeInput;
  value: number;
}

export interface ChartBreak {
  start: TimeInput;
  end: TimeInput;
}

export interface LineChartProps {
  /** Start of the time axis ("6:00 pm tonight"). */
  from: TimeInput;
  /** End of the time axis ("11:00 pm tonight"). The line can stop earlier, at now. */
  to: TimeInput;
  /** The main line (tonight), oldest first. Its last point is now. */
  series: ChartPoint[];
  /** The comparison line (last week), already moved onto this axis's clock times. Dashed. Leave out when there's no data. */
  comparison?: ChartPoint[];
  /** Breaks, shaded in standby. */
  breaks?: ChartBreak[];
  /** Mark the last point of `series` as now: a tally line, a dot, and "312 now". Default true. */
  now?: boolean;
  /** The chart's accessible summary ("Tuned in from 6 pm to now, tonight and last Saturday"). */
  label: string;
  /** Legend words for each mark. */
  seriesLabel?: string;
  comparisonLabel?: string;
  breaksLabel?: string;
  /** What the numbers are, for the hidden table's column ("Tuned in"). */
  valueLabel?: string;
  /** Phone: 140px tall, no axis words and no "now" words (earnings 04.1). */
  compact?: boolean;
  /** Height in px. Default 230, or 140 when compact. */
  height?: number;
  /** Show the legend under the chart. Default true (not when compact). */
  legend?: boolean;
  /** The market's time zone for the axis and the table. */
  timeZone?: string;
  className?: string;
}

const ms = (t: TimeInput) => (t instanceof Date ? t.getTime() : new Date(t).getTime());
const HOUR = 3_600_000;

/** A round step for the value axis, about five ticks up to `max`. */
export function niceStep(max: number): number {
  const raw = Math.max(max, 1) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  // Counts are whole: never a step under 1.
  return Math.max(1, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag);
}

/** The top of the value axis: a little headroom over the highest value, on a half step. */
export function niceTop(max: number): number {
  const step = niceStep(max);
  return Math.max(step, Math.ceil((Math.max(max, 1) * 1.05) / (step / 2)) * (step / 2));
}

/**
 * Hour labels for the time axis in the 12-hour clock: "6 pm", "7", "8" … am/pm is said on the
 * first label and wherever it changes. `every` is the step in hours.
 */
export function hourTicks(from: TimeInput, to: TimeInput, every = 1, timeZone?: string): Array<{ at: number; text: string }> {
  const a = ms(from);
  const b = ms(to);
  const out: Array<{ at: number; text: string }> = [];
  let last = "";
  for (let t = Math.ceil(a / HOUR) * HOUR; t <= b; t += every * HOUR) {
    const full = clock(t, { timeZone }).replace(":00", "");
    const [hour, period] = full.split(" ");
    out.push({ at: t, text: period !== last ? full : hour });
    last = period;
  }
  return out;
}

/**
 * Day labels for a span of several days (A251, the desk's analytics): "Tue 29" at each local
 * midnight, every `every` days.
 */
export function dayTicks(from: TimeInput, to: TimeInput, every = 1, timeZone?: string): Array<{ at: number; text: string }> {
  const a = ms(from);
  const b = ms(to);
  const hourOf = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" });
  const dayOf = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", day: "numeric" });
  const out: Array<{ at: number; text: string }> = [];
  let n = 0;
  for (let t = Math.ceil(a / HOUR) * HOUR; t <= b; t += HOUR) {
    if (Number(hourOf.format(t)) % 24 !== 0) continue;
    if (n++ % every === 0) {
      const parts = dayOf.formatToParts(t);
      out.push({ at: t, text: `${parts.find((p) => p.type === "weekday")!.value} ${parts.find((p) => p.type === "day")!.value}` });
    }
    t += 22 * HOUR; // the next midnight is 23 to 25 hours on
  }
  return out;
}

function path(points: ChartPoint[], x: (t: number) => number, y: (v: number) => number) {
  return points.map((p, i) => `${i ? "L" : "M"}${x(ms(p.at)).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
}

/**
 * The audience line: tonight against last week's dashed line, breaks shaded, and a "now" marker.
 * SVG, sized by its container. Screen readers get the summary and a table of the numbers.
 */
export function LineChart({
  from,
  to,
  series,
  comparison,
  breaks = [],
  now = true,
  label,
  seriesLabel = "Tonight",
  comparisonLabel = "Last Saturday",
  breaksLabel = "Breaks",
  valueLabel = "Tuned in",
  compact = false,
  height,
  legend,
  timeZone,
  className
}: LineChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1180);
  const tableId = useId();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setWidth(el.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const h = height ?? (compact ? 140 : 230);
  const left = compact ? 0 : 40;
  const right = width - (compact ? 0 : 10);
  const top = 10;
  const bottom = h - (compact ? 6 : 26);

  const a = ms(from);
  const b = Math.max(ms(to), a + 1);
  const x = (t: number) => left + ((t - a) / (b - a)) * (right - left);
  const max = Math.max(1, ...series.map((p) => p.value), ...(comparison ?? []).map((p) => p.value));
  const step = niceStep(max);
  const yTop = niceTop(max);
  const y = (v: number) => bottom - (v / yTop) * (bottom - top);
  const yTicks: number[] = [];
  for (let v = 0; v < yTop; v += step) yTicks.push(v);

  // Hour labels at least ~64px apart.
  const pxPerHour = ((right - left) * HOUR) / (b - a);
  const every = [1, 2, 3, 6, 12, 24].find((n) => n * pxPerHour >= 64);
  // Several days: a label a day (or every few), not the hours.
  const everyDays = [1, 2, 7, 14, 30, 60].find((n) => n * 24 * pxPerHour >= 64) ?? 60;
  const xTicks = compact ? [] : every && every < 24 && b - a <= 48 * HOUR ? hourTicks(a, b, every, timeZone) : dayTicks(a, b, everyDays, timeZone);

  const last = series[series.length - 1];
  const nowX = last ? x(ms(last.at)) : 0;
  const nowText = last ? `${last.value.toLocaleString("en-US")} now` : "";
  const nowLeft = nowX + 8 + nowText.length * 6.6 > width;

  const showLegend = legend ?? !compact;

  // The hidden table: every time either line has a value.
  const times = Array.from(new Set([...series, ...(comparison ?? [])].map((p) => ms(p.at)))).sort((m, n) => m - n);
  const valueAt = (list: ChartPoint[] | undefined, t: number) => list?.find((p) => ms(p.at) === t)?.value;

  return (
    <figure className={cx("oc-chart", compact && "oc-chart--compact", className)}>
      <div ref={ref} className="oc-chart__box">
        <svg className="oc-chart__svg" width={width} height={h} viewBox={`0 0 ${width} ${h}`} role="img" aria-label={label} aria-describedby={tableId}>
          {yTicks.map((v) => (
            <g key={v}>
              <line className="oc-chart__grid" x1={left} x2={right} y1={y(v)} y2={y(v)} />
              {!compact && (
                <text className="oc-chart__axis" x={0} y={y(v) + 4}>
                  {v.toLocaleString("en-US")}
                </text>
              )}
            </g>
          ))}
          {breaks.map((br, i) => (
            <rect key={i} className="oc-chart__band" x={x(ms(br.start))} y={top} width={Math.max(1, x(ms(br.end)) - x(ms(br.start)))} height={bottom - top} />
          ))}
          {xTicks.map((t, i) => (
            <text
              key={t.at}
              className="oc-chart__axis"
              x={x(t.at)}
              y={bottom + 20}
              textAnchor={i === 0 && x(t.at) - left < 20 ? "start" : right - x(t.at) < 20 ? "end" : "middle"}
            >
              {t.text}
            </text>
          ))}
          {comparison && comparison.length > 1 && <path className="oc-chart__prev" d={path(comparison, x, y)} />}
          {series.length > 1 && (
            <>
              <path className="oc-chart__area" d={`${path(series, x, y)} L${nowX.toFixed(1)} ${bottom} L${x(ms(series[0].at)).toFixed(1)} ${bottom} Z`} />
              <path className="oc-chart__line" d={path(series, x, y)} />
            </>
          )}
          {now && last && (
            <>
              <line className="oc-chart__now" x1={nowX} x2={nowX} y1={top} y2={bottom} />
              <circle className="oc-chart__nowdot" cx={nowX} cy={y(last.value)} r={5} />
              {!compact && (
                <text className="oc-chart__label" x={nowLeft ? nowX - 8 : nowX + 8} y={y(last.value) - 8} textAnchor={nowLeft ? "end" : "start"}>
                  {nowText}
                </text>
              )}
            </>
          )}
        </svg>
      </div>
      {showLegend && (
        <figcaption className="oc-chart__legend" aria-hidden="true">
          <span>
            <i />
            {seriesLabel}
          </span>
          {comparison && comparison.length > 0 && (
            <span>
              <i className="oc-chart__key--prev" />
              {comparisonLabel}
            </span>
          )}
          {breaks.length > 0 && (
            <span>
              <i className="oc-chart__key--break" />
              {breaksLabel}
            </span>
          )}
        </figcaption>
      )}
      <table className="oc-sr-only" id={tableId}>
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">
              {valueLabel}, {seriesLabel.toLowerCase()}
            </th>
            {comparison && (
              <th scope="col">
                {valueLabel}, {comparisonLabel.toLowerCase()}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {times.map((t) => (
            <tr key={t}>
              <th scope="row">{clock(t, { timeZone })}</th>
              <td>{valueAt(series, t) ?? ""}</td>
              {comparison && <td>{valueAt(comparison, t) ?? ""}</td>}
            </tr>
          ))}
        </tbody>
        {breaks.length > 0 && (
          <tfoot>
            <tr>
              <th scope="row">{breaksLabel}</th>
              <td colSpan={comparison ? 2 : 1}>{breaks.map((br) => clockRange(br.start, br.end, { timeZone })).join(", ")}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </figure>
  );
}
