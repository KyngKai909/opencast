// What the check says before anyone taps Redeem (biz-results 05.1 .big-ok): a ring with a check
// when the code is good (a warning sign when it isn't), the offer, and the check's own words:
// valid, first use for this customer, where it was saved.

import { Icon } from "@opencast/ui";
import "./CheckResult.css";

export function CheckResult({ valid, heading, message }: { valid: boolean; heading: string; message: string }) {
  return (
    <div className={`bz-check${valid ? "" : " bz-check--no"}`} role="status">
      <div className="bz-check__ring" aria-hidden="true">
        <Icon name={valid ? "check" : "warn"} />
      </div>
      <h2 className="bz-check__h">{heading}</h2>
      <p className="bz-check__p">{message}</p>
    </div>
  );
}
