// A248 (2026-10-06): "A spreadsheet", in List a source and Change: their schedule from a
// spreadsheet's link (a Google Sheet, published or shared with anyone with the link, or a .csv,
// .tsv, .xlsx or .ods file's address, read again every hour) or a file uploaded here ("Upload a
// spreadsheet": kept as what's read from it). The times' zone: worked out (the sheet's, else the
// market's) or chosen. "Check it" reads it now without saving (A241's rule that nothing is made
// up, shown before it's saved): what was read, the tab, the zone and why, the cells it skipped,
// and the first airings to come. A sheet that isn't public says so, and how to fix it.
import { useRef, useState } from "react";
import { networkApi, SHEET_FILE_MAX_BYTES, type ListedSource, type Market, type SchedulePreview, type SheetRead } from "@opencast/contracts";
import { Button, clock, clockRange, Field, Notice, Segmented, SelectField } from "@opencast/ui";
import { ApiError } from "../../../api/client";
import { useApiMutation } from "../../../api/hooks";
import { dayMonth } from "../../lib/dates";
import { errorText } from "../../pages/common";
import { datesPassed, fileWords, isSharedGoogleLink, isSheetLink, NOT_PUBLIC_HELP, SHEET_ACCEPT, sheetSummary, skippedWords, tabWords, ZONE_FROM_WORDS, zoneOptions, zoneShort, zonesNamedWords } from "./sheets";
import "./SheetScheduleFields.css";

export interface SheetDraft {
  from: "link" | "file";
  url: string;
  /** A file chosen to upload (not sent until saved). */
  file: File | null;
  /** A workbook's tab, by name ("" for the first). */
  tab: string;
  /** The listing's own time zone for it ("" works it out). */
  timeZone: string;
}

/** The fields for a listing (its spreadsheet, if it has one), or fresh ones. */
export function sheetDraftOf(s?: ListedSource): SheetDraft {
  const sc = s?.schedule;
  const file = sc?.source === "file";
  return {
    from: file ? "file" : "link",
    url: !file && sc?.format === "sheet" ? (s?.calendarUrl ?? "") : "",
    file: null,
    tab: file ? (sc?.sheet?.tab ?? "") : "",
    timeZone: sc?.timeZone ?? ""
  };
}

/** What's wrong with the fields, by field ("sheetUrl", "sheetFile"); empty when they can be saved. */
export function sheetProblems(d: SheetDraft, editing?: ListedSource): Record<string, string> {
  if (d.from === "link") return isSheetLink(d.url) ? {} : { sheetUrl: "Paste the link to their spreadsheet: a Google Sheet, or a .csv, .tsv, .xlsx or .ods file." };
  if (d.file) return d.file.size > SHEET_FILE_MAX_BYTES ? { sheetFile: "Use a file of 2 MB or less." } : {};
  return editing?.schedule?.source === "file" ? {} : { sheetFile: "Choose their spreadsheet file." };
}

/** "Fri Oct 9, 6:00 to 6:25 am" in the zone the sheet was read in. */
function airingText(a: SchedulePreview["airings"][number], tz: string): string {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(a.startsAt));
  const when = a.endsAt ? clockRange(a.startsAt, a.endsAt, { timeZone: tz }) : clock(a.startsAt, { timeZone: tz });
  return `${day} ${dayMonth(a.startsAt, tz, { short: true })}, ${when}`;
}

