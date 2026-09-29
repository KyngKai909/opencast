// Keeps the phone and the TV in step while a session runs, from every page of the app:
//  - casting: the phone's player follows what the TV shows, and a station chosen on the phone (its
//    guide, a preset, the lock screen) is sent to the TV, so "choosing tunes the TV";
//  - the phone's own sound is off while a TV plays;
//  - mirroring: when the external display connects the phone switches to the remote by itself,
//    and after a lock it shows "Mirroring stopped" (tv-update 02); the screen is kept awake;
//  - dev:mock mirroring: the phone's player stands in for TV mode on the external display.

import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { usePlayer, type Command } from "@opencast/player";
import { getMirroring } from "./mirroring";
import { applyMirrorStatus, getCastSession, sendToTv, setMirrorReceiver, useCastSession } from "./session";
import type { RemoteCommand } from "./types";

/** A remote command as the stand-in player takes it. */
export function asPlayerCommand(c: RemoteCommand): Command {
  return c;
}

export function CastSync() {
  const [s, engine] = usePlayer();
  const session = useCastSession();
  const navigate = useNavigate();
  const loc = useLocation();
  const path = useRef(loc.pathname);
  path.current = loc.pathname;

  const casting = session.status === "casting";
  const tvId = casting ? session.receiver?.stationId ?? null : null;
  const phoneId = s.pendingId ?? s.currentId;
  const phoneIdRef = useRef(phoneId);
  phoneIdRef.current = phoneId;

  // The TV changed (this phone's remote, or another phone): the phone's player follows.
  useEffect(() => {
    if (!casting || !tvId || tvId === phoneIdRef.current) return;
    void engine.tune(tvId, { input: "cast" });
  }, [casting, tvId, engine]);

  // The phone changed station itself (its guide, a preset, the lock screen): the TV follows.
  useEffect(() => {
    const cur = getCastSession();
    if (cur.status !== "casting" || !cur.receiver?.stationId || !phoneId || phoneId === cur.receiver.stationId) return;
    const channel = engine.getState().channels.find((c) => c.station.id === phoneId)?.station.channel;
    if (channel) sendToTv({ type: "tune", channel });
  }, [phoneId, engine]);

  // The phone's own sound is off while the TV plays; it comes back when the session ends.
  const drivingTv = session.status !== "idle";
  const mutedByUs = useRef(false);
  useEffect(() => {
    if (drivingTv && !engine.getState().muted) {
      engine.setMuted(true);
      mutedByUs.current = true;
    } else if (!drivingTv && mutedByUs.current) {
      mutedByUs.current = false;
      engine.setMuted(false);
    }
  }, [drivingTv, engine]);

  // Mirroring: the seam's status becomes the session; connecting opens the remote, a lock opens "Mirroring stopped".
  useEffect(() => {
    let off = () => {};
    let gone = false;
    void getMirroring().then((m) => {
      if (!m || gone) return;
      const onChange = () => {
        const before = getCastSession().status;
        applyMirrorStatus(m.status());
        const after = getCastSession().status;
        m.keepAwake(after === "mirroring");
        // From the guide or "Mirroring stopped", the remote takes their place in history.
        const onRemote = path.current.startsWith("/remote");
        if (after === "mirroring" && before !== "mirroring") navigate("/remote", { replace: onRemote });
        if (after === "mirror_stopped" && before !== "mirror_stopped") navigate("/remote?state=mirroring_stopped", { replace: onRemote });
      };
      const offStatus = m.subscribe(onChange);
      // dev:mock: the phone's player takes the commands meant for TV mode on the external display.
      const offCommands = m.onCommand?.((c) => engine.handle(asPlayerCommand(c), { input: "bridge" })) ?? (() => {});
      off = () => (offStatus(), offCommands());
      onChange();
    });
    return () => {
      gone = true;
      off();
    };
  }, [engine, navigate]);

  // dev:mock mirroring: the stand-in's state is the TV's.
  const mirroring = session.status === "mirroring";
  useEffect(() => {
    if (!mirroring) return;
    void getMirroring().then((m) => {
      if (m?.kind !== "mock") return;
      setMirrorReceiver({ stationId: s.currentId, paused: s.status === "paused", changedBy: null, sleepEndsAt: s.sleep?.endsAt ?? null });
    });
  }, [mirroring, s.currentId, s.status, s.sleep?.endsAt]);

  return null;
}
