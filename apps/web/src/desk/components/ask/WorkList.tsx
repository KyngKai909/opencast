// Which works (network-desk 03.1 .works, .wk): each group or single work with a tick box, its count
// and length, and "Included" or "Left out". Only ticked works are covered by the yes.
import { Icon } from "@opencast/ui";
import type { CreatorWorkX } from "../../api/ext";
import { groupDetail, groupWorks } from "./works";
import "./WorkList.css";

export interface WorkListProps {
  works: CreatorWorkX[];
  included: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
}

export function WorkList({ works, included, onChange, disabled }: WorkListProps) {
  const groups = groupWorks(works);
  return (
    <div className="nd-works">
      {groups.map((g) => {
        const on = g.works.every((w) => included.has(w.id));
        const toggle = () => {
          const next = new Set(included);
          for (const w of g.works) {
            if (on) next.delete(w.id);
            else next.add(w.id);
          }
          onChange(next);
        };
        return (
          <label key={g.key} className={`nd-wk${on ? "" : " nd-wk--off"}`}>
            <input type="checkbox" className="nd-wk__input" checked={on} onChange={toggle} disabled={disabled} />
            <span className="nd-wk__bx" aria-hidden="true">
              {on && <Icon name="check" size={12} />}
            </span>
            <span className="nd-wk__words">
              <b>{g.title}</b>
              <small>{groupDetail(g, on)}</small>
            </span>
            <span className="nd-wk__state">{on ? "Included" : "Left out"}</span>
          </label>
        );
      })}
    </div>
  );
}
