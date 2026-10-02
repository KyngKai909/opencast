// "Watch on" (tv 06.2): the cast button's sheet over the tuned-in page, `?sheet=watch-on`. The TVs
// on the Wi-Fi and the account's TVs with the Opencast app, each going the way that works best there
// (the target-kind table in cast/targets.ts), "This phone", a word that the installed TV app beats
// casting, and "Use a code from the TV" to pair with a TV app this phone can't reach otherwise.
// In Safari, while an AirPlay TV is around, "AirPlay" opens Safari's own list of TVs: the stream
// plays there by itself (PlayerEngine.showAirPlayPicker), with no remote.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button, ChoiceList, Icon, Sheet, useToast } from "@opencast/ui";
import { usePlayer } from "@opencast/player";
import { getMirroring } from "../../cast/mirroring";
import { clearCastError, startCast, stopCasting, useCastSession } from "../../cast/session";
import { TARGET_KINDS, offlineLine, primaryLabel, targetLine, type Choice } from "../../cast/targets";
import type { CastTarget } from "../../cast/types";
import { mirrorGuideHidden, useCastIntro, useWatchOnTargets } from "../../cast/useCast";
import { useOverlayParams } from "../watch/overlay";
import { PairTvSheet } from "./PairTv";
import "./WatchOnSheet.css";

const PHONE = "this-phone";
const AIRPLAY = "airplay-picker";

export function mirrorGuideHref(tvName: string): string {
  return `/remote/mirror-guide?tv=${encodeURIComponent(tvName)}`;
}

export function WatchOnSheet() {
  const { params, close } = useOverlayParams();
  const open = params.get("sheet") === "watch-on";
  if (!open) return null;
  return <WatchOn onClose={() => close(["sheet"])} />;
}

