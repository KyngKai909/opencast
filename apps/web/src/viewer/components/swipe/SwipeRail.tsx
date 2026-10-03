// The right-hand buttons (swipe home 02): Preset (filled when the station is one), Remind, Pledge,
// Share and Guide, the same actions the old home had, moved to where thumbs expect them. Labels,
// never numbers. In landscape the labels drop to icons; each keeps its name for screen readers, and
// a long press shows it.

import { useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Icon, clock, cx, type IconName } from "@opencast/ui";
import { MARKET_TZ } from "../../../lib/clock";
import { useViewerActions } from "../../data/viewer";
import type { AiringX } from "../../api/ext";
import { usePresetButton } from "../watch/usePresetButton";
import { useOverlayParams } from "../watch/overlay";
import { stationSlug } from "../watch/logic";
import type { WatchData } from "../watch/useWatch";

/** A long press shows a button's name (landscape, icons only). */
export const LONG_PRESS_MS = 450;

function RailButton({ icon, label, name, filled, disabled, onClick }: { icon: IconName; label: ReactNode; name: string; filled?: boolean; disabled?: boolean; onClick: () => void }) {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <button
      type="button"
      className={cx("vw-sw__rb", filled && "vw-sw__rb--on")}
      aria-label={name}
      disabled={disabled}
      onPointerDown={() => {
        held.current = false;
        clear();
        timer.current = setTimeout(() => {
          held.current = true;
          setShown(true);
        }, LONG_PRESS_MS);
      }}
      onPointerUp={() => {
        clear();
        setTimeout(() => setShown(false), 900);
      }}
      onPointerLeave={() => {
        clear();
        setShown(false);
      }}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        // A long press shows the name; it doesn't also press.
        if (held.current) return void (held.current = false);
        onClick();
      }}
    >
      <span className="vw-sw__ic" aria-hidden="true">
        <Icon name={icon} size={21} />
      </span>
      <span className="vw-sw__rl" aria-hidden="true">
        {label}
      </span>
      {shown && (
        <span className="vw-sw__tip" role="tooltip">
          {name}
        </span>
      )}
    </button>
  );
}

export function SwipeRail({ w, className }: { w: WatchData; className?: string }) {
  const st = w.row?.station ?? null;
  const navigate = useNavigate();
  const { open } = useOverlayParams();
  const { remind } = useViewerActions();
  const { key, save } = usePresetButton(st);
  if (!st) return null;
  const slug = stationSlug(st);
  // Remind: what's on next here (the program after this one).
  const next: AiringX | null = w.row?.next && w.row.next.kind !== "off_air" ? w.row.next : (w.page.data?.upNext.find((a) => a.kind !== "off_air") ?? null);
  const nextAt = next ? clock(next.startsAt, { timeZone: MARKET_TZ }) : null;
  return (
    <div className={cx("vw-sw__rail", className)} role="group" aria-label="This station">
      <RailButton
        icon={key !== null ? "star-f" : "star"}
        filled={key !== null}
        label={key !== null ? `Preset ${key}` : "Preset"}
        name={key !== null ? `Preset ${key}. Open presets` : "Add to presets"}
        onClick={() => (key !== null ? navigate("/presets") : save())}
      />
      <RailButton
        icon="bell"
        label="Remind"
        name={next ? `Remind me: ${next.title}, ${nextAt}` : "Remind me (nothing scheduled next)"}
        disabled={!next}
        onClick={() => next && remind({ airing: next, station: st })}
      />
      {/* A city's own stream isn't run on Opencast: there's no one to pledge to here. */}
      {st.kind !== "listed" && <RailButton icon="heart" label="Pledge" name="Pledge" onClick={() => open({ modal: "pledge", station: slug })} />}
      <RailButton icon="share" label="Share" name="Share" onClick={() => open({ modal: "share", station: slug, ...(w.now?.logEntryId ? { airing: w.now.logEntryId } : {}) }, ["airing"])} />
      <RailButton icon="guide" label="Guide" name="Guide" onClick={() => navigate("/guide")} />
    </div>
  );
}
