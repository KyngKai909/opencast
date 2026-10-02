import { cx } from "../lib/cx";
import { Tally } from "../primitives/Tally";
import { IconButton } from "../primitives/Button";
import { ShellCard } from "./ShellCard";

export interface PlayerBarProps {
  /** What's on ("Saturday Reel"). */
  title: string;
  /** The station line ("BEAT 12.1, carried from REEL"). */
  station: string;
  /** The station's colour for the title card. */
  colour: string;
  /** The words on the title card. Defaults to the title; radio shows the frequency ("88.4"). */
  card?: string;
  /** Playing on this screen: the tally is lit only then. */
  playing: boolean;
  /** Play the tally's switch-on when it lights. False where it's already known to be lit (a remount). */
  flicker?: boolean;
  /** Radio: the channel buttons say "Down the band" and "Up the band". */
  radio?: boolean;
  onChannelDown?: () => void;
  onChannelUp?: () => void;
  /** Pause, or play again when paused. */
  onTogglePlay?: () => void;
  /** Shows the bare volume button. */
  onVolume?: () => void;
  /** Shows the bare "Open player" button. */
  onOpen?: () => void;
  className?: string;
}

/** The web player bar under every viewer page: title card, title and station, channel down and up, pause, and the tally while playing. */
export function PlayerBar({ title, station, colour, card, playing, flicker, radio, onChannelDown, onChannelUp, onTogglePlay, onVolume, onOpen, className }: PlayerBarProps) {
  return (
    <section className={cx("oc-player-bar", className)} aria-label="Player">
      <ShellCard colour={colour} text={card ?? title} className="oc-player-bar__card" />
      <div className="oc-player-bar__text">
        <div className="oc-player-bar__title oc-clamp1">{title}</div>
        <div className="oc-player-bar__station oc-clamp1">{station}</div>
      </div>
      <div className="oc-player-bar__ctl">
        {playing && <Tally state="lit" flicker={flicker} />}
        <IconButton icon="down" label={radio ? "Down the band" : "Channel down"} onClick={onChannelDown} />
        <IconButton icon="up" label={radio ? "Up the band" : "Channel up"} onClick={onChannelUp} />
        <IconButton icon={playing ? "pause" : "play"} label={playing ? "Pause" : "Play"} onClick={onTogglePlay} />
        {onVolume && <IconButton icon="vol" label="Volume" bare onClick={onVolume} />}
        {onOpen && <IconButton icon="expand" label="Open player" bare onClick={onOpen} />}
      </div>
    </section>
  );
}
