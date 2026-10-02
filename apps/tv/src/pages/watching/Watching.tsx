// tv 02.1 watching (the banner and number entry are the player's), 05.1 radio (the player's
// RadioScreen), 05.2 off air and stand by, the reminder card at the start time, the sleep fade
// (the player's notice; OK takes its "30 more minutes"); while casting and mirroring the hint row
// is the adapter's chip (06.1, update 01.1). Route "/".
//
// What this page adds over the picture takes the remote first (useCommandLayer): the reminder
// card takes OK and Back; off air and stand by take the arrows (◀ ▶ between the buttons, ▲ ▼
// still change channel) and OK; everything else falls through to the player.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi, stationsApi, type Reminder } from "@opencast/contracts";
import { usePlayer, type Command, type CommandSource } from "@opencast/player";
import { DialX } from "../../api/ext";
import { useApi } from "../../api/hooks";
import { AirScreen } from "../../components/watching/AirScreen";
import { bandsInMemory, useRememberBand } from "../../components/watching/bands";
import { recordFirstUse } from "../../components/watching/hintRow";
import { airState, suggestion, type Row } from "../../components/watching/offAir";
import { ReminderCard } from "../../components/watching/ReminderCard";
import { cardText, reminderCard, switchDue } from "../../components/watching/reminders";
import { Stopped } from "../../components/watching/Stopped";
import { watchCommand } from "../../components/watching/watchCommands";
import { useSavePreset } from "../../components/watching/useSavePreset";
import { useNow } from "../../lib/clock";
import { isAndroidApp, OpencastTv } from "../../native/plugin";
import { useCommandLayer } from "../../tv/commands";
import { useMarketSlug, useSignedIn } from "../../tv/data";
import { getDevice } from "../../tv/device";
import { moveFocus, pressFocused } from "../../tv/focus";
import { useTvMode } from "../../tv/TvApp";

/** Reminders waved away or acted on, for this run of the app. */
const handled = new Set<string>();

export default function Watching() {
  const mode = useTvMode();
  // The Android TV and Fire TV app: Back with nothing to go back to leaves for the TV's home.
  const nativeApp = mode === "tv" && isAndroidApp();
  const [s, engine] = usePlayer();
  const navigate = useNavigate();
  const now = useNow(1000);
  const signedIn = useSignedIn();
  const { save } = useSavePreset();
  const qc = useQueryClient();

  const current = s.channels.find((c) => c.station.id === s.currentId);
  useRememberBand(current);
  useEffect(() => {
    if (mode === "tv") recordFirstUse(Date.now());
    else bandsInMemory();
  }, [mode]);

  // Stand by (S13) comes with the dial's rows; the player's own copy of the dial doesn't carry it.
  const slug = useMarketSlug();
  const band = current?.station.band === "radio" ? "radio" : "tv";
  const dial = useApi(stationsApi.getDial, { params: { marketSlug: slug }, query: { band } }, { schema: DialX, refetchInterval: 60_000 });
  const rows: Row[] = useMemo(() => {
    const signal = new Map((dial.data?.rows ?? []).map((r) => [r.station.id, r.signal]));
    return s.channels.map((c) => ({ ...c, signal: signal.get(c.station.id) }));
  }, [s.channels, dial.data]);
  const row = rows.find((r) => r.station.id === s.currentId);
  const air = s.status === "stopped" ? null : airState(row, s.status);
  // Not while a channel change is drawn: its static (the corner number, "Tuning in") shows over
  // off air and Stand by too, and the next station's screen, if it has one, comes after it.
  const showAir = !!air && !!row && !s.entry && !s.tuning;
  const suggest = useMemo(() => (air ? suggestion(rows, s.currentId) : null), [air, rows, s.currentId]);

  // Reminders reach a signed-in TV app (a Cast receiver has no account).
  const reminders = useApi(accountsApi.listReminders, {}, { enabled: signedIn && mode === "tv", refetchInterval: 60_000 });
  const [, setTick] = useState(0);
  const list: Reminder[] = reminders.data ?? [];
  const onDial = (r: Reminder) => s.channels.some((c) => c.station.id === r.airing.station.id);
  const card = reminderCard(list.filter(onDial), now.getTime(), s.currentId, handled);
  const due = switchDue(list.filter(onDial), now.getTime(), handled);
  const wave = (r: Reminder) => {
    handled.add(r.id);
    setTick((t) => t + 1);
  };
  // Switch me over: the TV tunes by itself at the start.
  useEffect(() => {
    if (!due) return;
    handled.add(due.id);
    if (due.airing.station.id !== s.currentId) void engine.tune(due.airing.station.id, { input: "app" });
    // The program changes now: read the dial again so the banner says what's starting.
    void qc.invalidateQueries({ queryKey: [stationsApi.getDial.method, stationsApi.getDial.path] });
    setTick((t) => t + 1);
  }, [due, engine, s.currentId, qc]);

  useCommandLayer(
    (c: Command, source?: CommandSource) => {
      const act = watchCommand(c, {
        fading: !!s.sleep?.fading,
        stopped: s.status === "stopped",
        tvApp: mode === "tv",
        card: !!card,
        typing: !!s.entry,
        airShown: showAir,
        currentId: s.currentId,
        flip: source?.input === "remote" && getDevice().settings.channelUp === "down_the_dial",
        exitable: nativeApp && source?.input === "remote" && !engine.getState().lastId
      });
      if (!act) return false;
      switch (act.do) {
        case "moreTime":
          engine.sleep(30);
          break;
        case "exit":
          void OpencastTv.exitToHome();
          break;
        case "restart":
          window.location.reload();
          break;
        case "switch":
          if (card) {
            wave(card);
            void engine.tune(card.airing.station.id, source);
          }
          break;
        case "wave":
          if (card) wave(card);
          break;
        case "savePreset":
          // A phone's "+" key while casting: save what's on to that key.
          if (s.currentId) void save(act.key, s.currentId).catch(() => {});
          break;
        case "channel":
          engine.handle({ type: "channel", dir: act.dir }, source);
          break;
        case "focus":
          moveFocus(act.dir);
          break;
        case "press":
          pressFocused();
          break;
      }
      return true;
    },
    { active: nativeApp || !!s.sleep?.fading || s.status === "stopped" || !!card || showAir || !!s.currentId, keys: showAir ? "overlay" : undefined }
  );

  if (s.status === "stopped") return mode === "tv" ? <Stopped /> : null;
  return (
    <>
      {showAir && row && air && <AirScreen kind={air} row={row} suggest={suggest} now={now} onTune={(id) => void engine.tune(id, { input: "remote" })} onGuide={() => navigate("/guide")} />}
      {card && !s.entry && <ReminderCard text={cardText(card)} />}
    </>
  );
}
