// tv-update 05.1 the sleep timer ("/sleep"), from the menu rail. "It's 11:52 pm", then the choices
// with the clock time each ends: End of this program (the default, focused), 30, 60 and 90 min,
// Off. Choosing sets the player's timer (engine.sleep) and closes; a minute before, the player
// fades the sound with its notice offering 30 more minutes. On a Cast receiver the phones hear
// of it in the state message (sleepEndsAt).

import { useEffect } from "react";
import { useNavigate } from "react-router";
import { clock } from "@opencast/ui";
import { usePlayer } from "@opencast/player";
import { sleepCommand, sleepOptions, type SleepOption } from "../../components/watching/sleep";
import { TvButton } from "../../components/watching/TvButton";
import { MARKET_TZ, useNow } from "../../lib/clock";
import { FocusContext, focusKey, useTvFocusable } from "../../tv/focus";
import { useQuietPicture } from "../../components/watching/useQuietPicture";
import "./Sleep.css";

const keyFor = (o: SleepOption) => `tvw-sleep-${o.choice}`;

export default function Sleep() {
  const navigate = useNavigate();
  useQuietPicture();
  const [s, engine] = usePlayer();
  const now = useNow(5000);
  const current = s.channels.find((c) => c.station.id === s.currentId);
  const options = sleepOptions(now.getTime(), current?.now?.kind === "off_air" ? null : current?.now?.endsAt);
  const box = useTvFocusable({ focusKey: "tvw-sleep", trackChildren: true, isFocusBoundary: true });
  // Opens on the first choice: End of this program when there is one.
  useEffect(() => focusKey(keyFor(options[0]!)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (o: SleepOption) => {
    engine.sleep(sleepCommand(o.choice));
    navigate("/", { replace: true });
  };
  const at = (t: number) => clock(t, { timeZone: MARKET_TZ });

  return (
    <div className="tvw-sleep" role="dialog" aria-labelledby="tvw-sleep-h">
      <span className="tvw-sleep__when oc-mono">
        It's {at(now.getTime())}
        {s.sleep ? `. Turning off at ${at(s.sleep.endsAt)}.` : ""}
      </span>
      <h3 id="tvw-sleep-h">Turn off after</h3>
      <FocusContext.Provider value={box.focusKey}>
        <div ref={box.ref} className="tvw-sleep__opts" data-count={options.length}>
          {options.map((o) => (
            <TvButton key={String(o.choice)} focusKey={keyFor(o)} onSelect={() => choose(o)}>
              {o.label}
              {o.endsAt !== null && <small>{at(o.endsAt)}</small>}
            </TvButton>
          ))}
        </div>
      </FocusContext.Provider>
      <p className="tvw-sleep__foot">A minute before, the sound fades and a notice offers 30 more minutes.</p>
    </div>
  );
}
