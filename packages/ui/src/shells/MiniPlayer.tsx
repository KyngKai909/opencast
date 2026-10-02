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
  className?: string;
}

/** The phone's mini player above the tabs: title card, title, station, the tally while playing, and pause. */
export function MiniPlayer({ title, station, colour, card, playing, flicker, onTogglePlay, onOpen, className }: MiniPlayerProps) {
  const face = (
    <>
      <ShellCard colour={colour} text={card ?? title} className="oc-mini-player__card" />
      <div className="oc-mini-player__text">
        <div className="oc-mini-player__title oc-clamp1">{title}</div>
        <div className="oc-mini-player__station oc-clamp1">{station}</div>
      </div>
    </>
  );
  return (
    <section className={cx("oc-mini-player", className)} aria-label="Player">
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
    </section>
  );
}
