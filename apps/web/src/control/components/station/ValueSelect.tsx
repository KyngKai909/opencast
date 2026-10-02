// A value in a settings row that's picked from a short list ("2:00", "3:00", "2 an hour"): drawn as
// the value, as the frames draw it, and a real select underneath (styles in settings/common.css).

import { Icon } from "@opencast/ui";

export interface ValueSelectProps<V extends string | number> {
  value: V;
  options: ReadonlyArray<{ value: V; label: string }>;
  onChange: (v: V) => void;
  /** The select's name for screen readers ("Break length"). */
  label: string;
  disabled?: boolean;
}

export function ValueSelect<V extends string | number>({ value, options, onChange, label, disabled }: ValueSelectProps<V>) {
  const list = options.some((o) => o.value === value) ? options : [...options, { value, label: String(value) }];
  return (
    <span className="cc-valsel">
      <select
        aria-label={label}
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const o = list.find((x) => String(x.value) === e.target.value);
          if (o) onChange(o.value);
        }}
      >
        {list.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="down" size={14} />
    </span>
  );
}
