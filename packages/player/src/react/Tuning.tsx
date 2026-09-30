// Changing channel over the picture (follow-up Phase 5, viewer/opencast-tuning.html): the new
// channel's number and call sign top right inside title safe the moment it's pressed, soft static
// over the old picture (or, with reduced motion, a dim and a crossfade), the program's name and
// "Tuning in" after 800 ms, and the static rolling away when the picture arrives. Stand by, after
// 8 s without a picture, is its own screen (StandbyScreen), with the colour bars.

import { useLayoutEffect, useRef } from "react";
import { Slate, cx } from "@opencast/ui";
import type { TuningState } from "../tuning/change";
import { GrainPainter } from "../tuning/grain";
import type { Channel } from "../types";

/** The static: a canvas at half the picture's size (2 px grain), redrawn 24 times a second while it's up. */
export function TuningStatic({ rolling }: { rolling: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const painter = new GrainPainter(el);
    const size = () => {
      const box = (el.parentElement ?? el).getBoundingClientRect();
      if (box.width && box.height) painter.resize(box.width, box.height);
    };
    // The first frame is painted before the browser draws: the static covers the old picture at once.
    size();
    painter.start();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(size) : null;
    ro?.observe(el.parentElement ?? el);
    return () => {
      ro?.disconnect();
      painter.stop();
    };
  }, []);
  return <canvas ref={canvas} className={cx("oc-tune__static", rolling && "is-rolling")} aria-hidden="true" data-testid="tuning-static" />;
}

function ident(c: Channel): string {
  return [c.station.callSign, c.station.channel].filter(Boolean).join(" ") || c.station.name;
}

export interface TuningLayerProps {
  tuning: TuningState;
  /** The channel being tuned to. */
  channel: Channel;
  size: "web" | "tv";
  /** Number entry is up (its panel sits where the corner number does): the number steps aside. */
  entry?: boolean;
}

/** Everything drawn over the picture while changing channel, for the static and the reduced-motion looks. */
export function TuningLayer({ tuning: t, channel: c, size, entry }: TuningLayerProps) {
  const clearing = t.phase === "clearing";
  // The corner number goes as the static rolls away (with reduced motion, once the crossfade is done).
  const number = !entry && (!clearing || t.look === "fade");
  return (
    <div className={cx("oc-tune", `oc-tune--${size}`, `oc-tune--${t.look}`, clearing && "is-clearing")} data-phase={t.phase} data-look={t.look} data-testid="tuning">
      {t.look === "static" && <TuningStatic rolling={clearing} />}
      {t.look === "fade" && <div className="oc-tune__dim" aria-hidden="true" />}
      {number && (
        <div className="oc-tune__osd" role="status" aria-live="polite" aria-label={`Tuning to ${ident(c)}`}>
          <span className="oc-tune__n oc-mono">{c.station.channel}</span>
          {c.station.callSign && <span className="oc-tune__c oc-cs">{c.station.callSign}</span>}
        </div>
      )}
      {t.phase === "tuning_in" && (
        <div className="oc-tune__hold">
          <b>{c.now?.title ?? c.station.name}</b>
          <span>Tuning in</span>
        </div>
      )}
    </div>
  );
}

/** Stand by: a channel change that got no picture in 8 s. The colour bars, and what's happening. */
export function StandbyScreen({ channel: c, size }: { channel: Channel; size: "web" | "tv" }) {
  const who = [c.station.callSign, c.station.channel].filter(Boolean).join(" ") || c.station.name;
  return (
    <div className="oc-player__cover oc-player__standby" data-testid="standby">
      <Slate kind="standby" size={size === "tv" ? "tv" : "screen"}>
        {`The signal from ${who} isn't coming through. Trying again.`}
      </Slate>
    </div>
  );
}
