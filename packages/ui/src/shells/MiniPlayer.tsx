import { useRef, type PointerEvent, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { Tally } from "../primitives/Tally";
import { IconButton } from "../primitives/Button";
import { ShellCard } from "./ShellCard";

export interface MiniPlayerProps {
  /** What's on ("Saturday Reel"). */
  title: string;
  /** The station line ("BEAT 12.1"). */
  station: string;
  /** The station's colour for the title card. */
  colour: string;
  /** The words on the title card. Defaults to the title. */
  card?: string;
  /** Playing on this phone: the tally is lit only then. */
  playing: boolean;
  /** Play the tally's switch-on when it lights. False where it's already known to be lit (a remount). */
  flicker?: boolean;
  /** Pause, or play again when paused. */
  onTogglePlay?: () => void;
  /** Opens the full player (tapping the card or title). */
  onOpen?: () => void;
  /** Replaces the station line: "BEAT 12.1, 8:30 – 9:00 pm, 18 min left" (swipe home 06). */
  line?: ReactNode;
  /** How far into the program, 0 to 1: a thin line along the bottom (its progress, not a scrub bar). */
  progress?: number | null;
  /** Swiping it down stops the player (swipe home 06). */
  onDismiss?: () => void;
  className?: string;
}

/** How far down a finger moves the mini player before letting go stops it. */
export const MINI_DISMISS_PX = 40;

/** The phone's mini player above the tabs: title card, title, station, the tally while playing, and pause. */
export function MiniPlayer({ title, station, colour, card, playing, flicker, onTogglePlay, onOpen, line, progress, onDismiss, className }: MiniPlayerProps) {
  const start = useRef<{ y: number; id: number } | null>(null);
  const face = (
    <>
      <ShellCard colour={colour} text={card ?? title} className="oc-mini-player__card" />
      <div className="oc-mini-player__text">
        <div className="oc-mini-player__title oc-clamp1">{title}</div>
        <div className="oc-mini-player__station oc-clamp1">{line ?? station}</div>
      </div>
    </>
  );
  const swipe = onDismiss
    ? {
        onPointerDown: (e: PointerEvent<HTMLElement>) => void (start.current = { y: e.clientY, id: e.pointerId }),
        onPointerUp: (e: PointerEvent<HTMLElement>) => {
          const s = start.current;
          start.current = null;
          if (s && s.id === e.pointerId && e.clientY - s.y > MINI_DISMISS_PX) onDismiss();
        },
        onPointerCancel: () => void (start.current = null)
      }
    : {};
  return (
    <section className={cx("oc-mini-player", progress != null && "oc-mini-player--progress", className)} aria-label="Player" {...swipe}>
      {onOpen ? (
        <button type="button" className="oc-mini-player__open" onClick={onOpen} aria-label={`Open player, ${title}, ${station}`}>
          {face}
        </button>
      ) : (
        face
      )}
      <div className="oc-mini-player__ctl">
        {playing && <Tally state="lit" flicker={flicker} />}
        <IconButton icon={playing ? "pause" : "play"} label={playing ? "Pause" : "Play"} bare onClick={onTogglePlay} />
      </div>
      {progress != null && (
        <div className="oc-mini-player__bar" aria-hidden="true">
          <i style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
        </div>
      )}
    </section>
  );
}
