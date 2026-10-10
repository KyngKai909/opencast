// Programming Phase 3: "What airs" for a program slot in a day template (the template editor's
// pane, under the program; the Add drawer's template mode has its own, whatAirs.ts has the words).
// A segmented control (This episode, Next episode, Fill the slot, Same as earlier slot), then for a
// walking slot its programs (one, or a mix), the order as a select and what happens at the end; for
// a rerun, the slot it repeats. Under it, the API's preview line ("Next 4 Saturdays: ep. 13, 14,
// 15, 16"), from where the slot's walk is.

import { useQuery } from "@tanstack/react-query";
import { logApi, type DayTemplateEntryInput, type Program } from "@opencast/contracts";
import { Checkbox, Segmented, SelectField } from "@opencast/ui";
import { call, type ApiError } from "../../../api/client";
import { AT_END_OPTIONS, WHAT_AIRS_OPTIONS, orderOptions, settingInput, settingProblem, withWhatAirs, type SlotSetting } from "./whatAirs";

/** The preview line for a slot as the editor has it (saved or not). Nothing for This episode, or while it misses something. */
export function useSlotPreview(stationId: string, templateId: string | null, entry: DayTemplateEntryInput | null) {
  const body = entry && templateId ? { entry } : null;
  return useQuery<{ line: string }, ApiError>({
    queryKey: ["slot-preview", stationId, templateId, JSON.stringify(body)],
    queryFn: () => call(logApi.previewTemplateSlot, { params: { stationId, templateId: templateId! }, body: body! }),
    enabled: !!body,
    placeholderData: (prev) => prev,
    retry: false,
    staleTime: 30_000
  });
}

/** A slot's entry, as the preview takes it: its time and length, what airs. */
export function previewEntry(o: { startTime: string; lengthMs: number; itemId?: string | null; slotId?: string | null }, s: SlotSetting): DayTemplateEntryInput | null {
  if (s.whatAirs === "this_episode" || settingProblem(s)) return null;
  return { startTime: o.startTime, lengthMs: o.lengthMs, kind: "program", ...(o.itemId ? { itemId: o.itemId } : {}), ...settingInput(s, o.slotId) };
}

export interface WhatAirsProps {
  stationId: string;
  templateId: string;
  /** The slot: its start ("20:00"), length, item, program and saved slot id. */
  slot: { startTime: string; lengthMs: number; itemId: string | null; programId: string | null; slotId: string | null };
  setting: SlotSetting;
  /** The station's programs (not live), for a walk. */
  programs: Array<Pick<Program, "id" | "title">>;
  /** Earlier program slots on the template, for Same as earlier slot. */
  earlier: Array<{ slotId: string; label: string }>;
  onChange: (s: SlotSetting) => void;
}

export function WhatAirsSection({ stationId, templateId, slot, setting: s, programs, earlier, onChange }: WhatAirsProps) {
  const walking = s.whatAirs === "next_episode" || s.whatAirs === "fill";
  const problem = settingProblem(s);
  const preview = useSlotPreview(stationId, templateId, previewEntry(slot, s));
  const options = WHAT_AIRS_OPTIONS.map((o) => (o.value === "same_as" ? { ...o, disabled: !earlier.length } : o));
  const orders = orderOptions(s.programIds.length);
  const toggle = (id: string, on: boolean) => {
    const programIds = on ? [...s.programIds, id] : s.programIds.filter((p) => p !== id);
    // Marathon and Shuffle shows are for a mix.
    const order = programIds.length < 2 && (s.order === "marathon" || s.order === "shuffle_shows") ? "in_order" : s.order;
    onChange({ ...s, programIds, order });
  };
  return (
    <section className="cc-log__sec cc-whatairs" aria-label="What airs">
      <h3 className="cc-whatairs__h">What airs</h3>
      <Segmented label="What airs" size="sm" options={options} value={s.whatAirs} onChange={(v) => onChange(withWhatAirs(s, v, slot.programId))} className="cc-whatairs__seg" />
      {walking && (
        <>
          <fieldset className="cc-whatairs__progs">
            <legend>{s.programIds.length > 1 ? "Programs (a mix)" : "Program"}</legend>
            {programs.map((p) => (
              <Checkbox key={p.id} ruled={false} checked={s.programIds.includes(p.id)} onChange={(on) => toggle(p.id, on)} label={p.title} />
            ))}
          </fieldset>
          <SelectField label="Order" size="sm" value={s.order} onChange={(e) => onChange({ ...s, order: e.target.value as SlotSetting["order"] })} help={orders.find((o) => o.value === s.order)?.meaning}>
            {orders.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
          <div className="cc-whatairs__end">
            <span>At the end</span>
            <Segmented label="At the end of the program" size="sm" options={AT_END_OPTIONS} value={s.atEnd} onChange={(atEnd) => onChange({ ...s, atEnd })} />
          </div>
        </>
      )}
      {s.whatAirs === "same_as" && (
        <SelectField label="Repeats" size="sm" value={s.sameAsSlotId ?? ""} onChange={(e) => onChange({ ...s, sameAsSlotId: e.target.value || null })}>
          <option value="">Choose an earlier slot</option>
          {earlier.map((x) => (
            <option key={x.slotId} value={x.slotId}>
              {x.label}
            </option>
          ))}
        </SelectField>
      )}
      {s.whatAirs !== "this_episode" && (
        <p className={problem || preview.error ? "cc-log__err" : "cc-whatairs__preview"} aria-live="polite">
          {problem ?? preview.error?.message ?? preview.data?.line ?? " "}
        </p>
      )}
    </section>
  );
}
