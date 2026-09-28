// The six preset keys as tiles (you 02.1, 03.1, 06.2: .keys .key): the key, channel, call sign and
// what's on now. On Presets they can be dragged by the grip ("::") to another key, or moved with
// the arrow keys while the grip has focus; each has a menu with Remove.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { LiveText, Menu, type MenuItem } from "@opencast/ui";
import type { PresetView } from "../../data/viewer";
import { identText } from "./youRules";
import "./PresetTiles.css";

export interface PresetTilesProps {
  /** Presets with keys; the six places are drawn whether or not they're full. */
  presets: PresetView[];
  onTune?: (stationId: string) => void;
  /** Presets: drag and arrow keys move a station from one key to another. */
  onMove?: (from: number, to: number) => void;
  onRemove?: (stationId: string) => void;
  /** The phone's three-across form. */
  compact?: boolean;
  className?: string;
}

function nowLine(p: PresetView) {
  const now = p.row?.now;
  if (!p.row) return p.station.name;
  if (!now) return "Off air";
  return (
    <>
      {now.live && (
        <>
          <LiveText />{" "}
        </>
      )}
      {now.title}
    </>
  );
}

export function PresetTiles({ presets, onTune, onMove, onRemove, compact, className }: PresetTilesProps) {
  const sortable = !!onMove;
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);
  const [said, setSaid] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // After a keyboard move, focus follows the station to its new key.
  useEffect(() => {
    if (!focusId) return;
    root.current?.querySelector<HTMLElement>(`[data-grip="${focusId}"]`)?.focus();
    setFocusId(null);
  }, [focusId, presets]);

  const byKey = (k: number) => presets.find((p) => p.key === k) ?? null;

  const move = (from: number, to: number, p: PresetView, viaKeys: boolean) => {
    if (to < 1 || to > 6 || to === from || !onMove) return;
    onMove(from, to);
    setSaid(`${identText(p.station)} moved to key ${to}`);
    if (viaKeys) setFocusId(p.station.id);
  };

  const onGripKey = (e: KeyboardEvent, k: number, p: PresetView) => {
    const d = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
    if (!d) return;
    e.preventDefault();
    move(k, k + d, p, true);
  };

  const keyAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-key]");
    return el && root.current?.contains(el) ? Number(el.dataset.key) : null;
  };
  const onDown = (e: PointerEvent<HTMLButtonElement>, k: number) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ from: k, over: k });
  };
  const onDrag = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const over = keyAt(e.clientX, e.clientY);
    if (over !== drag.over) setDrag({ ...drag, over });
  };
  const onUp = (e: PointerEvent<HTMLButtonElement>, p: PresetView) => {
    if (!drag) return;
    const to = keyAt(e.clientX, e.clientY);
    setDrag(null);
    if (to !== null) move(drag.from, to, p, false);
  };

  return (
    <div ref={root} className={`vw-y-keys${compact ? " vw-y-keys--compact" : ""}${sortable ? " vw-y-keys--sortable" : ""}${className ? ` ${className}` : ""}`} role="list" aria-label="Presets, keys 1 to 6">
      {[1, 2, 3, 4, 5, 6].map((k) => {
        const p = byKey(k);
        const cls = ["vw-y-key", !p && "vw-y-key--empty", drag?.from === k && "vw-y-key--drag", drag && drag.over === k && drag.from !== k && "vw-y-key--over"].filter(Boolean).join(" ");
        if (!p)
          return (
            <div key={`empty-${k}`} role="listitem" className={cls} data-key={k}>
              <span className="vw-y-key__k">{k}</span>
              <span className="vw-y-key__empty">Empty</span>
            </div>
          );
        const items: MenuItem[] = [
          ...(sortable && k > 1 ? [{ label: "Move left", onSelect: () => move(k, k - 1, p, true) }] : []),
          ...(sortable && k < 6 ? [{ label: "Move right", onSelect: () => move(k, k + 1, p, true) }] : []),
          ...(onRemove ? [{ label: "Remove", danger: true, onSelect: () => onRemove(p.station.id) }] : [])
        ];
        return (
          // Keyed by station, so a moved station keeps its element (and the grip keeps focus).
          <div key={p.station.id} role="listitem" className={cls} data-key={k}>
            <button type="button" className="vw-y-key__tune" onClick={() => onTune?.(p.station.id)} aria-keyshortcuts={String(k)} aria-label={`Key ${k}, ${identText(p.station)}. Tune in`}>
              <span className="vw-y-key__k">{k}</span>
              <span className="vw-y-key__ch oc-ch">{p.station.channel}</span>
              <span className="vw-y-key__cs oc-cs">{p.station.callSign ?? p.station.name}</span>
              <small className="vw-y-key__now">{nowLine(p)}</small>
            </button>
            {sortable && (
              <button
                type="button"
                className="vw-y-key__grip"
                data-grip={p.station.id}
                aria-label={`Move ${identText(p.station)}, on key ${k}. Drag, or use the arrow keys`}
                onKeyDown={(e) => onGripKey(e, k, p)}
                onPointerDown={(e) => onDown(e, k)}
                onPointerMove={onDrag}
                onPointerUp={(e) => onUp(e, p)}
                onPointerCancel={() => setDrag(null)}
              >
                <span aria-hidden="true">::</span>
              </button>
            )}
            {items.length > 0 && <Menu items={items} label={`More for ${identText(p.station)}`} className="vw-y-key__menu" />}
          </div>
        );
      })}
      <p className="oc-sr-only" aria-live="polite">
        {said}
      </p>
    </div>
  );
}
