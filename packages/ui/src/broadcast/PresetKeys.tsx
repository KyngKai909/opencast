import { cx } from "../lib/cx";
import { LiveText } from "./LiveText";

export interface Preset {
  /** 1 to 6. */
  key: number;
  channel: string;
  callSign: string;
  /** What's on it now (the web list's second line). */
  now?: string;
  live?: boolean;
}

export interface PresetKeysProps {
  /** The six keys. A key with nothing saved is null. */
  keys: Array<Preset | null>;
  /** The key that's playing: drawn in ink. */
  playing?: number;
  /** list: home's preset column (web). strip: the phone's row of buttons. */
  variant?: "list" | "strip";
  /** The web list's heading, "Presets" with "Keys 1 to 6". */
  heading?: boolean;
  /** A key tunes its station. */
  onTune?: (key: number) => void;
  /** The phone's "+ Add" on an empty key. */
  onAdd?: (key: number) => void;
  className?: string;
}

/** The six preset keys, like a car radio (home 01.1, 02.1). The layout doesn't change when they fill. */
export function PresetKeys({ keys, playing, variant = "list", heading = true, onTune, onAdd, className }: PresetKeysProps) {
  const six = Array.from({ length: 6 }, (_, i) => keys[i] ?? null);
  const none = six.every((k) => k === null);
  const note = none ? <p className="oc-presets__note">Tune in to a station and press Add to presets.</p> : null;

  if (variant === "strip") {
    return (
      <div className={cx("oc-presets", "oc-presets--strip", className)}>
        <div className="oc-presets__strip" role="group" aria-label="Presets">
          {six.map((p, i) =>
            p ? (
              <button
                key={i}
                type="button"
                className={cx("oc-pbtn", p.key === playing && "oc-pbtn--on")}
                aria-pressed={p.key === playing}
                aria-label={`Preset ${p.key}, ${p.callSign} ${p.channel}`}
                onClick={() => onTune?.(p.key)}
              >
                <span className="oc-pbtn__k">{p.key}</span>
                <span className="oc-pbtn__ch oc-ch">{p.channel}</span>
                <span className="oc-cs">{p.callSign}</span>
              </button>
            ) : (
              <button key={i} type="button" className="oc-pbtn oc-pbtn--empty" aria-label={`Preset ${i + 1}, empty: add`} onClick={() => onAdd?.(i + 1)}>
                <span className="oc-pbtn__k">{i + 1}</span>
                <span className="oc-pbtn__ch oc-ch">+</span>
                <span className="oc-pbtn__add">Add</span>
              </button>
            )
          )}
        </div>
        {note}
      </div>
    );
  }

  return (
    <div className={cx("oc-presets", className)}>
      {heading && (
        <h4 className="oc-presets__h">
          Presets <span>Keys 1 to 6</span>
        </h4>
      )}
      <div role="group" aria-label="Presets">
        {six.map((p, i) =>
          p ? (
            <button
              key={i}
              type="button"
              className={cx("oc-pre", p.key === playing && "oc-pre--on")}
              aria-pressed={p.key === playing}
              aria-keyshortcuts={String(p.key)}
              onClick={() => onTune?.(p.key)}
            >
              <span className="oc-pre__k">{p.key}</span>
              <span className="oc-pre__ch oc-ch">{p.channel}</span>
              <span className="oc-pre__w">
                <span className="oc-cs">{p.callSign}</span>
                {p.now != null && (
                  <small className="oc-clamp1">
                    {p.live && (
                      <>
                        <LiveText />{" "}
                      </>
                    )}
                    {p.now}
                  </small>
                )}
              </span>
            </button>
          ) : (
            <div key={i} className="oc-pre oc-pre--empty">
              <span className="oc-pre__k">{i + 1}</span>
              <span />
              <span className="oc-pre__w">Empty</span>
            </div>
          )
        )}
      </div>
      {note}
    </div>
  );
}
