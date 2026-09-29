// Home's presets: keys 1 to 6 as a list on the web, a strip of buttons on the phone (home 01.1,
// 02.1). A key tunes. On the phone, press and hold a key (or tap an empty one) to choose its station.

import { useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi } from "@opencast/contracts";
import { Button, ChoiceList, PresetKeys, Sheet, type Preset } from "@opencast/ui";
import { call } from "../../../api/client";
import { keyFor } from "../../../api/hooks";
import { useAuth } from "../../../auth/AuthProvider";
import { useChannels, usePresets, useViewerActions, type PresetView } from "../../data/viewer";
import { setDevice } from "../../device/store";
import { useNowPlaying, useTune } from "../../player/PlayerRoot";
import { identText } from "./logic";
import "./HomePresets.css";

/** How long a press has to last to reassign a key. */
export const HOLD_MS = 500;

function toKeys(presets: PresetView[]): Array<Preset | null> {
  return [1, 2, 3, 4, 5, 6].map((k) => {
    const p = presets.find((x) => x.key === k);
    if (!p) return null;
    return { key: k, channel: p.station.channel ?? "", callSign: p.station.callSign ?? "", now: p.row ? (p.row.now?.title ?? "Off air") : undefined, live: !!p.row?.now?.live };
  });
}

/** Choosing a station for one key (phone): press and hold, or an empty key's "+ Add". */
function KeySheet({ keyNo, presets, onClose }: { keyNo: number | null; presets: PresetView[]; onClose: () => void }) {
  const auth = useAuth();
  const qc = useQueryClient();
  const channels = useChannels();
  const { removePreset } = useViewerActions();
  const [error, setError] = useState<string | null>(null);
  const current = presets.find((p) => p.key === keyNo) ?? null;

  const assign = (stationId: string) => {
    if (keyNo === null) return;
    const station = channels.find((c) => c.station.id === stationId)?.station;
    const label = station ? identText(station) : "this station";
    const run = async () => {
      try {
        await call(accountsApi.savePreset, { body: { stationId, key: keyNo } });
        void qc.invalidateQueries({ queryKey: keyFor(accountsApi.listPresets).slice(0, 2) });
        onClose();
      } catch (e) {
        setError((e as Error).message);
      }
    };
    // On this device: the key's old station moves to More presets, as the account does it.
    const onDevice = () => {
      setDevice((d) => ({ presets: [...d.presets.filter((p) => p.stationId !== stationId).map((p) => (p.key === keyNo ? { ...p, key: null } : p)), { stationId, key: keyNo }] }));
      onClose();
    };
    if (!auth.signedIn) onClose();
    auth.requireSignIn({ kind: "preset", label: `save ${label} as preset ${keyNo}`, finish: `Save ${label} and go back` }, run, onDevice);
  };

  return (
    <Sheet
      open={keyNo !== null}
      onClose={onClose}
      title={`Preset ${keyNo ?? ""}`}
      subtitle="Choose a station for this key."
      footer={
        current ? (
          <Button
            variant="ghost"
            onClick={() => {
              void removePreset(current.station.id);
              onClose();
            }}
          >
            Remove {identText(current.station)}
          </Button>
        ) : undefined
      }
    >
      {error && <p className="vw-presets__error">{error}</p>}
      <ChoiceList
        label={`Station for preset ${keyNo ?? ""}`}
        value={current?.station.id ?? null}
        onChange={assign}
        options={channels.map((c) => ({ value: c.station.id, title: identText(c.station), helper: c.station.name ?? undefined }))}
      />
    </Sheet>
  );
}

export function HomePresets({ phone }: { phone: boolean }) {
  const { presets, loading } = usePresets();
  const np = useNowPlaying();
  const tune = useTune();
  const [sheetKey, setSheetKey] = useState<number | null>(null);
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const held = useRef(false);

  const keys = toKeys(presets);
  const playing = presets.find((p) => p.key !== null && p.station.id === np.row?.station.id)?.key ?? undefined;
  const onTune = (k: number) => {
    const p = presets.find((x) => x.key === k);
    if (p) void tune(p.station.id);
  };

  if (loading) return <div className={phone ? "vw-presets__wait vw-presets__wait--strip" : "vw-presets__wait"} aria-busy="true" aria-label="Presets" />;

  if (!phone) return <PresetKeys keys={keys} playing={playing} variant="list" onTune={onTune} />;

  // Press and hold: which key the press started on.
  const keyAt = (target: EventTarget) => {
    const btn = (target as HTMLElement).closest?.(".oc-pbtn");
    if (!btn?.parentElement) return null;
    return Array.from(btn.parentElement.children).indexOf(btn) + 1 || null;
  };
  const cancel = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  const onPointerDown = (e: PointerEvent) => {
    const k = keyAt(e.target);
    if (k === null) return;
    held.current = false;
    cancel();
    hold.current = {
      x: e.clientX,
      y: e.clientY,
      timer: window.setTimeout(() => {
        held.current = true;
        hold.current = null;
        setSheetKey(k);
      }, HOLD_MS)
    };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 10) cancel();
  };
  // The click that ends a hold doesn't also tune.
  const onClickCapture = (e: MouseEvent) => {
    if (held.current) {
      e.preventDefault();
      e.stopPropagation();
      held.current = false;
    }
  };
  const onContextMenu = (e: MouseEvent) => {
    const k = keyAt(e.target);
    if (k === null) return;
    e.preventDefault();
    cancel();
    setSheetKey(k);
  };

  return (
    <>
      <div className="vw-presets__hold" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel} onClickCapture={onClickCapture} onContextMenu={onContextMenu}>
        <PresetKeys keys={keys} playing={playing} variant="strip" onTune={onTune} onAdd={(k) => setSheetKey(k)} />
      </div>
      <KeySheet keyNo={sheetKey} presets={presets} onClose={() => setSheetKey(null)} />
    </>
  );
}
