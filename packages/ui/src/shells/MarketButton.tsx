// The market button in the viewer's headers (core .market): a pin, the market's name, and on the
// web a chevron. Internal to the viewer shells.

import { cx } from "../lib/cx";
import { Icon } from "../icons/Icon";

export interface MarketButtonProps {
  /** The market's name ("Inland Empire"). */
  name: string;
  /** Opens the market picker. */
  onClick?: () => void;
  /** web: 38px with a chevron. phone: 34px, no chevron. */
  size?: "web" | "phone";
  className?: string;
}

export function MarketButton({ name, onClick, size = "web", className }: MarketButtonProps) {
  return (
    <button type="button" className={cx("oc-market-btn", size === "phone" && "oc-market-btn--phone", className)} onClick={onClick} aria-haspopup="dialog">
      <Icon name="pin" />
      {name}
      {size === "web" && <Icon name="down" />}
    </button>
  );
}
