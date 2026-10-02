import { useCallback, useEffect, useRef, useState } from "react";
import { Bug, IconButton, Tag, Tally, cx } from "@opencast/ui";
import { NUMBER_WAIT_MS, SAMPLE_DIAL, noStation, readEntry, step, typeKey, type Entry } from "../lib/tuner";

const FLIP_MS = 140;

function reducedMotion(): boolean {
  if (document.documentElement.dataset.motion === "reduce") return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Keys belong to a field, or to a control that uses arrows itself (the waitlist's roles). */
function keysAreTaken(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return true;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return true;
  return el.closest("[role=radiogroup],[role=tablist],[role=menu],[role=listbox]") !== null;
}

/**
 * S.01's tuner: a sample of the dial in the station's colour. Channel up and down (the rocker,
 * or the arrow keys while the tuner is on screen), and numbers typed anywhere outside a field.
 */
export function Tuner({ initial = 0 }: { initial?: number }) {
  const root = useRef<HTMLDivElement>(null);
  // `shown` is what's on the picture; it follows `target` after the flip, as the reference's does.
  const [shown, setShown] = useState(initial);
  const [flipping, setFlipping] = useState(false);
  const [entry, setEntry] = useState<Entry | null>(null);
  const target = useRef(initial);
  const flipTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const entryTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const entryRef = useRef<Entry | null>(null);
  /** The entry on screen has been tried and had no station. */
  const entryDone = useRef(false);

  const tuneTo = useCallback((index: number) => {
    target.current = index;
    clearTimeout(flipTimer.current);
    if (reducedMotion()) {
      setFlipping(false);
      setShown(index);
      return;
    }
    setFlipping(true);
    flipTimer.current = setTimeout(() => {
      setShown(target.current);
      setFlipping(false);
    }, FLIP_MS);
  }, []);

  const tune = useCallback((delta: number) => {
    clearTimeout(entryTimer.current);
    setEntry(null);
    tuneTo(step(target.current, delta));
  }, [tuneTo]);

  const commit = useCallback((e: Entry) => {
    clearTimeout(entryTimer.current);
    if (e.match !== null) {
      setEntry(null);
      if (e.match !== target.current) tuneTo(e.match);
    } else {
      // "No station on 13" stays a moment, then goes; the channel doesn't change.
      entryDone.current = true;
      entryTimer.current = setTimeout(() => setEntry(null), NUMBER_WAIT_MS);
    }
  }, [tuneTo]);

  entryRef.current = entry;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (keysAreTaken(e)) return;
      const r = root.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        tune(e.key === "ArrowUp" ? 1 : -1);
        return;
      }
      const pending = entryRef.current;
      if (/^[\d.]$/.test(e.key)) {
        // After "No station on 13" has been shown, the next number starts fresh.
        const typed = typeKey(pending && !entryDone.current ? pending.typed : "", e.key);
        if (typed === null) return;
        entryDone.current = false;
        e.preventDefault();
        const next = readEntry(typed);
        setEntry(next);
        clearTimeout(entryTimer.current);
        entryTimer.current = setTimeout(() => commit(next), NUMBER_WAIT_MS);
        return;
      }
      if (!pending) return;
      if (e.key === "Enter") {
        e.preventDefault();
        commit(pending);
      } else if (e.key === "Escape") {
        clearTimeout(entryTimer.current);
        setEntry(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tune, commit]);

  useEffect(() => () => {
    clearTimeout(flipTimer.current);
    clearTimeout(entryTimer.current);
  }, []);

  const s = SAMPLE_DIAL[shown]!;
  const matched = entry && entry.match !== null ? SAMPLE_DIAL[entry.match]! : null;

  return (
    <div className="st-tuner" ref={root} role="group" aria-label="A sample of the Opencast dial">
      <div className="st-set">
        <div className={cx("st-pic", flipping && "st-pic--flip")} style={{ background: s.colour }} data-testid="tuner-picture">
          {s.radio && <div className="st-pic__radio">{s.channel}</div>}
          <div className="st-pic__ttl">{s.title}</div>
          <div className="st-pic__sub">{s.sub}</div>
        </div>
        <div className="st-set__band">
          {s.live && <Tag variant="live" onPicture>Live</Tag>}
          {s.radio && <Tag onPicture>Radio band</Tag>}
        </div>
        <Tally state="lit" on="picture" size="md" className="st-set__tally" />
        {!s.radio && <Bug callSign={s.callSign} channel={s.channel} className="st-set__bug" />}
      </div>
      <div className="st-rock">
        <IconButton icon="up" label="Channel up" onClick={() => tune(1)} />
        <span className="st-rock__lbl" aria-hidden="true">CH</span>
        <IconButton icon="down" label="Channel down" onClick={() => tune(-1)} />
      </div>
      <div className="st-readout" aria-live="polite">
        {entry ? (
          <>
            <span className="st-readout__ch">
              {entry.typed}
              <span className="st-readout__filled">{entry.filled}</span>
            </span>
            <span className="st-readout__who">
              {matched ? (
                <>
                  <span className="oc-cs">{matched.callSign}</span>
                  <small>{matched.name}</small>
                </>
              ) : (
                <small className="st-readout__none">{noStation(entry)}</small>
              )}
            </span>
          </>
        ) : (
          <>
            <span className="st-readout__ch">{s.channel}</span>
            <span className="st-readout__who">
              <span className="oc-cs">{s.callSign}</span>
              <small>{s.name}</small>
            </span>
          </>
        )}
        <span className="st-readout__hint">
          Try it<span className="st-readout__keys">, or use<br />the arrow keys</span>
        </span>
      </div>
    </div>
  );
}
