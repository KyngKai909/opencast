// The counter's keypad (biz-settings 05.1): the keys the frame draws, A B C and 1 to 9, as quick
// keys for the code field. The field itself takes any letter or number from the phone's keyboard
// (the drawn keypad can't type most codes: open question), and Backspace.

import "./CodeKeypad.css";

const KEYS = ["A", "B", "C", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function CodeKeypad({ onKey, disabled }: { onKey: (k: string) => void; disabled?: boolean }) {
  return (
    <div className="bz-keypad" role="group" aria-label="Keypad">
      {KEYS.map((k) => (
        <button key={k} type="button" className="bz-keypad__key" onClick={() => onKey(k)} disabled={disabled}>
          {k}
        </button>
      ))}
    </div>
  );
}
