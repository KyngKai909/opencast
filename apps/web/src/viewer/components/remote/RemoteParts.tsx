// The phone remote's parts (tv 06.3, tv-update 02.2): the top bar with the TV and Stop, the now
// strip from the receiver's state, the two rockers, Guide / Info / Keypad / Last, and the presets.

import { useRef, type PointerEvent } from "react";
import { useNavigate } from "react-router";
import { Button, Icon, ProgressBar, Tag, Tally } from "@opencast/ui";
import type { DialRowX } from "../../api/ext";
import { stopCasting, useCastSession } from "../../cast/session";
import type { RemoteCommand } from "../../cast/types";
import { useNowPlaying } from "../../player/PlayerRoot";
import { MARKET_TZ } from "../../../lib/clock";
import { useOverlayParams } from "../watch/overlay";
import { stationSlug } from "../watch/logic";
import { identText, type RemotePreset } from "./logic";

/** The remote's top bar: the TV (or "Mirroring to …") and Stop; over the keypad, Done. Reads the session itself (the shell renders it). */
export function RemoteTop() {
  const session = useCastSession();
  const { params, close } = useOverlayParams();
  const navigate = useNavigate();
  const np = useNowPlaying();
  const keypad = params.get("sheet") === "keypad";
  const target = session.status === "idle" ? null : session.target;
  const mirroring = session.status === "mirroring";
  const stop = () => {
    stopCasting();
    // Back to watching on the phone, on the channel the TV had.
    navigate(np.row ? `/watch/${stationSlug(np.row.station)}` : "/", { replace: true });
  };
  return (
    <header className="oc-viewer-phone__top vw-rm-top">
      <p className="vw-rm-top__dev">
        <Icon name={mirroring ? "phone" : "cast"} />
        <span>{target ? (mirroring ? `Mirroring to ${target.name}` : target.name) : "Remote"}</span>
      </p>
      {keypad ? (
        <Button size="sm" onClick={() => close(["sheet"])}>
          Done
        </Button>
      ) : target ? (
        <Button size="sm" onClick={stop}>
          Stop
        </Button>
      ) : null}
    </header>
  );
}

/** What the TV shows: ident, Live, the program and its progress; the tally only when it's on air. */
export function NowStrip({ row, paused, now, flicker }: { row: DialRowX; paused: boolean; now: Date; flicker: boolean }) {
  const airing = row.now;
  // As the TV draws it: a listed city stream plays in the city's own player, which Opencast can't vouch for.
  const lit = row.onAir && !paused && row.playback?.kind !== "embed";
  return (
    <section className="vw-rm-now" aria-label="On the TV">
      <div>
        <div className="vw-rm-now__id">
          <span className="oc-ch">{row.station.channel}</span>
          <span className="oc-cs">{row.station.callSign}</span>
          {airing?.live && <Tag variant="live">Live</Tag>}
          {airing?.kind === "listed" && !airing.live && <Tag variant="listed">Listed</Tag>}
        </div>
        <b className="vw-rm-now__title">{airing?.title ?? (row.onAir ? row.station.name : "Off air")}</b>
        {airing && airing.kind !== "off_air" && <ProgressBar start={airing.startsAt} end={airing.endsAt} now={now} timeZone={MARKET_TZ} showLeft={false} />}
      </div>
      <Tally state={lit ? "lit" : "unlit"} flicker={flicker} />
    </section>
  );
}

/** Channel on the left, play and last on the right, the current channel and its neighbours between them. */
export function Rockers({ row, up, down, paused, onCommand }: { row: DialRowX | null; up: DialRowX | null; down: DialRowX | null; paused: boolean; onCommand: (c: RemoteCommand) => void }) {
  return (
    <div className="vw-rm-rocker">
      <div className="vw-rm-rk" role="group" aria-label="Channel">
        <button type="button" aria-label={up ? `Channel up to ${identText(up)}` : "Channel up"} onClick={() => onCommand({ type: "channel", dir: "up" })} disabled={!row}>
          <Icon name="up" />
        </button>
        <span aria-hidden="true">CH</span>
        <button type="button" aria-label={down ? `Channel down to ${identText(down)}` : "Channel down"} onClick={() => onCommand({ type: "channel", dir: "down" })} disabled={!row}>
          <Icon name="down" />
        </button>
      </div>
      <div className="vw-rm-mid" aria-live="polite">
        {row ? (
          <>
            <span className="vw-rm-mid__ch">{row.station.channel}</span>
            <span className="vw-rm-mid__cs oc-cs">{row.station.callSign}</span>
            <div className="vw-rm-mid__nb">
              {up && (
                <>
                  Up: {identText(up)}
                  <br />
                </>
              )}
              {down && <>Down: {identText(down)}</>}
            </div>
          </>
        ) : (
          <span className="vw-rm-mid__ch" aria-label="Waiting for the TV">
            {" "}
          </span>
        )}
      </div>
      <div className="vw-rm-rk" role="group" aria-label="Play">
        <button type="button" aria-label={paused ? "Play" : "Pause"} onClick={() => onCommand({ type: paused ? "play" : "pause" })} disabled={!row}>
          <Icon name={paused ? "play" : "pause"} />
        </button>
        <span aria-hidden="true">PLAY</span>
        <button type="button" aria-label="Last channel" onClick={() => onCommand({ type: "last" })} disabled={!row}>
          <Icon name="back" />
        </button>
      </div>
    </div>
  );
}

