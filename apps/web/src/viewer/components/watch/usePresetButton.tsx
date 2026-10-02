// "Add to presets" that turns into "Preset 4": the lowest free key, or the replace dialog when
// all six are taken (`?modal=replace-key&station=<id>`, built by the You area). Signed out, the
// sign-in names the action and can keep it on this device instead.

import { useCallback } from "react";
import { useNavigate } from "react-router";
import { Button } from "@opencast/ui";
import type { StationIdent } from "@opencast/contracts";
import { usePresets, useViewerActions } from "../../data/viewer";
import { useOverlayParams } from "./overlay";

type Station = Pick<StationIdent, "id" | "callSign" | "channel">;

export function usePresetKey(stationId: string | undefined): number | null {
  const { presets } = usePresets();
  return presets.find((p) => p.station.id === stationId)?.key ?? null;
}

export function usePresetButton(station: Station | null | undefined) {
  const key = usePresetKey(station?.id);
  const { savePreset } = useViewerActions();
  const { open } = useOverlayParams();
  const save = useCallback(() => {
    if (!station) return;
    savePreset(station, { onFull: () => open({ modal: "replace-key", station: station.id }, ["station"]) });
  }, [station, savePreset, open]);
  return { key, save };
}

/** The button: "Add to presets" (or `addLabel`), then "Preset 4" with a check, outlined in ink. */
export function PresetButton({ station, size = "md", addLabel = "Add to presets", className }: { station: Station | null | undefined; size?: "sm" | "md"; addLabel?: string; className?: string }) {
  const { key, save } = usePresetButton(station);
  const navigate = useNavigate();
  // Already a preset: the button is its state, and opens Presets to change it.
  if (key !== null)
    return (
      <Button variant="ghost" size={size} set icon="check" className={className} onClick={() => navigate("/presets")} aria-label={`Preset ${key}. Open presets`}>
        Preset {key}
      </Button>
    );
  return (
    <Button variant="ghost" size={size} className={className} onClick={save}>
      {addLabel}
    </Button>
  );
}
