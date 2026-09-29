// A station colour: five station colours to pick from, or any #rrggbb, with the contrast line.
// A colour that can't carry white text at 4.5:1 can't be saved, and the line says why (rules,
// station colours; master-control A.1; station-settings 01.1).

import { useEffect, useId, useRef, useState } from "react";
import { contrastRatio, Icon, ratioLabel, stationColourPasses } from "@opencast/ui";
import "./ColourPicker.css";

/** The station colours the frames offer (station-settings 01.1). */
export const SWATCHES = ["#2E6B5A", "#8C3B7A", "#9A5412", "#1F5E8C", "#7E2F35"];

const HEX = /^#[0-9a-f]{6}$/i;

/** What the line under the colour says, and whether it can be saved. */
export function colourCheck(hex: string): { ok: boolean; line: string } {
  if (!HEX.test(hex)) return { ok: false, line: "Enter a colour as # and six characters, like #8C3B7A." };
  const ratio = ratioLabel(contrastRatio(hex, "#FFFFFF"));
  if (stationColourPasses(hex)) return { ok: true, line: `White text reads at ${ratio}` };
  return { ok: false, line: `White text reads at ${ratio}. Station colours need 4.5:1, so this one can't be saved.` };
}

export interface ColourPickerProps {
  value: string;
  /** Called with a colour that passes, ready to save. */
  onChange: (hex: string) => void;
  disabled?: boolean;
}

export function ColourPicker({ value, onChange, disabled }: ColourPickerProps) {
  const id = useId();
  const [text, setText] = useState(value.toUpperCase());
  const field = useRef<HTMLInputElement>(null);
  // Follow the saved colour, except while someone is typing: each passing colour is saved as it's
  // typed, and a save's answer arriving late would otherwise put back the colour before.
  useEffect(() => {
    if (typeof document !== "undefined" && document.activeElement === field.current) return;
    setText(value.toUpperCase());
  }, [value]);
  const check = colourCheck(text);
  const choose = (hex: string) => {
    setText(hex.toUpperCase());
    if (colourCheck(hex).ok) onChange(hex.toUpperCase());
  };
  return (
    <fieldset className="cc-colour" disabled={disabled}>
      <legend className="cc-colour__legend">Colour</legend>
      <div className="cc-colour__row">
        <div className="cc-colour__swatches" role="radiogroup" aria-label="Station colours">
          {SWATCHES.map((s) => {
            const on = s.toUpperCase() === text.toUpperCase();
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={s}
                className={on ? "cc-colour__sw cc-colour__sw--on" : "cc-colour__sw"}
                style={{ background: s }}
                onClick={() => choose(s)}
              />
            );
          })}
        </div>
        <input
          ref={field}
          id={`${id}-hex`}
          className="cc-colour__hex"
          aria-label="Colour, as a hex code"
          aria-describedby={`${id}-check`}
          aria-invalid={!check.ok || undefined}
          value={text}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => {
            const v = e.target.value.trim();
            const hex = v.startsWith("#") ? v : `#${v}`;
            setText(hex.toUpperCase());
            if (colourCheck(hex).ok) onChange(hex.toUpperCase());
          }}
        />
      </div>
      <div id={`${id}-check`} className={check.ok ? "oc-field__ok" : "oc-field__error"} role={check.ok ? undefined : "alert"}>
        <Icon name={check.ok ? "check" : "warn"} size={15} />
        {check.line}
      </div>
    </fieldset>
  );
}
