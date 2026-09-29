// "All six keys are taken" (you 03.1): ?modal=replace-key&station=<id>, over whatever page saved it
// (savePreset's onFull, and Presets' "Give it a key"). The key used least in the last month is
// preselected (accounts.suggestPresetKey). Saving never deletes: the replaced station moves to
// More presets. A Modal on the web, a Sheet on the phone.
//
// The frame offers two keys (3 and 6) with no rule for which; the API suggests one. So every key
// is offered, in key order, with the suggestion preselected (inventory, worth raising 7).

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { accountsApi, stationsApi, type StationIdent } from "@opencast/contracts";
import { Button, ChoiceList, Modal, Sheet, useToast, type Choice } from "@opencast/ui";
import { useApi } from "../../../api/hooks";
import { useAuth } from "../../../auth/AuthProvider";
import { useChannels } from "../../data/viewer";
import { useIsPhone } from "../../layout/shell";
import { KEYS, lowestFreeKey, placePreset } from "../you/presetRules";
import { usePresetEditor } from "../you/usePresetEditor";
import { identText } from "../you/youRules";
import "./ReplaceKeyDialog.css";

export default function ReplaceKeyDialog() {
  const [params] = useSearchParams();
  const stationId = params.get("modal") === "replace-key" ? params.get("station") : null;
  if (!stationId) return null;
  return <ReplaceKey stationId={stationId} />;
}

type Pick = `${number}` | "none";

function ReplaceKey({ stationId }: { stationId: string }) {
  const auth = useAuth();
  const phone = useIsPhone();
  const toast = useToast();
  const [, setParams] = useSearchParams();
  const channels = useChannels();
  const editor = usePresetEditor();
  const [choice, setChoice] = useState<Pick | null>(null);

  const known = useMemo(() => {
    const idents = new Map<string, StationIdent>();
    for (const c of channels) idents.set(c.station.id, c.station);
    for (const p of editor.presets) idents.set(p.station.id, p.station);
    return idents;
  }, [channels, editor.presets]);
  const lookup = useApi(stationsApi.getStation, { params: { stationRef: stationId } }, { enabled: !known.has(stationId) });
  const station = known.get(stationId) ?? lookup.data?.station ?? null;
  const suggested = useApi(accountsApi.suggestPresetKey, {}, { enabled: auth.signedIn });

  const list = editor.current();
  const already = list.find((p) => p.stationId === stationId);
  const full = lowestFreeKey(list.filter((p) => p.stationId !== stationId)) === null;

  // Preselect the suggestion once it's known; with no suggestion (no use yet, or this device), No key.
  useEffect(() => {
    if (choice !== null) return;
    if (auth.signedIn && suggested.isLoading) return;
    const k = suggested.data?.key ?? null;
    setChoice(k !== null ? (`${k}` as Pick) : already?.key === null ? null : "none");
  }, [choice, auth.signedIn, suggested.isLoading, suggested.data, already]);

  const close = () =>
    setParams(
      (p) => {
        p.delete("modal");
        // Opened over the station preview: closing goes back to the preview.
        const preview = p.get("preview");
        p.delete("preview");
        if (preview) p.set("station", preview);
        else p.delete("station");
        return p;
      },
      { replace: true }
    );

  const label = station ? identText(station) : "";
  const nameOf = (id: string) => {
    const s = known.get(id);
    return s ? { cs: s.callSign ?? s.name, full: identText(s) } : { cs: "It", full: "It" };
  };

  const options: Array<Choice<Pick>> = [
    ...KEYS.map((k): Choice<Pick> => {
      const on = list.find((p) => p.key === k && p.stationId !== stationId);
      if (!on) return { value: `${k}` as Pick, title: `Key ${k}`, helper: "Free" };
      const n = nameOf(on.stationId);
      return { value: `${k}` as Pick, title: `Replace key ${k}, ${n.full}`, helper: `${n.cs} moves to More presets` };
    }),
    // Already in More presets ("Give it a key"): no key is where it is now.
    ...(already && already.key === null ? [] : [{ value: "none" as Pick, title: "No key", helper: "Save it to More presets" }])
  ];

  const save = async () => {
    if (!choice) return;
    const key = choice === "none" ? null : Number(choice);
    const before = editor.current();
    const displaced = key === null ? undefined : before.find((p) => p.key === key && p.stationId !== stationId);
    const ok = await editor.apply(placePreset(before, stationId, key));
    if (!ok) return; // The API's words show under the choices.
    close();
    toast.show({
      message: key === null ? `${label} saved to More presets` : displaced ? `${label} is on key ${key}. ${nameOf(displaced.stationId).cs} moved to More presets.` : `${label} is on key ${key}`,
      onUndo: () => void editor.apply(before)
    });
  };

  const body = (
    <>
      <ChoiceList label={station ? `Where should ${label} go?` : "Where should it go?"} options={options} value={choice} onChange={setChoice} className="vw-replace__opts" />
      {editor.error && (
        <p className="vw-replace__err" role="alert">
          {editor.error}
        </p>
      )}
    </>
  );
  const footer = (
    <Button variant="primary" onClick={() => void save()} disabled={!choice || !station || editor.saving}>
      Save {label}
    </Button>
  );
  const common = { open: true, onClose: close, eyebrow: full ? "All six keys are taken" : undefined, title: station ? `Where should ${label} go?` : "Where should it go?", footer };
  if (phone) return <Sheet {...common}>{body}</Sheet>;
  return (
    <Modal {...common} width={520}>
      {body}
    </Modal>
  );
}
