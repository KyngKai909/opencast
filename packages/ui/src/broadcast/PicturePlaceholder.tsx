import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export interface PicturePlaceholderProps {
  /** podium: the council chamber (a figure at a podium). reel: a title card on film grain. */
  scene?: "podium" | "reel";
  /** The reel's title card: "Saturday Reel". */
  title?: ReactNode;
  /** The line under it, in mono: "Cartoons, 1928 to 1934". */
  subtitle?: ReactNode;
  className?: string;
}

/** The reference's drawn stand-in for a picture, for mocks and the gallery. Goes inside a PictureFrame. */
export function PicturePlaceholder({ scene = "podium", title, subtitle, className }: PicturePlaceholderProps) {
  if (scene === "reel") {
    return (
      <div className={cx("oc-pic-ph", "oc-pic-ph--reel", className)}>
        <div className="oc-pic-ph__scene" aria-hidden="true" />
        {(title != null || subtitle != null) && (
          <div className="oc-pic-ph__card">
            <div>
              {title != null && <b>{title}</b>}
              {subtitle != null && <span>{subtitle}</span>}
            </div>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={cx("oc-pic-ph", "oc-pic-ph--podium", className)} aria-hidden="true">
      <div className="oc-pic-ph__scene" />
      <div className="oc-pic-ph__podium" />
      <div className="oc-pic-ph__figure" />
    </div>
  );
}
