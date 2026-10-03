// A243 (2026-10-02): on a library item's page, a bumper's role ("Role": Any, Into a break, Out of
// a break, Up next) and, for bumpers, station IDs, openers and closers, when it airs ("When it
// airs": any time, between dates, at times of day, or both). No frame draws them: rows and words
// like the item page's own. Each change is saved at once (the role) or with Save (the window).

import { useEffect, useState } from "react";
import { libraryApi, type AirWindow, type BumperRole, type LibraryItem } from "@opencast/contracts";
import { Button, Checkbox, Field, KeyValueList, Segmented, SelectField, useToast } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { call } from "../../../api/client";
import { now as clockNow } from "../../../lib/clock";
import { SecTop } from "./Studio";
import { refreshLibrary } from "./LibraryParts";
import { airsSummary, BUMPER_ROLES, notAiringLine, RADIO_UP_NEXT, ROLE_HELP, ROLE_WORDS, roleOf } from "./bumpers";

/** The types that have a window (when they may air). */
export const WINDOWED = ["BMP", "SID", "OPN", "CLS"];

async function save(itemId: string, body: { bumperRole?: BumperRole | null; airs?: AirWindow | null }) {
  await call(libraryApi.updateItem, { params: { itemId }, body });
}

export function BumperRoleSection({ item, radio, canEdit }: { item: LibraryItem; radio: boolean; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [role, setRole] = useState<BumperRole>(roleOf(item));
  useEffect(() => setRole(roleOf(item)), [item]);
  const pick = async (next: BumperRole) => {
    const was = role;
    setRole(next);
    try {
      await save(item.id, { bumperRole: next === "any" ? null : next });
      await refreshLibrary(qc);
    } catch (e) {
      setRole(was);
      toast.show({ message: e instanceof Error ? e.message : "Something went wrong. Try again." });
    }
  };
  return (
    <section className="cc-item__side" aria-labelledby="cc-role-h">
      <SecTop id="cc-role-h" title="Role" />
      <div className="cc-item__role">
        <Segmented<BumperRole> label="Role" size="sm" value={role} options={BUMPER_ROLES.map((r) => ({ value: r, label: ROLE_WORDS[r], disabled: !canEdit }))} onChange={(r) => void pick(r)} />
        <small className="cc-item__quiet">{ROLE_HELP[role]}</small>
        {radio && role === "up_next" && <small className="cc-item__quiet">{RADIO_UP_NEXT}</small>}
      </div>
    </section>
  );
}

type Draft = { dates: boolean; from: string; until: string; noEnd: boolean; times: boolean; dailyFrom: string; dailyUntil: string };

const draftOf = (w: AirWindow | null | undefined): Draft => ({
  dates: !!(w?.from || w?.until),
  from: w?.from ?? "",
  until: w?.until ?? "",
  noEnd: !!w?.from && !w?.until,
  times: !!w?.dailyFrom,
  dailyFrom: w?.dailyFrom ?? "18:00",
  dailyUntil: w?.dailyUntil ?? "02:00"
});

const windowOf = (d: Draft): AirWindow | null => {
  const dates = d.dates && (d.from || d.until);
  if (!dates && !d.times) return null;
  return { from: dates ? d.from || null : null, until: dates && !d.noEnd ? d.until || null : null, dailyFrom: d.times ? d.dailyFrom : null, dailyUntil: d.times ? d.dailyUntil : null };
};

export function AirWindowSection({ item, canEdit }: { item: LibraryItem; canEdit: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(draftOf(item.airs));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(draftOf(item.airs)), [item]);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const next = windowOf(draft);
  const changed = JSON.stringify(next) !== JSON.stringify(item.airs ?? null);
  const status = notAiringLine(item.airs, clockNow());
  const submit = async () => {
    setError(null);
    try {
      await save(item.id, { airs: next });
      await refreshLibrary(qc);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    }
  };
  return (
    <section className="cc-item__side" aria-labelledby="cc-airs-h">
      <SecTop id="cc-airs-h" title="When it airs" />
      <KeyValueList variant="rows" items={[{ title: airsSummary(item.airs), detail: status ?? (item.airs ? "Airing now" : "Wherever it's wanted") }]} />
      <div className="cc-item__airsform">
        <Checkbox checked={!draft.dates && !draft.times} label="Any time" disabled={!canEdit} onChange={(on) => on && set({ dates: false, times: false })} />
        <Checkbox checked={draft.dates} label="Between dates" disabled={!canEdit} onChange={(dates) => set({ dates })} />
        {draft.dates && (
          <div className="cc-item__pair">
            <Field label="From" type="date" size="sm" value={draft.from} disabled={!canEdit} onChange={(e) => set({ from: e.target.value })} />
            <Field label="To" type="date" size="sm" value={draft.noEnd ? "" : draft.until} disabled={!canEdit || draft.noEnd} onChange={(e) => set({ until: e.target.value })} />
            <Checkbox ruled={false} checked={draft.noEnd} label="No end" disabled={!canEdit} onChange={(noEnd) => set({ noEnd })} />
          </div>
        )}
        <Checkbox checked={draft.times} label="At times of day" disabled={!canEdit} onChange={(times) => set({ times })} />
        {draft.times && (
          <div className="cc-item__pair">
            <Field label="From" type="time" size="sm" value={draft.dailyFrom} disabled={!canEdit} onChange={(e) => set({ dailyFrom: e.target.value })} />
            <Field label="To" type="time" size="sm" value={draft.dailyUntil} disabled={!canEdit} help="Past midnight is fine." onChange={(e) => set({ dailyUntil: e.target.value })} />
          </div>
        )}
        {canEdit && (
          <Button size="sm" variant="primary" disabled={!changed} onClick={() => void submit()}>
            Save
          </Button>
        )}
        {error && (
          <p className="cc-item__quiet" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * A244: "Part of a block", for bumpers, station IDs, openers and closers: "None, it's BEAT's" or
 * one of the station's programming blocks. Saved at once. The helper says what that means for the
 * type: "Airs only during Late Crate Nights.", "Airs as Late Crate Nights' ID.", "Its intro".
 */
export function BlockSection({ item, callSign, blocks, canEdit }: { item: LibraryItem; callSign: string; blocks: Array<{ id: string; name: string }>; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState(item.programBlockId ?? "");
  useEffect(() => setValue(item.programBlockId ?? ""), [item]);
  const type = item.identCode ?? item.code;
  const name = blocks.find((b) => b.id === value)?.name;
  const helper = !name ? null : type === "SID" ? `Airs as ${name}'${name.endsWith("s") ? "" : "s"} ID.` : type === "OPN" ? "Its intro" : type === "CLS" ? "Its outro" : `Airs only during ${name}.`;
  const pick = async (next: string) => {
    const was = value;
    setValue(next);
    try {
      await call(libraryApi.updateItem, { params: { itemId: item.id }, body: { programBlockId: next || null } });
      await refreshLibrary(qc);
    } catch (e) {
      setValue(was);
      toast.show({ message: e instanceof Error ? e.message : "Something went wrong. Try again." });
    }
  };
  if (!blocks.length && !item.programBlockId) return null;
  return (
    <section className="cc-item__side" aria-labelledby="cc-block-h">
      <SecTop id="cc-block-h" title="Part of a block" />
      <div className="cc-item__role">
        <SelectField label="Block" size="sm" value={value} disabled={!canEdit} onChange={(e) => void pick(e.target.value)}>
          <option value="">None, it's {callSign}'s</option>
          {blocks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </SelectField>
        {helper && <small className="cc-item__quiet">{helper}</small>}
      </div>
    </section>
  );
}
