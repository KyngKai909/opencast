// Casting and mirroring from the phone (tv 06.2 to 06.4; tv-update 02): one sender interface with
// two implementations (Google's Cast Web Sender in Chrome, and dev:mock's stand-in that reaches
// TV mode's receiver.html through a bridge page), and a seam for Phase 8's mirroring plugin.

/** Where a TV can be reached. Each kind is one row of the table in targets.ts. */
export type TargetKind = "chromecast" | "airplay" | "tv_app";

/** A TV in "Watch on". */
export interface CastTarget {
  id: string;
  /** "Living room TV". */
  name: string;
  kind: TargetKind;
  /**
   * The web sender can't list TVs by name: Chrome shows its own list when casting starts. A picker
   * target stands for "a TV Chrome will ask about", and takes the TV's name once connected.
   */
  picker?: boolean;
}

/** What the receiver tells every phone (apps/tv receiver.tsx `StateToPhones`). */
export interface ReceiverState {
  stationId: string | null;
  paused: boolean;
  /** The name of whoever changed it last ("Kai's phone"). */
  changedBy: string | null;
  /** When the sleep timer ends, in ms since the epoch. */
  sleepEndsAt: number | null;
}

/** The phone remote's commands (the "Cast / bridge message" column of the remote spec). */
export type RemoteCommand =
  | { type: "channel"; dir: "up" | "down" }
  | { type: "tune"; channel: string }
  | { type: "preset"; key: number }
  | { type: "last" }
  | { type: "info" }
  | { type: "pause" }
  | { type: "play" }
  | { type: "sleep"; until: "end_of_program" | number | null };

/** The first message a phone sends: who it is, which market, and whether other phones may change the channel. */
export interface SessionIntro {
  /** "Kai's phone", or "a phone" signed out. */
  from: string;
  marketSlug: string | null;
  othersCanChange: boolean;
}

/** One way of reaching a Cast receiver. */
export interface CastSender {
  readonly kind: "mock" | "google";
  /** The TVs it can offer now. */
  targets(): Promise<CastTarget[]>;
  /** Starts a session with a TV (by name, or Chrome's picker) and introduces this phone. Resolves with the TV as connected. */
  connect(target: CastTarget, intro: SessionIntro): Promise<CastTarget>;
  /** Sends a command; `from` is added from the session's intro. */
  send(command: RemoteCommand): void;
  /** The receiver's state as it arrives. */
  onState(listener: (state: ReceiverState) => void): () => void;
  /** The session ended from the other side (the TV stopped, the receiver went away). */
  onEnded(listener: () => void): () => void;
  /** Ends this phone's session. */
  disconnect(): void;
  /** The TV this phone is connected to, if any. */
  connected(): CastTarget | null;
}
