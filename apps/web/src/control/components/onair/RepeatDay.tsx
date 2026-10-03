// "Repeat this day" (A.4's pane, G8): the day becomes a template, every Saturday (the day's own
// weekday), weekdays, every day, or once onto a date. The four choices are the frame's segmented
// control; choosing one opens the dialog that makes the template (or changes the one built from
// this day) and then says what it made: dates made, and entries skipped where something was
// already on the log. Under it, the station's templates with their names, dates and edited dates,
// each changed (renamed, repeated differently) or stopped, and G7's one-time copies from before
// templates, which can still be taken off. On the log, `DayOrigin` says which template made a date
// and whether it was edited since (from the log's `days`, G11, so today and past days too).

import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { logApi, type DayTemplate, type LogDay, type TemplateGeneration } from "@opencast/contracts";
import { Button, Field, KeyValueList, Modal, Notice, Segmented, Sheet, useToast } from "@opencast/ui";
import { ApiError, call } from "../../../api/client";
import { LOG_READS, useTemplates } from "./data";
import { copyDetail, copyName, dayOriginOf, generationLines, oldCopies, repeatOptions, shortDate, templateBlocksText, templateDetail, templateName, type LogRepeat, type RepeatPattern } from "./templates";
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

type Open = { kind: "repeat"; pattern: RepeatPattern; template?: DayTemplate; day: Ymd } | { kind: "stop"; what: StopDialogProps["what"] } | null;

export interface RepeatDaySectionProps {
  stationId: string;
  /** The log's day. */
  day: Ymd;
  /** `getLog.repeats`: G7's copies (and templates, which the list reads from `listTemplates`). */
  repeats: LogRepeat[] | undefined;
  phone: boolean;
  /** Where a date opens on the log ("?day=2026-10-03"). */
  dateHref: (date: string) => string;
}

/** The pane's "Repeat this day": the four choices, then the station's templates. */
export function RepeatDaySection({ stationId, day, repeats, phone, dateHref }: RepeatDaySectionProps) {
  const templates = useTemplates(stationId);
  const [open, setOpen] = useState<Open>(null);
  const list = templates.data?.templates ?? [];
  // The template built from this day, if there is one: the choices show how it repeats.
  const own = [...list].reverse().find((t) => t.fromDay === isoDate(day));

  return (
    <section className="cc-log__sec" aria-labelledby="cc-log-repeat">
      <h2 className="cc-log__h" id="cc-log-repeat">
        Repeat this day
      </h2>
      <Segmented<RepeatPattern | "">
        label="Repeat this day"
        value={own?.pattern ?? ""}
        onChange={(v) => v && setOpen({ kind: "repeat", pattern: v, template: own, day })}
        options={repeatOptions(weekdayOf(day))}
      />
      <TemplateList stationId={stationId} repeats={repeats} phone={phone} dateHref={dateHref} />
      {open?.kind === "repeat" && <RepeatDialog stationId={stationId} day={open.day} template={open.template} pattern={open.pattern} phone={phone} onClose={() => setOpen(null)} />}
    </section>
  );
}

export interface TemplateListProps {
  stationId: string;
  /** `getLog.repeats`: G7's one-time copies, listed after the templates. Left out, none. */
  repeats?: LogRepeat[];
  phone: boolean;
  /** Where a date opens on the log ("?day=2026-10-03"). */
  dateHref: (date: string) => string;
  /** A246: the template picked out (the Templates tab's `/schedule/templates/:templateId`). */
  picked?: string;
  className?: string;
}

/**
 * The station's templates with their names, dates and edited dates, each changed (renamed,
 * repeated differently) or stopped, and G7's one-time copies. The log pane's Repeat this day and
 * (A246) the Schedule's Templates tab both list them.
 */
export function TemplateList({ stationId, repeats, phone, dateHref, picked, className = "cc-log__templates" }: TemplateListProps) {
  const templates = useTemplates(stationId);
  const [open, setOpen] = useState<Open>(null);
  const list = templates.data?.templates ?? [];
  const copies = oldCopies(repeats, list);

  const rows = [
    ...list.map((t) => {
      const next = t.dates[0];
      return {
        title: t.id === picked ? <span aria-current="true">{templateName(t)}</span> : templateName(t),
        detail: (
          <>
            {templateDetail(t)}
            {/* A244: its programming blocks. */}
            {templateBlocksText(t) && <span className="cc-log__tblocks">Blocks in this template: {templateBlocksText(t)}</span>}
            {next && (
              <>
                {" "}
                <Link to={dateHref(next.date)} className="cc-log__link">
                  Next {shortDate(next.date)}
                </Link>
              </>
            )}
          </>
        ),
        actions: (
          <>
            <Button variant="text" size="sm" onClick={() => setOpen({ kind: "repeat", pattern: t.pattern, template: t, day: fromIso(t.fromDay) })}>
              Change
            </Button>
            <Button variant="text" size="sm" onClick={() => setOpen({ kind: "stop", what: { kind: "template", template: t } })}>
              Stop
            </Button>
          </>
        )
      };
    }),
    ...copies.map((r) => ({
      title: copyName(r),
      detail: copyDetail(r),
      actions: (
        <Button variant="text" size="sm" onClick={() => setOpen({ kind: "stop", what: { kind: "copy", repeat: r } })}>
          Take off
        </Button>
      )
    }))
  ];

  return (
    <>
      {templates.isError && !(templates.error instanceof ApiError && templates.error.status === 404) && <p className="cc-log__quiet">{templates.error.message}</p>}
      {rows.length > 0 && <KeyValueList variant="rows" items={rows} className={className} />}
      {open?.kind === "repeat" && <RepeatDialog stationId={stationId} day={open.day} template={open.template} pattern={open.pattern} phone={phone} onClose={() => setOpen(null)} />}
      {open?.kind === "stop" && <StopDialog stationId={stationId} what={open.what} phone={phone} onClose={() => setOpen(null)} />}
    </>
  );
}

function fromIso(date: string): Ymd {
  const [year, month, d] = date.split("-").map(Number);
  return { year, month, day: d };
}

/**
 * On the log: the template a date was made from (the log's `days`, G11), and whether it was edited
 * since, or the one built from it. Today and past dates have started: changing the template
 * changes only the dates ahead.
 */
export function DayOrigin({ stationId, day, days }: { stationId: string; day: Ymd; days?: LogDay[] }) {
  const templates = useTemplates(stationId);
  const list = templates.data?.templates ?? [];
  const date = isoDate(day);
  const origin = dayOriginOf(days, list, date);
  if (origin) {
    const ahead = date > isoDate(broadcastDay(now()));
    return origin.edited ? (
      <Notice tone="plain" icon={null} title={`Made from ${origin.name}, then edited.`} detail="Changes to the template leave this date as it is." className="cc-log__origin" />
    ) : (
      <Notice tone="plain" icon={null} title={`Made from ${origin.name}.`} detail={ahead ? "Changing the template changes this date too." : undefined} className="cc-log__origin" />
    );
  }
  const built = list.filter((t) => t.fromDay === date);
  if (!built.length) return null;
  return <Notice tone="plain" icon={null} title={`${built.map(templateName).join(" and ")} ${built.length === 1 ? "repeats" : "repeat"} this day.`} className="cc-log__origin" />;
}
