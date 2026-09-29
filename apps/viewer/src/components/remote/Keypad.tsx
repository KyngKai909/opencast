// The remote's keypad (tv 06.4), `/remote?sheet=keypad`: digits and the dot, the number in mono with
// ".1" filled in, the station it resolves to and a countdown ("Tuning in 1 second"), Tune to go at
// once. The phone resolves the digits itself and sends the TV `{type:"tune", channel}`. Drawn as the
// whole screen under the remote's top bar, which says Done.

import { useEffect, useMemo, useState } from "react";
import type { DialRowX } from "../../api/ext";
import { KEYPAD_WAIT_S, keypadChannel, keypadEntry, keypadLine, pressKey, type KeypadKey } from "./logic";
import "./Keypad.css";

const KEYS: KeypadKey[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, ".", 0];

export function Keypad({ channels, onTune, onDone }: { channels: DialRowX[]; onTune: (channel: string) => void; onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const [left, setLeft] = useState<number | null>(null);
  const entry = useMemo(() => keypadEntry(typed, channels), [typed, channels]);
  const channel = keypadChannel(entry);

  // A number that resolves counts down, then tunes; another key starts the count again.
  useEffect(() => {
    if (!channel) return setLeft(null);
    setLeft(KEYPAD_WAIT_S);
    const started = Date.now();
    const i = setInterval(() => {
      const remaining = KEYPAD_WAIT_S - Math.floor((Date.now() - started) / 1000);
      if (remaining <= 0) {
        clearInterval(i);
        setLeft(0);
        onTune(channel);
      } else setLeft(remaining);
    }, 200);
    return () => clearInterval(i);
    // The count restarts when the number changes, not when the parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, channel]);

  // Typing on a keyboard works too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.altKey || e.ctrlKey || e.metaKey || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (/^[0-9]$/.test(e.key)) setTyped((t) => pressKey(t, Number(e.key)));
      else if (e.key === ".") setTyped((t) => pressKey(t, "."));
      else if (e.key === "Backspace") setTyped((t) => pressKey(t, "back"));
      else if (e.key === "Enter" && channel) onTune(channel);
      else if (e.key === "Escape") onDone();
      else return;
      e.preventDefault();
    };
    // Capture, so the app's "1 to 6 tune presets" doesn't also take the digits.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [channel, onTune, onDone]);

  const line = keypadLine(entry, left);
  return (
    <div className="vw-kp">
      <div className="vw-kp__disp" role="status" aria-live="polite">
        <div className="vw-kp__d" aria-label={typed ? `Channel ${channel ?? typed}` : "Type a channel"}>
          {entry ? (
            <>
              {entry.shown.typed}
              {entry.shown.filled && <em>{entry.shown.filled}</em>}
            </>
          ) : (
            "\u00a0"
          )}
        </div>
        <small>
          {line ? (
            <>
              <b>{line.lead}</b>
              {line.rest}
            </>
          ) : (
            " "
          )}
        </small>
      </div>
      <div className="vw-kp__keys" role="group" aria-label="Keypad">
        {KEYS.map((k) => (
          <button key={String(k)} type="button" aria-label={k === "." ? "Dot" : String(k)} onClick={() => setTyped((t) => pressKey(t, k))}>
            {k}
          </button>
        ))}
        <button type="button" className="vw-kp__go" disabled={!channel} onClick={() => channel && onTune(channel)}>
          Tune
        </button>
      </div>
      <p className="vw-kp__foot">Radio frequencies work too: 8, 8, 3 tunes 88.3.</p>
    </div>
  );
}
