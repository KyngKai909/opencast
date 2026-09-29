// The phone remote (tv 06.3; tv-update 02.2 while mirroring): `/remote`, while this phone casts to a
// TV or mirrors to one. The now strip, rockers and neighbours follow the receiver's state, not the
// phone's player. `?sheet=keypad` is the keypad (06.4); `?state=mirroring_stopped` is "Mirroring
// stopped" (02.3) after a lock; `?tv=<name>` starts casting to that TV (a link, and dev:mock).
// `/remote/mirror-guide?tv=<name>` is the one-time mirroring guide (02.1).

import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button, clock } from "@opencast/ui";
import { getMirroring, batteryLine } from "../cast/mirroring";
import { changedByOther } from "../cast/messages";
import { receiverOf, sendToTv, startCast, stopCasting, useCastSession } from "../cast/session";
import { TARGET_KINDS } from "../cast/targets";
import type { RemoteCommand } from "../cast/types";
import { findTargets, hideMirrorGuide, useCastIntro } from "../cast/useCast";
import { useChannels, useLastChannelId, useMarketSlug, usePresets, useViewerActions } from "../data/viewer";
import { useIsPhone, useShellOptions } from "../layout/shell";
import { MARKET_TZ, useNow } from "../../lib/clock";
import { useNowPlaying } from "../player/PlayerRoot";
import { Keypad } from "../components/remote/Keypad";
import { MirrorGuideSheet, MirrorStoppedSheet, PictureBehind } from "../components/remote/Mirroring";
import { NowStrip, RemoteButtons, RemotePresets, RemoteTop, Rockers } from "../components/remote/RemoteParts";
import { presetStrip, rockerNeighbours } from "../components/remote/logic";
import { mirrorGuideHref } from "../components/remote/WatchOnSheet";
import { useOverlayParams } from "../components/watch/overlay";
import { stationSlug } from "../components/watch/logic";
import { inChannelOrder } from "@opencast/player";
import "../components/remote/remote.css";

const BARE = { tabs: false, player: false, padded: false } as const;

export default function RemotePage() {
  const { params } = useOverlayParams();
  if (params.get("state") === "mirroring_stopped") return <MirroringStopped />;
  return <Remote />;
}

