// Presets (you 03.1): keys 1 to 6, drag to reorder (or the arrow keys on a grip), and More presets
// without keys, each with "Give it a key" and a menu with Remove. With all six taken, giving a key
// opens the replace dialog. Signed out, they're this device's, and signing in keeps them.

import { useSearchParams } from "react-router";
import { Button, Menu, useToast } from "@opencast/ui";
import { useAuth } from "../../auth/AuthProvider";
import type { PresetView } from "../data/viewer";
import { useIsPhone, useShellOptions } from "../layout/shell";
import { useTune } from "../player/PlayerRoot";
import { PresetTiles } from "../components/you/PresetTiles";
import { lowestFreeKey, moveKey, placePreset, removePresetFrom } from "../components/you/presetRules";
import { usePresetEditor } from "../components/you/usePresetEditor";
import { identText } from "../components/you/youRules";
import "../components/you/sections.css";
import "./Presets.css";

export default function PresetsPage() {
  const phone = useIsPhone();
  useShellOptions(phone ? { back: { title: "Presets", href: "/you" } } : {});
  const auth = useAuth();
  const toast = useToast();
  const tune = useTune();
  const [, setParams] = useSearchParams();
  const editor = usePresetEditor();
  const keyed = editor.presets.filter((p) => p.key !== null);
  const more = editor.presets.filter((p) => p.key === null);

  const onMove = (from: number, to: number) => void editor.apply(moveKey(editor.current(), from, to));

  const remove = (stationId: string) => {
    const before = editor.current();
    const p = editor.presets.find((x) => x.station.id === stationId);
    void editor.apply(removePresetFrom(before, stationId)).then((ok) => {
      if (ok && p) toast.show({ message: `Removed ${identText(p.station)} from presets`, onUndo: () => void editor.apply(before) });
    });
  };

  const giveKey = (p: PresetView) => {
    const before = editor.current();
    const free = lowestFreeKey(before);
    // All six taken: the replace dialog asks which one to move.
    if (free === null) {
      setParams((q) => (q.set("modal", "replace-key"), q.set("station", p.station.id), q));
      return;
    }
    void editor.apply(placePreset(before, p.station.id, free)).then((ok) => {
      if (ok) toast.show({ message: `${identText(p.station)} is on key ${free}`, onUndo: () => void editor.apply(before) });
    });
  };

  return (
    <div className="vw-presets-page">
      {!phone && (
        <div className="vw-y-pg-h">
          <div>
            <h1>Presets</h1>
            <p>On keys 1 to 6 wherever you watch. Drag to reorder.</p>
          </div>
        </div>
      )}
      {phone && <p className="vw-presets-page__lede">On keys 1 to 6 wherever you watch. Drag to reorder.</p>}

      {!auth.signedIn && editor.presets.length > 0 && (
        <div className="vw-presets-page__device">
          <p>
            You have {editor.presets.length} on this {phone ? "phone" : "device"}. Keep {editor.presets.length === 1 ? "it" : "them"} on your TV too.
          </p>
          <Button size="sm" onClick={() => auth.openSignIn()}>
            Sign in
          </Button>
        </div>
      )}

      {editor.loading ? (
        <div className="vw-presets-page__loading" aria-busy="true" aria-label="Loading presets" />
      ) : (
        <PresetTiles presets={keyed} onTune={(id) => void tune(id)} onMove={onMove} onRemove={remove} />
      )}
      {!editor.loading && editor.presets.length === 0 && <p className="vw-y-quiet">Tune in to a station and press Add to presets.</p>}
      {editor.error && (
        <p className="vw-y-error" role="alert">
          {editor.error}
        </p>
      )}

      <section className="vw-y-sec" aria-labelledby="vw-more-h">
        <div className="vw-y-sec-top">
          <h2 id="vw-more-h">More presets</h2>
          <span className="vw-y-sec-top__sub">No key, same everywhere else</span>
        </div>
        {more.map((p) => (
          <div key={p.station.id} className="vw-y-more">
            <span className="vw-y-more__ch oc-ch">{p.station.channel}</span>
            <span className="vw-y-more__cs oc-cs">{p.station.callSign}</span>
            <button type="button" className="vw-y-more__w" onClick={() => void tune(p.station.id)} aria-label={`${identText(p.station)}, ${p.station.name}. Tune in`}>
              <b>{p.station.name}</b> <small>{p.row ? (p.row.now?.title ?? "Off air") : ""}</small>
            </button>
            <span className="vw-y-more__end">
              <Button size="sm" onClick={() => giveKey(p)}>
                Give it a key
              </Button>
              <Menu items={[{ label: "Remove", danger: true, onSelect: () => remove(p.station.id) }]} label={`More for ${identText(p.station)}`} />
            </span>
          </div>
        ))}
        {!editor.loading && more.length === 0 && <p className="vw-y-quiet">Stations saved with no key are kept here.</p>}
      </section>
    </div>
  );
}