function WatchOn({ onClose }: { onClose: () => void }) {
  const session = useCastSession();
  const { targets, loading, refresh } = useWatchOnTargets(true);
  const [pairing, setPairing] = useState(false);
  const [offline, setOffline] = useState<string | null>(null);
  const intro = useCastIntro();
  const [s, engine] = usePlayer();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const current: CastTarget | null = session.status === "casting" || session.status === "mirroring" || session.status === "connecting" ? session.target : null;
  const driving = current !== null;
  // A TV that's playing is listed even when discovery doesn't return it (Chrome's picker names it only once connected).
  const rows = useMemo(() => (current && !targets.some((t) => t.id === current.id) ? [current, ...targets] : targets), [current, targets]);

  const [chosen, setChosen] = useState<string | null>(null);
  const airPlay = s.airPlay.available || s.airPlay.active;
  const value = chosen ?? current?.id ?? (s.airPlay.active ? AIRPLAY : null) ?? rows[0]?.id ?? (loading ? null : PHONE);
  const choice: Choice | null = value === PHONE ? { kind: "phone" } : value === AIRPLAY ? { kind: "airplay", active: s.airPlay.active } : (() => {
    const t = rows.find((r) => r.id === value);
    return t ? { kind: "tv", target: t } : null;
  })();
  const label = primaryLabel(choice, current);
  const error = session.status === "idle" ? session.error : null;
  useEffect(() => () => clearCastError(), []);

  const playing = s.channels.find((c) => c.station.id === (s.pendingId ?? s.currentId));
  const startFrom = playing?.station.channel ? { stationId: playing.station.id, channel: playing.station.channel } : null;
  const chosenOffline = choice?.kind === "tv" && choice.target.online === false;

  const connect = async (t: CastTarget) => {
    setBusy(true);
    const ok = await startCast(t, intro, startFrom);
    setBusy(false);
    if (ok) navigate("/remote", { replace: true });
  };

  const go = async () => {
    if (!choice) return;
    // Before anything waits: Safari opens its AirPlay list only straight from the tap.
    if (choice.kind === "airplay") {
      if (choice.active) engine.stopAirPlay();
      else {
        if (driving) stopCasting();
        engine.showAirPlayPicker();
      }
      return onClose();
    }
    if (choice.kind === "phone") {
      if (driving) stopCasting();
      if (s.airPlay.active) engine.stopAirPlay();
      return onClose();
    }
    const t = choice.target;
    if (current && current.id === t.id) return navigate("/remote", { replace: true });
    const action = TARGET_KINDS[t.kind].action;
    if (action === "mirror") {
      if (!mirrorGuideHidden()) return navigate(mirrorGuideHref(t.name), { replace: true });
      // Hidden for good: the phone notices mirroring by itself and switches to the remote.
      void getMirroring().then((m) => m?.expect(t.name));
      toast.show({ message: `Turn on Screen Mirroring and choose ${t.name}.` });
      return onClose();
    }
    if (t.online === false) {
      // It may have come on since the list loaded: ask the account again before saying it isn't.
      setBusy(true);
      const now = (await refresh()).find((x) => x.id === t.id);
      setBusy(false);
      if (!now || now.online === false) return setOffline(offlineLine(t.name));
      return connect(now);
    }
    await connect(t);
  };

  if (pairing)
    return (
      <PairTvSheet
        phoneName={intro.from}
        onBack={() => setPairing(false)}
        onClose={onClose}
        onPaired={async (p) => {
          await connect({ id: p.tvId, name: p.tvName, kind: "tv_app", paired: true });
          // Didn't connect: back to the list, which says why (and has the TV now).
          setPairing(false);
        }}
      />
    );

  const options = [
    ...rows.map((t) => ({
      value: t.id,
      title: t.name,
      helper: targetLine(t),
      end: (
        <span className="vw-wo__ic">
          <Icon name={TARGET_KINDS[t.kind].icon} />
        </span>
      )
    })),
    ...(airPlay
      ? [
          {
            value: AIRPLAY,
            title: "AirPlay",
            helper: s.airPlay.active ? "Playing on AirPlay" : "Apple TV and AirPlay TVs",
            end: (
              <span className="vw-wo__ic">
                <Icon name="tv" />
              </span>
            )
          }
        ]
      : []),
    {
      value: PHONE,
      title: "This phone",
      helper: driving ? "Stop casting" : s.airPlay.active ? "Stop AirPlay" : "Playing here",
      end: (
        <span className="vw-wo__ic">
          <Icon name="phone" />
        </span>
      )
    }
  ];

  return (
    <Sheet
      open
      onClose={onClose}
      title="Watch on"
      subtitle="TVs on this Wi-Fi"
      className="vw-wo"
      footer={
        label ? (
          <Button variant="primary" block onClick={() => void go()} disabled={busy || session.status === "connecting"}>
            {session.status === "connecting" ? `Connecting to ${session.target.name}` : label}
          </Button>
        ) : undefined
      }
    >
      {loading && !rows.length ? (
        <div className="vw-wo__quiet" aria-busy="true" aria-label="Looking for TVs">
          <i />
          <i />
        </div>
      ) : (
        <>
          {!rows.length && !airPlay && <p className="vw-wo__none">No TVs found on this Wi-Fi.</p>}
          <ChoiceList
            label="Watch on"
            options={options}
            value={value}
            onChange={(v) => {
              setChosen(v);
              setOffline(null);
            }}
            className="vw-wo__list"
          />
        </>
      )}
      {(error || offline) && (
        <p className="vw-wo__error" role="alert">
          {error ?? offline}
        </p>
      )}
      {chosenOffline && !offline && !error && <p className="vw-wo__note">{offlineLine(choice.target.name)}</p>}
      <p className="vw-wo__note">Got Opencast installed on the TV? It's faster than casting and has its own remote controls.</p>
      <Button variant="text" size="sm" className="vw-wo__how" onClick={() => setPairing(true)}>
        Use a code from the TV
      </Button>
      {choice?.kind === "tv" && TARGET_KINDS[choice.target.kind].action === "mirror" && mirrorGuideHidden() && (
        <Button variant="text" size="sm" className="vw-wo__how" onClick={() => navigate(mirrorGuideHref(choice.target.name), { replace: true })}>
          How to turn on Screen Mirroring
        </Button>
      )}
    </Sheet>
  );
}
