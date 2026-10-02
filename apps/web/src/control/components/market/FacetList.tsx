// Checkbox rows with counts, in groups (market 01.1 .facets .fc): Kind, Band, Category, Deal,
// Made by. Real checkboxes; each group is a fieldset named by its heading.

import { Icon } from "@opencast/ui";
import "./FacetList.css";

export interface FacetOption<V extends string = string> {
  value: V;
  label: string;
  count: number;
}

export interface FacetGroup<V extends string = string> {
  key: string;
  label: string;
  options: FacetOption<V>[];
  selected: V[];
}

export function FacetList({ groups, onChange, label }: { groups: FacetGroup[]; onChange: (key: string, selected: string[]) => void; label: string }) {
  return (
    <div className="cc-mk-facets" role="group" aria-label={label}>
      {groups.map((g) => (
        <fieldset key={g.key} className="cc-mk-facets__group">
          <legend className="cc-mk-facets__g">{g.label}</legend>
          {g.options.map((o) => {
            const on = g.selected.includes(o.value);
            return (
              <label key={o.value} className={`cc-mk-fc${on ? " cc-mk-fc--on" : ""}`}>
                <input
                  type="checkbox"
                  className="cc-mk-fc__input"
                  checked={on}
                  onChange={(e) => onChange(g.key, e.target.checked ? [...g.selected, o.value] : g.selected.filter((v) => v !== o.value))}
                />
                <span className="cc-mk-fc__bx" aria-hidden="true">
                  {on && <Icon name="check" size={11} />}
                </span>
                {o.label}
                <span className="cc-mk-fc__ct" aria-label={`${o.count} programs`}>
                  {o.count}
                </span>
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
