import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../lib/cx";

/** The ten-foot canvas every TV screen is drawn on. */
export const TV_WIDTH = 1920;
export const TV_HEIGHT = 1080;

/**
 * The scale that fits the 1920×1080 canvas inside a box, keeping 16:9, and the offsets that
 * centre it (letterboxed or pillarboxed). A box with no height yet fits by width.
 */
export function fitTv(boxWidth: number, boxHeight: number): { scale: number; left: number; top: number } {
  if (boxWidth <= 0) return { scale: 0, left: 0, top: 0 };
  const byWidth = boxWidth / TV_WIDTH;
  const scale = boxHeight > 0 ? Math.min(byWidth, boxHeight / TV_HEIGHT) : byWidth;
  const height = boxHeight > 0 ? boxHeight : TV_HEIGHT * scale;
  return { scale, left: (boxWidth - TV_WIDTH * scale) / 2, top: (height - TV_HEIGHT * scale) / 2 };
}

export interface TvShellProps {
  /** The picture: full screen, under everything (a PictureFrame, a station band, the off-air screen). */
  picture?: ReactNode;
  /** Overlays inside the 90% title-safe area (the banner, the guide, panels). */
  children?: ReactNode;
  /** The hint row at the foot of the title-safe area ("Playing from Kai's phone"). */
  hints?: ReactNode;
  /** Scale the canvas to fit its container. Off draws it at 1920×1080. */
  fit?: boolean;
  className?: string;
}

/**
 * TV mode's ten-foot canvas: 1920×1080, always dark, the picture full bleed and everything else
 * inside the title-safe area. It scales to fit its container, keeping 16:9, letterboxed in black.
 */
export function TvShell({ picture, children, hints, fit = true, className }: TvShellProps) {
  const box = useRef<HTMLDivElement>(null);
  const [f, setF] = useState<ReturnType<typeof fitTv> | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!fit || !el) return;
    const measure = () => setF(fitTv(el.clientWidth, el.clientHeight));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const canvas = (
    <div
      className="oc-tv-shell__canvas"
      style={!fit ? undefined : f ? { transform: `translate(${f.left}px, ${f.top}px) scale(${f.scale})` } : { visibility: "hidden" }}
    >
      <div className="oc-tv-shell__picture">{picture}</div>
      <div className="oc-tv-shell__safe">
        <div className="oc-tv-shell__overlays">{children}</div>
        {hints && <div className="oc-tv-shell__hints">{hints}</div>}
      </div>
    </div>
  );

  return (
    <div
      ref={box}
      className={cx("oc-tv-shell", fit && "oc-tv-shell--fit", className)}
      data-ground="tv"
    >
      {canvas}
    </div>
  );
}