/**
 * The TV's guide from the phone: ▲ ▼ ◀ ▶ and OK move and choose on the TV (its remote's keys), Back
 * steps back there. Takes the rockers' place while the TV's guide is open.
 */
export function GuidePad({ onCommand, onBack }: { onCommand: (c: RemoteCommand) => void; onBack: () => void }) {
  const focus = (dir: "up" | "down" | "left" | "right") => () => onCommand({ type: "focus", dir });
  return (
    <div className="vw-rm-pad" role="group" aria-label="Guide on the TV">
      <div className="vw-rm-pad__keys">
        <button type="button" className="vw-rm-pad__up" aria-label="Up" onClick={focus("up")}>
          <Icon name="up" />
        </button>
        <button type="button" className="vw-rm-pad__left" aria-label="Left" onClick={focus("left")}>
          <Icon name="back2" />
        </button>
        <button type="button" className="vw-rm-pad__ok" onClick={() => onCommand({ type: "select" })}>
          OK
        </button>
        <button type="button" className="vw-rm-pad__right" aria-label="Right" onClick={focus("right")}>
          <Icon name="chev" />
        </button>
        <button type="button" className="vw-rm-pad__down" aria-label="Down" onClick={focus("down")}>
          <Icon name="down" />
        </button>
      </div>
      <Button size="sm" icon="back" onClick={onBack}>
        Back
      </Button>
    </div>
  );
}

/** Back to live, under the rockers while the TV is paused or playing on behind live. */
export function BackToLive({ onCommand }: { onCommand: (c: RemoteCommand) => void }) {
  return (
    <div className="vw-rm-live">
      <Button onClick={() => onCommand({ type: "backToLive" })}>Back to live</Button>
    </div>
  );
}

export function RemoteButtons({ onGuide, onInfo, onKeypad, onLast, guideOpen = false }: { onGuide: () => void; onInfo: () => void; onKeypad: () => void; onLast: () => void; guideOpen?: boolean }) {
  return (
    <div className="vw-rm-row">
      {/* The TV's guide: pressed again, it closes there. */}
      <Button icon="guide" onClick={onGuide} aria-pressed={guideOpen} set={guideOpen}>
        Guide
      </Button>
      <Button icon="info" onClick={onInfo}>
        Info
      </Button>
      <Button icon="keys" onClick={onKeypad}>
        Keypad
      </Button>
      <Button icon="back" onClick={onLast}>
        Last
      </Button>
    </div>
  );
}

const HOLD_MS = 600;

/**
 * The six presets as channel keys. A key tunes the TV; "+" saves what the TV shows to that key;
 * holding a full key puts what the TV shows there instead (the viewer's press and hold).
 */
export function RemotePresets({ keys, playingId, onTune, onSave }: { keys: RemotePreset[]; playingId: string | null; onTune: (k: RemotePreset) => void; onSave: (key: number) => void }) {
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; fired: boolean } | null>(null);
  const down = (key: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const h = { fired: false, timer: setTimeout(() => ((h.fired = true), onSave(key)), HOLD_MS) };
    hold.current = h;
  };
  const up = () => {
    if (hold.current) clearTimeout(hold.current.timer);
  };
  return (
    <>
      <h2 className="vw-rm-pres__h">Presets</h2>
      <div className="vw-rm-pres" role="group" aria-label="Presets">
        {keys.map((k) =>
          k.preset ? (
            <button
              key={k.key}
              type="button"
              className={k.preset.station.id === playingId ? "vw-rm-pres--on" : undefined}
              aria-pressed={k.preset.station.id === playingId}
              aria-label={`Preset ${k.key}, ${[k.preset.station.callSign, k.preset.station.channel].filter(Boolean).join(" ")}`}
              onPointerDown={down(k.key)}
              onPointerUp={up}
              onPointerLeave={up}
              onPointerCancel={up}
              onContextMenu={(e) => e.preventDefault()}
              onClick={() => {
                // A hold already saved; the click that ends it doesn't tune.
                if (hold.current?.fired) return void (hold.current = null);
                onTune(k);
              }}
            >
              <span className="vw-rm-pres__k">{k.key}</span>
              <span className="vw-rm-pres__ch">{k.preset.station.channel}</span>
            </button>
          ) : (
            <button key={k.key} type="button" className="vw-rm-pres--empty" aria-label={`Preset ${k.key}, empty: save this channel`} onClick={() => onSave(k.key)}>
              <span className="vw-rm-pres__k">{k.key}</span>
              <span className="vw-rm-pres__ch">+</span>
            </button>
          )
        )}
      </div>
    </>
  );
}
