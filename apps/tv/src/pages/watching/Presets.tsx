// tv 04.2 the presets strip ("/presets"), up from the bottom with ◀. Six keys, what's on on each;
// OK tunes (and the strip closes, so the banner shows), 1 to 6 tune from the strip; an empty key
// offers "+ Save this channel"; holding OK on a full key replaces it with the channel on now.
// Signed in, the account's keys (accounts.savePreset); signed out, this TV's.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { cx } from "@opencast/ui";
import { usePlayer, type Command, type CommandSource } from "@opencast/player";
import { useRememberBand } from "../../components/watching/bands";
import { firstKey, nowLine, okAction, sixSlots, stripCommand, type Slot } from "../../components/watching/presetStrip";
import { useSavePreset } from "../../components/watching/useSavePreset";
import { useCommandLayer } from "../../tv/commands";
import { usePresets } from "../../tv/data";
import { FocusContext, focusKey, useTvFocusable } from "../../tv/focus";
import { useQuietPicture } from "../../components/watching/useQuietPicture";
import "./Presets.css";

function Key({ slot, onOk, onFocus }: { slot: Slot; onOk: (slot: Slot) => void; onFocus: (key: number) => void }) {
  const { ref, focused } = useTvFocusable({ focusKey: `tvw-pt-${slot.key}`, onSelect: () => onOk(slot), onFocus: () => onFocus(slot.key) });
  const s = slot.row?.station;
  const line = nowLine(slot.row);
  return (
    <div ref={ref} role="button" tabIndex={-1} className={cx("tvw-pt", !slot.stationId && "tvw-pt--empty", focused && "tv-focus")} onClick={() => onOk(slot)} aria-keyshortcuts={String(slot.key)}>
      <span className="tvw-pt__k">{slot.key}</span>
      {slot.stationId ? (
        <>
          <span className="tvw-pt__ch">{s?.channel ?? ""}</span>
          <span className="tvw-pt__cs oc-cs">{s?.callSign ?? s?.name ?? ""}</span>
          {line && (
            <small>
              {line.live && <span className="tvw-pt__live">Live</span>}
              {line.live && " "}
              {line.text}
            </small>
          )}
        </>
      ) : (
        <>
          <span className="tvw-pt__ch">+</span>
          <span className="tvw-pt__save">Save this channel</span>
        </>
      )}
    </div>
  );
}

export default function Presets() {
  const navigate = useNavigate();
  useQuietPicture();
  const [s, engine] = usePlayer();
  const { presets } = usePresets();
  const { save, used } = useSavePreset();
  const [error, setError] = useState<string | null>(null);
  const current = s.channels.find((c) => c.station.id === s.currentId);
  useRememberBand(current);
  const slots = useMemo(() => sixSlots(presets), [presets]);

  const strip = useTvFocusable({ focusKey: "tvw-presets", trackChildren: true, isFocusBoundary: true });
  // Opens on the key of the channel on now, or key 1.
  const start = firstKey(slots, s.currentId);
  const focused = useRef(start);
  useEffect(() => focusKey(`tvw-pt-${start}`), []); // eslint-disable-line react-hooks/exhaustive-deps

  const tune = (slot: Slot, source?: CommandSource) => {
    if (!slot.stationId) return;
    used(slot.key);
    void engine.tune(slot.stationId, source ?? { input: "remote" });
    navigate("/", { replace: true });
  };
  const store = (slot: Slot) => {
    if (!s.currentId) return;
    setError(null);
    save(slot.key, s.currentId).catch((e: Error) => setError(e.message));
  };
  const ok = (slot: Slot, hold = false) => {
    const act = okAction(slot, hold, s.currentId);
    if (act === "tune") tune(slot);
    else if (act === "save") store(slot);
  };

  useCommandLayer((c: Command, source?: CommandSource) => {
    const act = stripCommand(c, slots, focused.current, s.currentId);
    if (!act) return false;
    const slot = act.do === "nothing" ? null : slots[act.key - 1];
    if (slot && act.do === "tune") tune(slot, source);
    if (slot && act.do === "save") store(slot);
    return true;
  });

  return (
    <div className="tvw-pstrip" role="dialog" aria-label="Presets">
      <h4>
        Presets <span>OK to tune, or press 1 to 6</span>
      </h4>
      <FocusContext.Provider value={strip.focusKey}>
        <div ref={strip.ref} className="tvw-pgrid">
          {slots.map((slot) => (
            <Key key={slot.key} slot={slot} onOk={(x) => ok(x)} onFocus={(k) => (focused.current = k)} />
          ))}
        </div>
      </FocusContext.Provider>
      {error && <p className="tvw-pstrip__error" role="alert">{error}</p>}
    </div>
  );
}
