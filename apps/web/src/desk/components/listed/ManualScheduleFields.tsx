// A241 (2026-10-01): "Enter it by hand", in List a source and Change: the weekly slots (day chips
// Mon to Sun, start and end times on the 5-minute grid, the title they publish and an optional
// description; add or remove a row), where it was checked (the published schedule's address and the
// day), and the dates it doesn't air. Times are the market's; an end before the start runs past
// midnight. The reference's form style: ruled cards of fields, chips that outline in ink when on.
import { useState } from "react";
import { WEEKDAY_SHORT, WEEKDAYS, clockRangeText, slotMinutes, type Weekday } from "@opencast/contracts";
import { Button, ChipRow, Field, IconButton } from "@opencast/ui";
import { emptySlot, type ManualDraft, type SlotDraft } from "./manual";
import "./ManualScheduleFields.css";

const DAY_OPTIONS = WEEKDAYS.map((d) => ({ value: d, label: WEEKDAY_SHORT[d] }));

/** "Pacific Time": the market's zone, in words. */
export function zoneName(timeZone: string): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longGeneric" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName");
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/** "Thu, Nov 26" for a `YYYY-MM-DD` date. */
const dayText = (date: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`));

/** Under the times: how long it runs, and past midnight when it does. */
function lengthNote(s: SlotDraft): string | null {
  const m = slotMinutes(s);
  if (m === null) return null;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const long = [h ? `${h} hr` : null, rest ? `${rest} min` : null].filter(Boolean).join(" ");
  return `${clockRangeText(s.start, s.end)}, ${long}${s.end < s.start ? ", past midnight" : ""}`;
}

export function ManualScheduleFields({ value: d, onChange, errors, timeZone }: { value: ManualDraft; onChange: (d: ManualDraft) => void; errors: Record<string, string>; timeZone: string }) {
  const [skip, setSkip] = useState("");
  const setSlot = (i: number, patch: Partial<SlotDraft>) => onChange({ ...d, slots: d.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const addSkip = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(skip) || d.skipDates.includes(skip)) return;
    onChange({ ...d, skipDates: [...d.skipDates, skip].sort() });
    setSkip("");
  };
  return (
    <div className="nd-manual">
      <p className="nd-form__note nd-manual__intro">
        Their weekly schedule, as they publish it. Times are {zoneName(timeZone)}; an end before the start runs past midnight. Titles are theirs: nothing is made up.
      </p>
      <ol className="nd-manual__slots" aria-label="Weekly schedule">
        {d.slots.map((s, i) => {
          const n = i + 1;
          const err = (f: string) => errors[`slots.${i}.${f}`];
          const length = lengthNote(s);
          return (
            <li key={s.key} className="nd-manual__slot" aria-label={`Slot ${n}`}>
              <div className="nd-manual__head">
                <span className="nd-form__label">Days</span>
                {d.slots.length > 1 && <IconButton icon="x" size="sm" bare label={`Remove slot ${n}${s.title.trim() ? `, ${s.title.trim()}` : ""}`} onClick={() => onChange({ ...d, slots: d.slots.filter((_, j) => j !== i) })} />}
              </div>
              <ChipRow multiple layout="wrap" label={`Days for slot ${n}`} options={DAY_OPTIONS} value={s.days} onChange={(days) => setSlot(i, { days: days as Weekday[] })} />
              {err("days") && <p className="nd-form__error nd-manual__err">{err("days")}</p>}
              <div className="nd-manual__times">
                <Field label="Starts" type="time" step={300} mono value={s.start} onChange={(e) => setSlot(i, { start: e.target.value })} error={err("start")} />
                <Field label="Ends" type="time" step={300} mono value={s.end} onChange={(e) => setSlot(i, { end: e.target.value })} error={err("end")} help={!err("end") && length ? length : undefined} />
              </div>
              <Field label="Title" help="As they publish it." maxLength={120} value={s.title} onChange={(e) => setSlot(i, { title: e.target.value })} error={err("title")} />
              <Field label="Description" labelAside="Optional" maxLength={300} value={s.description} onChange={(e) => setSlot(i, { description: e.target.value })} error={err("description")} />
              {(s.from || s.until) && (
                <p className="nd-form__note">
                  {s.from && s.until ? `In season ${dayText(s.from)} to ${dayText(s.until)}.` : s.from ? `From ${dayText(s.from)}.` : `Until ${dayText(s.until!)}.`}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {errors.slots && <p className="nd-form__error">{errors.slots}</p>}
      <div>
        <Button variant="ghost" size="sm" icon="plus" onClick={() => onChange({ ...d, slots: [...d.slots, emptySlot()] })}>
          Add a slot
        </Button>
      </div>
      <fieldset className="nd-manual__group">
        <legend className="nd-form__label">Where you checked it</legend>
        <div className="nd-form__pair">
          <Field label="Their published schedule" type="url" placeholder="https://" value={d.checkedAgainst} onChange={(e) => onChange({ ...d, checkedAgainst: e.target.value })} error={errors.checkedAgainst} />
          <Field label="Date checked" type="date" value={d.checkedOn} onChange={(e) => onChange({ ...d, checkedOn: e.target.value })} error={errors.checkedOn} />
        </div>
      </fieldset>
      <fieldset className="nd-manual__group">
        <legend className="nd-form__label">Dates it doesn't air</legend>
        <div className="nd-manual__skip">
          <Field label="Date" type="date" value={skip} onChange={(e) => setSkip(e.target.value)} help="Holidays and other days off." error={errors.skipDates} />
          <Button variant="ghost" size="sm" onClick={addSkip} disabled={!skip}>
            Add date
          </Button>
        </div>
        {d.skipDates.length > 0 && (
          <ul className="nd-manual__dates" aria-label="Dates it doesn't air">
            {d.skipDates.map((date) => (
              <li key={date}>
                <span>{dayText(date)}</span>
                <IconButton icon="x" size="sm" bare label={`Remove ${dayText(date)}`} onClick={() => onChange({ ...d, skipDates: d.skipDates.filter((x) => x !== date) })} />
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </div>
  );
}