/** What was read, in words: the summary, the tab, the zone and why, what was skipped, days passed. */
export function SheetReadLines({ sheet, today, upload }: { sheet: SheetRead; today: string; upload: boolean }) {
  const skipped = skippedWords(sheet);
  const passed = datesPassed(sheet, today, upload);
  const tab = tabWords(sheet);
  const several = zonesNamedWords(sheet);
  return (
    <div className="nd-sheet__read">
      <p className="nd-sheet__summary">{sheetSummary(sheet)}.</p>
      <ul className="nd-sheet__facts">
        {tab && <li>Tab: {tab}</li>}
        <li>
          Times in {zoneShort(sheet.timeZone)}: {ZONE_FROM_WORDS[sheet.timeZoneFrom]}
        </li>
        {several && <li>{several}</li>}
      </ul>
      {passed && <p className="nd-form__error">{passed}</p>}
      {skipped && (
        <details className="nd-sheet__skipped">
          <summary>{skipped.title}: nothing was guessed for them</summary>
          <ul>
            {skipped.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function SheetScheduleFields({
  value: d,
  onChange,
  errors,
  market,
  editing,
  today
}: {
  value: SheetDraft;
  onChange: (d: SheetDraft) => void;
  errors: Record<string, string>;
  market: Market;
  editing?: ListedSource;
  /** The market's date today (YYYY-MM-DD), for a sheet whose days have passed. */
  today: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const preview = useApiMutation(networkApi.previewListedSchedule);
  const [result, setResult] = useState<SchedulePreview | null>(null);
  const [problem, setProblem] = useState<{ notPublic: boolean; text: string } | null>(null);
  const marketZone = market.timezone || "America/Los_Angeles";
  const set = (patch: Partial<SheetDraft>) => {
    setResult(null);
    setProblem(null);
    onChange({ ...d, ...patch });
  };
  const file = editing?.schedule?.source === "file" ? editing.schedule.file : null;
  // Before a check, what was read last time (the same link, or the file it has).
  const same = d.from === "link" ? !!editing && editing.schedule?.format === "sheet" && d.url.trim() === (editing.calendarUrl ?? "") : !!file && !d.file;
  const lastRead = same ? (editing?.schedule?.sheet ?? null) : null;
  const tabs = result?.sheet?.tabs ?? (d.from === "file" && !d.file ? (editing?.schedule?.sheet?.tabs ?? []) : []);

  const check = async () => {
    setProblem(null);
    setResult(null);
    const bad = sheetProblems(d, editing);
    if (Object.keys(bad).length || (d.from === "file" && !d.file)) return setProblem({ notPublic: false, text: Object.values(bad)[0] ?? "Choose a file to check." });
    try {
      const body = {
        ...(d.from === "link" ? { calendarUrl: d.url.trim(), calendarFormat: "sheet" as const } : { file: d.file!, ...(d.tab ? { sheet: d.tab } : {}) }),
        ...(d.timeZone ? { timeZone: d.timeZone } : {}),
        ...(editing ? { sourceId: editing.id } : { marketId: market.id })
      };
      setResult(await preview.mutateAsync({ body }));
    } catch (err) {
      setProblem({ notPublic: err instanceof ApiError && err.code === "not_public", text: errorText(err) });
    }
  };

  return (
    <div className="nd-sheet">
      <div>
        <span className="nd-form__label">Where it is</span>
        <Segmented
          label="Where it is"
          value={d.from}
          onChange={(v) => set({ from: v })}
          options={[
            { value: "link", label: "A link" },
            { value: "file", label: "Upload a spreadsheet" }
          ]}
        />
      </div>
      {d.from === "link" ? (
        <Field
          label="Spreadsheet link"
          type="url"
          placeholder="https://docs.google.com/spreadsheets/…"
          help="A Google Sheet, published to the web or shared with anyone with the link, or a link to a .csv, .tsv, .xlsx or .ods file. Read again every hour. A tab in the link is the one read."
          value={d.url}
          onChange={(e) => set({ url: e.target.value })}
          error={errors.sheetUrl}
        />
      ) : (
        <div className="nd-sheet__file">
          <span className="nd-form__label" id="nd-sheet-file">
            Spreadsheet file
          </span>
          <div className="nd-sheet__pick">
            <Button size="sm" icon="upload" onClick={() => input.current?.click()} aria-describedby="nd-sheet-file-name">
              {d.file || file ? "Upload another" : "Upload a spreadsheet"}
            </Button>
            <span className="nd-sheet__name" id="nd-sheet-file-name">
              {d.file ? d.file.name : file ? `Now: ${fileWords(file, dayMonth(file.uploadedAt, marketZone, { short: true }))}` : "No file chosen"}
            </span>
            <input
              ref={input}
              type="file"
              hidden
              aria-labelledby="nd-sheet-file"
              accept={SHEET_ACCEPT}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f) set({ file: f, tab: "" });
                e.target.value = "";
              }}
            />
          </div>
          <p className="nd-form__note">An .xlsx, .ods, .csv or .tsv file, 2 MB at most. What's read from it is kept, not the file: upload it again when their schedule changes. Formulas and macros are never run.</p>
          {errors.sheetFile && <p className="nd-form__error">{errors.sheetFile}</p>}
        </div>
      )}
      <div className={d.from === "file" && tabs.length > 1 ? "nd-sheet__pair" : undefined}>
        <SelectField label="Times in" value={d.timeZone} onChange={(e) => set({ timeZone: e.target.value })} help={`Worked out: the zone the sheet names, else the market's (${zoneShort(marketZone)}).`}>
          <option value="">Work it out</option>
          {zoneOptions(marketZone, d.timeZone).map((z) => (
            <option key={z.value} value={z.value}>
              {z.label}
            </option>
          ))}
        </SelectField>
        {d.from === "file" && tabs.length > 1 && (
          <SelectField label="Tab" value={d.tab} onChange={(e) => set({ tab: e.target.value })}>
            <option value="">The first ({tabs[0]})</option>
            {tabs.slice(1).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </SelectField>
        )}
      </div>
      <div className="nd-sheet__check">
        <Button size="sm" onClick={() => void check()} disabled={preview.isPending}>
          {preview.isPending ? "Reading…" : "Check it"}
        </Button>
        <span className="nd-form__note nd-sheet__checknote">Reads it now and shows what it gives. Nothing is saved.</span>
      </div>
      {problem &&
        (problem.notPublic ? (
          <Notice tone="standby" title="This sheet isn't public" detail={NOT_PUBLIC_HELP} />
        ) : (
          <p className="nd-form__error" role="alert">
            {problem.text}
          </p>
        ))}
      {!problem && d.from === "link" && isSharedGoogleLink(d.url) && !result && !lastRead && (
        <p className="nd-form__note">A link for editing works only when the sheet is shared with anyone with the link. Publishing it to the web works too.</p>
      )}
      {result?.sheet && (
        <section className="nd-sheet__result" aria-label="What was read">
          <SheetReadLines sheet={result.sheet} today={today} upload={d.from === "file"} />
          {result.airings.length > 0 && (
            <>
              <p className="nd-sheet__next">
                {result.upcoming} {result.upcoming === 1 ? "airing" : "airings"} to come{result.sheet.weekly ? " in the next 14 days" : ""}. The first {result.airings.length}, in {zoneShort(result.timeZone)} time:
              </p>
              <ol className="nd-sheet__airings" aria-label="The first airings">
                {result.airings.map((a) => (
                  <li key={`${a.startsAt}${a.title}`}>
                    <span className="nd-sheet__when">{airingText(a, result.timeZone)}</span>
                    <span>{a.title}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}
      {!result && !problem && lastRead && (
        <section className="nd-sheet__result" aria-label="Last read">
          <SheetReadLines sheet={lastRead} today={today} upload={d.from === "file"} />
        </section>
      )}
    </div>
  );
}