function Remote() {
  const phone = useIsPhone();
  useShellOptions(phone ? { ...BARE, top: <RemoteTop /> } : BARE);
  const { params, open, close } = useOverlayParams();
  const session = useCastSession();
  const channels = useChannels();
  const navigate = useNavigate();
  const now = useNow(15_000);
  const { presets } = usePresets();
  const actions = useViewerActions();
  const np = useNowPlaying();
  const slug = useMarketSlug();

  useConnectFromLink();

  const receiver = receiverOf(session);
  const row = channels.find((c) => c.station.id === receiver?.stationId) ?? null;
  const { up, down } = rockerNeighbours(channels, row?.station.id ?? null);
  const paused = receiver?.paused ?? false;
  const other = session.status === "casting" ? changedByOther(receiver, session.me) : null;
  const mirroring = session.status === "mirroring";
  const battery = useMirrorBattery(mirroring);
  const litAtOpen = useRef(!!row?.onAir && !paused);

  const send = (c: RemoteCommand) => sendToTv(c);
  const keypad = params.get("sheet") === "keypad";

  if (session.status === "idle" || session.status === "mirror_stopped") {
    const choose = np.row ?? inChannelOrder(channels)[0] ?? null;
    return (
      <div className="vw-rm">
        {!phone && <RemoteTop />}
        <div className="vw-rm-empty">
          <h1>Not casting</h1>
          <p>{session.status === "idle" && session.error ? session.error : "Choose a TV with the cast button on the tuned-in page."}</p>
          {choose && (
            <Button variant="primary" onClick={() => navigate(`/watch/${stationSlug(choose.station)}?sheet=watch-on`)}>
              Choose a TV
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (keypad)
    return (
      <div className="vw-rm">
        {!phone && <RemoteTop />}
        <Keypad
          channels={channels}
          onTune={(channel) => {
            send({ type: "tune", channel });
            close(["sheet"]);
          }}
          onDone={() => close(["sheet"])}
        />
      </div>
    );

  return (
    <div className="vw-rm">
      {!phone && <RemoteTop />}
      {row ? <NowStrip row={row} paused={paused} now={now} flicker={!litAtOpen.current} /> : <div className="vw-rm-quiet" aria-busy="true" aria-label="Waiting for the TV" />}
      {other && <p className="vw-rm-changed" role="status">{`${other} changed the channel.`}</p>}
      <Rockers row={row} up={up} down={down} paused={paused} onCommand={send} />
      <RemoteButtons onGuide={() => navigate(slug ? "/guide" : "/")} onInfo={() => send({ type: "info" })} onKeypad={() => open({ sheet: "keypad" })} onLast={() => send({ type: "last" })} />
      {mirroring ? (
        <div className="vw-rm-warn" role="note">
          <span className="vw-rm-warn__dot" aria-hidden="true">
            ●
          </span>
          <div>
            <b>Keep this screen open.</b> Locking your phone stops the TV picture.{battery ? ` ${battery}` : ""}
          </div>
        </div>
      ) : (
        <>
          <RemotePresets
            keys={presetStrip(presets)}
            playingId={row?.station.id ?? null}
            // The receiver has no account, so the phone resolves the key and tunes the TV to it.
            onTune={(k) => k.preset?.station.channel && send({ type: "tune", channel: k.preset.station.channel })}
            onSave={(key) => row && actions.savePreset(row.station, { key })}
          />
          <p className="vw-rm-foot">Volume buttons on the phone control the TV.</p>
        </>
      )}
    </div>
  );
}

/** `?tv=<name>`: start casting to that TV (a Chromecast the sender can reach by name), or its mirroring guide. */
function useConnectFromLink() {
  const { params, close } = useOverlayParams();
  const session = useCastSession();
  const intro = useCastIntro();
  const channels = useChannels();
  const lastId = useLastChannelId();
  const np = useNowPlaying();
  const navigate = useNavigate();
  const tv = params.get("tv");
  const tried = useRef<string | null>(null);
  useEffect(() => {
    if (!tv || !channels.length || tried.current === tv) return;
    tried.current = tv;
    if (session.status !== "idle" && session.status !== "mirror_stopped") return close(["tv"]);
    void findTargets().then((targets) => {
      const t = targets.find((x) => !x.picker && x.name.toLowerCase() === tv.toLowerCase());
      close(["tv"]);
      if (!t) return;
      if (TARGET_KINDS[t.kind].action === "mirror") return navigate(mirrorGuideHref(t.name), { replace: true });
      // What the phone has on, or its last channel, or the first on the dial.
      const start = np.row ?? channels.find((c) => c.station.id === lastId) ?? inChannelOrder(channels)[0];
      void startCast(t, intro, start?.station.channel ? { stationId: start.station.id, channel: start.station.channel } : null);
    });
  }, [tv, channels, lastId, session.status, intro, np.row, close, navigate]);
}

/** The battery line while mirroring, from the plugin's readings. */
function useMirrorBattery(on: boolean): string | null {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return setLine(null);
    let off = () => {};
    let gone = false;
    void getMirroring().then((m) => {
      if (!m || gone) return;
      const read = () => setLine(batteryLine(m.battery()));
      read();
      off = m.subscribe(read);
    });
    return () => {
      gone = true;
      off();
    };
  }, [on]);
  return line;
}

/** 02.3: the phone locked and the TV stopped showing Opencast. Restarting mirroring goes back to the remote by itself. */
function MirroringStopped() {
  useShellOptions({ ...BARE, top: null });
  const session = useCastSession();
  const navigate = useNavigate();
  const np = useNowPlaying();
  // Mirroring started again (or there's nothing to say): the remote.
  useEffect(() => {
    if (session.status !== "mirror_stopped") navigate("/remote", { replace: true });
  }, [session.status, navigate]);
  if (session.status !== "mirror_stopped") return null;
  const station = np.row?.station.callSign && np.row.station.channel ? { callSign: np.row.station.callSign, channel: np.row.station.channel } : null;
  const watchHere = () => {
    stopCasting();
    navigate(np.row ? `/watch/${stationSlug(np.row.station)}` : "/", { replace: true });
  };
  return (
    <>
      <PictureBehind />
      <MirrorStoppedSheet tvName={session.target.name} lockedAt={clock(session.lockedAt, { timeZone: MARKET_TZ, suffix: false })} station={station} onWatchHere={watchHere} onClose={watchHere} />
    </>
  );
}

/** 02.1: the one-time guide to turning on Screen Mirroring. When the TV connects, the phone switches to the remote by itself. */
export function MirrorGuidePage() {
  useShellOptions({ ...BARE, top: null });
  const [params] = useSearchParams();
  const tv = params.get("tv")?.slice(0, 60) || "the TV";
  const navigate = useNavigate();
  const np = useNowPlaying();
  const session = useCastSession();

  useEffect(() => {
    void getMirroring().then((m) => m?.expect(tv));
  }, [tv]);
  // Once it has worked, the guide has done its job: it isn't shown again unless asked for.
  useEffect(() => {
    if (session.status === "mirroring") hideMirrorGuide();
  }, [session.status]);

  const back = () => navigate(np.row ? `/watch/${stationSlug(np.row.station)}` : "/", { replace: true });
  return (
    <>
      <PictureBehind />
      <MirrorGuideSheet
        tvName={tv}
        onClose={back}
        onHide={() => {
          hideMirrorGuide();
          back();
        }}
      />
    </>
  );
}
