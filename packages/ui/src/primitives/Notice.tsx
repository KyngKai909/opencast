import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/glyphs";

export interface NoticeProps {
  /** standby: amber, needs attention or committed-not-on-air. plain: a line-grey border, for information. */
  tone?: "standby" | "plain";
  /**
   * bar: one line with a leading sign and a trailing action (.warnbar, .okbar; with a swatch or a
   * detail line it becomes .notice and .req). banner: a larger block with a state tag and a heading (.pz-banner).
   */
  layout?: "bar" | "banner";
  /** The leading sign. Standby bars default to the warning sign; pass null for none. */
  icon?: IconName | null;
  /** A station's or business's colour, as a small square before the words. */
  swatch?: string;
  /** A channel number after the swatch, in mono ("88.4"). */
  channel?: string;
  /** The bold first words. In a bar with no detail it runs into the rest of the line. */
  title?: ReactNode;
  /** A smaller second line under the title. */
  detail?: ReactNode;
  /** The rest of a one-line bar: " 2 hr 20 min with nothing scheduled." */
  children?: ReactNode;
  /** The trailing action: a small ghost button ("Fill it", "Review", "Add it back"). */
  action?: ReactNode;
  /** The banner's state tag above its heading ("Paused, budget spent"). */
  tag?: ReactNode;
  className?: string;
}

/**
 * A notice on the page: amber standby (needs attention) or plain. Its words carry the meaning;
 * a standby notice also says "Needs attention" to screen readers, so the amber is never alone.
 */
export function Notice({ tone = "standby", layout = "bar", icon, swatch, channel, title, detail, children, action, tag, className }: NoticeProps) {
  const standby = tone === "standby";
  const spoken = standby ? <span className="oc-sr-only">Needs attention. </span> : null;

  if (layout === "banner") {
    return (
      <div className={cx("oc-notice", "oc-notice--banner", `oc-notice--${tone}`, className)}>
        {spoken}
        {tag}
        {title && <h3 className="oc-notice__heading">{title}</h3>}
        {(detail || children) && <p className="oc-notice__text">{detail ?? children}</p>}
        {action && <div className="oc-notice__actions">{action}</div>}
      </div>
    );
  }

  const leading = icon === undefined ? (standby && !swatch ? "warn" : null) : icon;
  const rich = swatch !== undefined || detail !== undefined;

  if (rich) {
    return (
      <div className={cx("oc-notice", "oc-notice--detail", channel && "oc-notice--channel", `oc-notice--${tone}`, className)}>
        {swatch !== undefined ? (
          <span className="oc-notice__sw" style={{ background: swatch }} aria-hidden="true" />
        ) : leading ? (
          <Icon name={leading} className="oc-notice__ic" />
        ) : (
          <span aria-hidden="true" />
        )}
        {channel && <span className="oc-notice__ch">{channel}</span>}
        <div className="oc-notice__words">
          {spoken}
          {title && <b>{title}</b>}
          {detail && <small>{detail}</small>}
          {children}
        </div>
        {action ? <div className="oc-notice__end">{action}</div> : <span />}
      </div>
    );
  }

  return (
    <div className={cx("oc-notice", "oc-notice--bar", `oc-notice--${tone}`, className)}>
      {leading && <Icon name={leading} className="oc-notice__ic" />}
      <span className="oc-notice__words">
        {spoken}
        {title && <b>{title}</b>}
        {title && children ? " " : null}
        {children}
      </span>
      {action && <div className="oc-notice__end">{action}</div>}
    </div>
  );
}
