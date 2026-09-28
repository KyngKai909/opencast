import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { cx } from "../lib/cx";

export interface TooltipProps {
  /** The words. Short: a label or a reason ("On air only"). */
  content: ReactNode;
  /** The control it describes: one element that can take focus. */
  children: ReactElement<{ "aria-describedby"?: string }>;
  /** Above (default) or below the control. */
  placement?: "top" | "bottom";
  /** Wait before showing on hover, in ms. Focus shows it at once. */
  delay?: number;
  /** Show it now, without hover or focus (the gallery's still states). */
  open?: boolean;
  className?: string;
}

/**
 * A small label for a control (not drawn in the references; made from the tokens: raised ground,
 * ink text, the control corner, 13px). Shows on hover and on keyboard focus; Escape hides it.
 * It describes the control and never holds anything to press.
 */
export function Tooltip({ content, children, placement = "top", delay = 400, open, className }: TooltipProps) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  const visible = open ?? shown;

  const trigger = isValidElement(children)
    ? cloneElement(children, {
        "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" ")
      })
    : children;

  return (
    <span
      className={cx("oc-tooltip-anchor", className)}
      onMouseEnter={() => {
        clear();
        timer.current = setTimeout(() => setShown(true), delay);
      }}
      onMouseLeave={() => {
        clear();
        setShown(false);
      }}
      onFocus={() => {
        clear();
        setShown(true);
      }}
      onBlur={() => {
        clear();
        setShown(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && visible) {
          setShown(false);
          e.stopPropagation();
        }
      }}
    >
      {trigger}
      <span id={id} role="tooltip" className={cx("oc-tooltip", `oc-tooltip--${placement}`, visible && "oc-tooltip--shown")}>
        {content}
      </span>
    </span>
  );
}
