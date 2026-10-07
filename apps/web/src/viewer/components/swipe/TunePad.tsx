// The Tune pad (A245; swipe home 04, 08 "Tune button"): `?sheet=tune`, from the floating bar's Tune
// button on every tab. A sheet from the bottom in portrait, a panel on the right in landscape, and on
// tablets a panel above the Tune button, with the picture dimmed but playing. Keys 0 to 9, a point
// for subchannels and frequencies, and delete. It names the station and what's on as you type,
// tunes 2 seconds after the last key or on Tune, and for a number with no station says so with the
// nearest. Tuning by number is always the full channel change (static, the corner number, the
// banner): the station wasn't preloaded. From Guide, Search or You, tuning opens Watch on it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Icon, cx } from "@opencast/ui";
import { useNow } from "../../../lib/clock";
import { useChannels } from "../../data/viewer";
import { useLandscape, useViewerLayout } from "../../layout/shell";
import { useTune } from "../../player/PlayerRoot";
import { useOverlayParams } from "../watch/overlay";
import { watchPath } from "../station/actions";
import { PAD_WAIT_MS, RADIO_MAX, RADIO_MIN, TV_MAX, TV_MIN, padChannel, padKey, padLines, readPad, type PadKey } from "./padRules";
import "./TunePad.css";

const KEYS: PadKey[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, ".", 0, "del"];

export function TunePad() {
  const { params, close } = useOverlayParams();
  if (params.get("sheet") !== "tune") return null;
  return <TunePadPanel onClose={() => close(["sheet"])} />;
}

function TunePadPanel({ onClose }: { onClose: () => void }) {
  const channels = useChannels();
  const layout = useViewerLayout();
  const landscape = useLandscape();
  const navigate = useNavigate();
  const loc = useLocation();
  const tune = useTune("keypad");
  const now = useNow(30_000);
  const [typed, setTyped] = useState("");
  const read = useMemo(() => readPad(typed, channels), [typed, channels]);
  const match = read.kind === "match" ? read.row : null;
  const lines = padLines(read, now);
  const panel = useRef<HTMLDivElement>(null);

  const go = useCallback(() => {
    if (!match) return;
    void tune(match.station.id);
    // On Watch the URL follows the channel; from another tab, tuning opens Watch on it.
    if (loc.pathname.startsWith("/watch/") || loc.pathname === "/") onClose();
    else navigate(watchPath(match.station), { replace: true });
  }, [match, tune, loc.pathname, navigate, onClose]);

  const press = useCallback((k: PadKey) => setTyped((t) => padKey(t, k)), []);

  // It tunes 2 seconds after the last key; another key starts the count again.
  useEffect(() => {
    if (!match) return;
    const t = setTimeout(go, PAD_WAIT_MS);
    return () => clearTimeout(t);
  }, [typed, match?.station.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Typing on a keyboard works too (capture: the app's 1 to 6 for presets doesn't also take them).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (/^[0-9]$/.test(e.key)) press(Number(e.key));
      else if (e.key === ".") press(".");
      else if (e.key === "Backspace") press("del");
      else if (e.key === "Enter" && match && (e.target as HTMLElement | null)?.tagName !== "BUTTON") go();
      else if (e.key === "Escape") onClose();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [press, go, match, onClose]);

  // Focus moves into the pad, and back to whatever opened it.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const c = padChannel(typed);
  // "18" shows its ".1" filled in, dim.
  const filled = c?.band === "tv" && !typed.includes(".") ? ".1" : typed.endsWith(".") && c ? c.channel.slice(typed.length) : "";
  const form = layout === "tablet" ? "panel" : landscape ? "side" : "sheet";

  return (
    <div className={cx("vw-pad", `vw-pad--${form}`)} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className="vw-pad__sheet" role="dialog" aria-modal="true" aria-label="Tune by number" tabIndex={-1}>
        {form === "sheet" && <div className="vw-pad__grab" aria-hidden="true" />}
        <div className="vw-pad__disp">
          <span className="vw-pad__num oc-mono" aria-hidden="true">
            {typed ? (
              <>
                {typed}
                {filled && <em>{filled}</em>}
              </>
            ) : (
              <span className="vw-pad__ph">Channel</span>
            )}
          </span>
          <span className="vw-pad__caret" aria-hidden="true" />
          <span className="vw-pad__band">
            TV {TV_MIN} to {TV_MAX}, radio {RADIO_MIN} to {RADIO_MAX}
          </span>
        </div>
        <div className={cx("vw-pad__match", lines.none && "vw-pad__match--none")} role="status" aria-live="polite">
          {typed && <span className="oc-sr-only">{`${typed}. `}</span>}
          {lines.lead && <b>{lines.lead}</b>}
          {lines.rest}
        </div>
        <div className="vw-pad__count" aria-hidden="true">
          {match && <i key={`${typed}:${match.station.id}`} className="is-run" />}
        </div>
        <div className="vw-pad__keys" role="group" aria-label="Keys">
          {KEYS.map((k) => (
            <button key={String(k)} type="button" className={k === "del" ? "vw-pad__fn" : undefined} aria-label={k === "del" ? "Delete" : k === "." ? "Point" : String(k)} onClick={() => press(k)}>
              {k === "del" ? <Icon name="bksp" size={20} /> : k}
            </button>
          ))}
        </div>
        <div className="vw-pad__acts">
          <button type="button" className="vw-pad__cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="vw-pad__go" disabled={!match} onClick={go}>
            Tune
          </button>
        </div>
      </div>
    </div>
  );
}
