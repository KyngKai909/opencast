// The rules under the credit (sponsorships 02.1 .rule): what passes (who you are and where), and
// each flagged phrase with what's wrong and its fix. The "!" is a drawn sign with words for
// screen readers, not copy.

import { Button, Icon } from "@opencast/ui";
import type { CreditFlag } from "../../api/ext/deals";
import { flagWords } from "./format";
import "./CreditRules.css";

export function CreditRules({ who, flags, onFix }: { who: string | null | undefined; flags: CreditFlag[]; onFix: (f: CreditFlag) => void }) {
  if (!who && flags.length === 0) return null;
  return (
    <ul className="bz-rules" aria-label="The credit rules">
      {who && (
        <li className="bz-rules__rule bz-rules__rule--ok">
          <span className="bz-rules__ic" aria-hidden="true">
            <Icon name="check" size={12} />
          </span>
          <div>
            <span className="oc-sr-only">Passes: </span>
            <b>Who you are and where</b>
            <small>"{who}"</small>
          </div>
        </li>
      )}
      {flags.map((f) => {
        const w = flagWords(f);
        return (
          <li key={`${f.kind}-${f.start}`} className="bz-rules__rule bz-rules__rule--fix">
            <span className="bz-rules__ic" aria-hidden="true">
              !
            </span>
            <div>
              <span className="oc-sr-only">Needs a fix: </span>
              <b>{w.title}</b>
              <small>{w.detail}</small>
            </div>
            <Button size="sm" onClick={() => onFix(f)}>
              {w.action}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
