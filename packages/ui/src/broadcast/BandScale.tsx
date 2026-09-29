import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { cx } from "../lib/cx";
import { stationStyle } from "./time";

export interface BandStation {
  /** 88.4 */
  frequency: number;
  callSign: string;
  colour: string;
}

export interface BandScaleProps {
  /** The market's radio stations. Gaps on the scale are open frequencies. */
  stations: BandStation[];
  /** The frequency you're tuned to: the needle. None when you're on the TV band. */
  tuned?: number;
  /** Clicking a station mark, or the arrow keys, tune to it. */
  onTune?: (frequency: number) => void;
  /** The band. FM: 88 to 108. */
  min?: number;
  max?: number;
  /** The phone: a wider scale that scrolls sideways, keeping the needle in view. */
  scroll?: boolean;
  className?: string;
}

/** Where a frequency sits on the band, as a percentage from the left. */
export function bandPosition(frequency: number, min = 88, max = 108): number {
  return ((frequency - min) / (max - min)) * 100;
}

/** The station after (or before) the tuned frequency along the band, wrapping at the ends. */
export function bandStep(stations: BandStation[], tuned: number | undefined, dir: 1 | -1): number | undefined {
  const fs = stations.map((s) => s.frequency).sort((a, b) => a - b);
  if (!fs.length) return undefined;
  if (tuned == null) return dir > 0 ? fs[0] : fs[fs.length - 1];
  if (dir > 0) return fs.find((f) => f > tuned + 1e-9) ?? fs[0];
  return [...fs].reverse().find((f) => f < tuned - 1e-9) ?? fs[fs.length - 1];
}

/** The radio band, 88 to 108, with each station's mark and the needle on the one you're tuned to. */
export function BandScale({ stations, tuned, onTune, min = 88, max = 108, scroll, className }: BandScaleProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const scale = useRef<HTMLDivElement>(null);

  // Keep the needle in view on the phone: centre it in the scroller.
  useLayoutEffect(() => {
    if (!scroll || tuned == null || !wrap.current || !scale.current) return;
    const x = (scale.current.offsetWidth * bandPosition(tuned, min, max)) / 100;
    wrap.current.scrollLeft = Math.max(0, x - wrap.current.clientWidth / 2);
  }, [scroll, tuned, min, max]);

  const ticks: Array<{ f: number; major: boolean }> = [];
  for (let f = min; f <= max + 1e-9; f += 0.5) ticks.push({ f: Math.round(f * 10) / 10, major: Math.abs(f % 2) < 1e-9 });

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = bandStep(stations, tuned, e.key === "ArrowRight" ? 1 : -1);
    if (next == null) return;
    e.preventDefault();
    onTune?.(next);
    const btn = scale.current?.querySelector<HTMLButtonElement>(`[data-frequency="${next}"]`);
    btn?.focus();
  };

  const body = (
    <div ref={scale} className={cx("oc-band-scale", scroll && "oc-band-scale--phone")} role="group" aria-label="Radio band" onKeyDown={onKey}>
      {ticks.map(({ f, major }) => (
        <span key={`t${f}`} aria-hidden="true">
          <span className={cx("oc-band-scale__tick", major && "oc-band-scale__tick--maj")} style={{ left: `${bandPosition(f, min, max)}%` }} />
          {major && (
            <span className="oc-band-scale__lbl" style={{ left: `${bandPosition(f, min, max)}%` }}>
              {f}
            </span>
          )}
        </span>
      ))}
      {stations.map((s) => {
        const on = tuned != null && Math.abs(s.frequency - tuned) < 1e-9;
        return (
          <button
            key={s.frequency}
            type="button"
            className="oc-band-scale__stn"
            style={stationStyle(s.colour, { left: `${bandPosition(s.frequency, min, max)}%` })}
            data-frequency={s.frequency}
            aria-label={`${s.callSign} ${s.frequency.toFixed(1)}`}
            aria-pressed={on}
            tabIndex={on || (tuned == null && s === stations[0]) ? 0 : -1}
            onClick={() => onTune?.(s.frequency)}
          >
            <span className="oc-cs">{s.callSign}</span>
            <span className="oc-band-scale__f">{s.frequency.toFixed(1)}</span>
            <span className="oc-band-scale__bar" />
          </button>
        );
      })}
      {tuned != null && <span className="oc-band-scale__needle" style={{ left: `${bandPosition(tuned, min, max)}%` }} aria-hidden="true" />}
    </div>
  );
  return scroll ? (
    <div ref={wrap} className={cx("oc-band-scroll", className)}>
      {body}
    </div>
  ) : (
    <div ref={wrap} className={className}>
      {body}
    </div>
  );
}
