// Making a day template and stopping one (G8): "Make a template from this day" on the Log and "New
// template" on the Templates tab open RepeatDialog: the day becomes a template, every Saturday (the
// day's own weekday), weekdays, every day, or once onto a date, then it says what it made (dates
// made, entries skipped where something was already on the log). The Templates tab's "Change how
// it repeats" opens it for a template; "Stop repeating" opens StopDialog. A246 (Phase 4): the list
// of templates is the Templates tab's cards (TemplatesTab.tsx); the pane's "Repeat this day" and
// the log's notice of where a date came from went with the Log's rundown and template chip.

import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { logApi, type DayTemplate, type TemplateGeneration } from "@opencast/contracts";
import { Button, Field, KeyValueList, Modal, Segmented, Sheet, useToast } from "@opencast/ui";
import { ApiError, call } from "../../../api/client";
import { LOG_READS } from "./data";
import { copyName, generationLines, repeatOptions, templateName, type LogRepeat, type RepeatPattern } from "./templates";
import { DAY_WORDS, addDays, broadcastDay, isoDate, localTime, monthDay, weekdayOf, type Ymd } from "./time";
import { now } from "../../../lib/clock";

/** The frame's note under the choices ("Build a day once"). */
const TEMPLATE_NOTE = "Changing one date changes only that date; changing the template changes every future repeat.";

function useRefresh() {
  const qc = useQueryClient();
  return () => Promise.all(LOG_READS.map((e) => qc.invalidateQueries({ queryKey: [e.method, e.path] })));
}

/** A modal on the web, a sheet on the phone, with the same content. */
function Dialog({ phone, ...props }: { phone: boolean; open: boolean; onClose: () => void; title?: ReactNode; eyebrow?: ReactNode; subtitle?: ReactNode; footer?: ReactNode; children?: ReactNode }) {
  return phone ? <Sheet showClose {...props} /> : <Modal width={440} {...props} />;
}

export interface RepeatDialogProps {
  stationId: string;
  /** The day it's built from (the log's day, or the template's). */
  day: Ymd;
  /** Changing a template (the one built from this day, or one from the list). */
  template?: DayTemplate;
  /** The choice that opened it. */
  pattern: RepeatPattern;
  phone: boolean;
  onClose: () => void;
}

/** Makes a day template, or changes one, then says what it made. */
export function RepeatDialog({ stationId, day, template, pattern: first, phone, onClose }: RepeatDialogProps) {
  const refresh = useRefresh();
  const weekday = template?.weekday ?? weekdayOf(day);
  const tomorrow = isoDate(addDays(broadcastDay(now()), 1));
  const [pattern, setPattern] = useState<RepeatPattern>(first);
  const [onto, setOnto] = useState(template?.onDate ?? "");
  const [until, setUntil] = useState(template?.pattern !== "once" ? (template?.until ?? "") : "");
  const [name, setName] = useState(template?.name ?? "");
  const [error, setError] = useState<{ message: string; field: "onto" | "until" | null } | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ label: string; generated: TemplateGeneration } | null>(null);

  const once = pattern === "once";
  const submit = async () => {
    setError(null);
    if (once && !onto) {
      setError({ message: "Choose the day to copy to.", field: "onto" });
      return;
    }
    setPending(true);
    try {
      const r = template
        ? await call(logApi.updateTemplate, {
            params: { stationId, templateId: template.id },
            body: {
              pattern,
              ...(pattern === "weekly" ? { weekday } : {}),
              ...(once ? { onto } : { until: until || null }),
              ...((template.name ?? "") !== name.trim() ? { name: name.trim() || null } : {})
            }
          })
        : await call(logApi.createTemplate, {
            params: { stationId },
            body: { fromDay: isoDate(day), pattern, ...(pattern === "weekly" ? { weekday } : {}), ...(once ? { onto } : until ? { until } : {}) }
          });
      setResult({ label: templateName(r.template), generated: r.generated });
      void refresh();
    } catch (e) {
      const field = e instanceof ApiError && e.fields ? ((["onto", "until"] as const).find((f) => e.fields![f]) ?? null) : null;
      setError({ message: e instanceof Error ? e.message : "Something went wrong. Try again.", field });
    } finally {
      setPending(false);
    }
  };

  if (result) {
    const g = result.generated;
    return (
      <Dialog
        phone={phone}
        open
        onClose={onClose}
        eyebrow="Repeat this day"
        title={result.label}
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <KeyValueList items={generationLines(g)} />
        {g.skippedForConflicts > 0 && <p className="cc-log__note">Entries that overlap something already on a date are skipped there.</p>}
      </Dialog>
    );
  }

  return (
    <Dialog
      phone={phone}
      open
      onClose={onClose}
      eyebrow={template ? "Repeat this day" : `${DAY_WORDS[weekdayOf(day)]}, ${monthDay(localTime(day, 12))}`}
      title={template ? templateName(template) : "Repeat this day"}
      footer={
        <>
          <Button variant="primary" onClick={() => void submit()} disabled={pending}>
            {template ? "Save" : "Repeat this day"}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="cc-rep">
        <Segmented label="Repeats" value={pattern} onChange={(v) => (setPattern(v), setError(null))} options={repeatOptions(weekday)} className="cc-rep__seg" />
        {once ? (
          <Field label="Copy to" type="date" value={onto} min={tomorrow} onChange={(e) => setOnto(e.target.value)} error={error?.field === "onto" ? error.message : undefined} />
        ) : (
          <Field label="Until" type="date" value={until} min={tomorrow} onChange={(e) => setUntil(e.target.value)} help="Leave it empty to keep repeating." error={error?.field === "until" ? error.message : undefined} />
        )}
        {template && <Field label="Name" value={name} maxLength={60} placeholder={template.label} onChange={(e) => setName(e.target.value)} />}
        <p className="cc-log__note">{TEMPLATE_NOTE}</p>
        {error && !error.field && (
          <p className="cc-log__err" role="alert">
            {error.message}
          </p>
        )}
      </div>
    </Dialog>
  );
}

export interface StopDialogProps {
  stationId: string;
  /** A day template (removeTemplate), or a one-time copy from before templates (removeRepeat). */
  what: { kind: "template"; template: DayTemplate } | { kind: "copy"; repeat: LogRepeat };
  phone: boolean;
  onClose: () => void;
}

/** "Stop repeating Every Saturday?": its future dates that weren't edited are cleared. */
export function StopDialog({ stationId, what, phone, onClose }: StopDialogProps) {
  const toast = useToast();
  const refresh = useRefresh();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = what.kind === "template" ? templateName(what.template) : copyName(what.repeat);
  const stop = async () => {
    setPending(true);
    setError(null);
    try {
      const r =
        what.kind === "template"
          ? await call(logApi.removeTemplate, { params: { stationId, templateId: what.template.id } })
          : await call(logApi.removeRepeat, { params: { stationId, repeatId: what.repeat.id } });
      toast.show({ message: `${name} stopped. ${r.removed} ${r.removed === 1 ? "entry" : "entries"} came off the log.` });
      void refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      phone={phone}
      open
      onClose={onClose}
      title={`Stop repeating ${name}?`}
      subtitle="Future dates that weren't edited will be cleared. What already aired stays in the as-run log."
      footer={
        <>
          <Button variant="primary" onClick={() => void stop()} disabled={pending}>
            Stop repeating
          </Button>
          <Button onClick={onClose}>Keep it</Button>
        </>
      }
    >
      {error && (
        <p className="cc-log__err" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
