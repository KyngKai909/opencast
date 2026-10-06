// List a source (05.1's button; the form isn't drawn; reworked in follow-up Phase 6): an external
// station on a channel in this market, playing the source's own stream one of two ways. Its
// official embed, where their terms allow embedding (the terms page and the day it was checked), or
// its stream link, with their written permission or as a clearly public source. Without the
// evidence it's saved but waits. What's on comes from their calendar or schedule feed, or guide
// data checked against their published schedule; with neither, the banner says Live. A pipeline
// lead (an IPTV-list channel) comes prefilled.
//
// A215: "Change" in a listing's details opens this form prefilled (`editing`): its name, what it
// shows, the address, how it plays, their terms, what's on, and its channel and call sign. Evidence
// is recorded on its own (Record evidence); the form says plainly, before saving, when the change
// takes the station off the dial until new evidence is recorded.
//
// A229: on X.n beside an external station on X.1, "Same brand as 15.1 RIVC (share its call sign)",
// on by default: the call sign is X.1's and the channel tells them apart. Off, it takes its own.
// Changing X.1's call sign changes its family's: the button names how many, and the form names them.
//
// A241 (2026-10-01): What's on has three choices. "Its feed": the address (iCal, RSS, JSON, XMLTV
// or a webpage with event data), its format (worked out, or chosen), and guide data checked against
// the published schedule as a tick under it. "Enter it by hand": the weekly slots, where it was
// checked and the dates it doesn't air (ManualScheduleFields). "None". A page with no event data
// says so, and offers entering it by hand.
//
// A248 (2026-10-06): and "A spreadsheet" (SheetScheduleFields): a Google Sheet's link (or a .csv,
// .tsv, .xlsx or .ods file's), saved as a feed in the format `sheet`, or a file uploaded once the
// listing is saved (a new listing is listed first, then its file uploaded); its zone, worked out or
// chosen; "Check it" first, to see what's read.
import { useState, type FormEvent } from "react";
import { networkApi, ScheduleFormat, type ListedScheduleInput, type ListedSource, type Market } from "@opencast/contracts";
import { Button, Checkbox, Field, Modal, Notice, Segmented, SelectField, TextAreaField, useToast } from "@opencast/ui";
import { ApiError } from "../../../api/client";
import { useApiMutation } from "../../../api/hooks";
import { errorText } from "../../pages/common";
import { callSignProblem } from "../setup/draft";
import { complete, EmbedEvidenceFields, emptyEvidence, evidenceInput, evidenceProblems, isLink, NoteField, StreamEvidenceFields, type EvidenceDraft } from "./EvidenceFields";
import { changeWarning, familyCallSignChange, familyHeadFor, FORMAT_LABELS, NO_EVENT_DATA, onceWords, playsOf, sameBrandLabel, type Plays } from "./external";
import { manualChanged, manualDraftOf, manualInput, manualProblems, type ManualDraft } from "./manual";
import { ManualScheduleFields } from "./ManualScheduleFields";
import { sheetDraftOf, sheetProblems, SheetScheduleFields, type SheetDraft } from "./SheetScheduleFields";
import { localDate } from "../../lib/dates";
import { useNow } from "../../../lib/clock";
import { channelText } from "./SourceStatus";
import "../pipeline/forms.css";

type Schedule = "feed" | "guide" | "sheet" | "manual" | "none";
type Format = ScheduleFormat | "";

export interface ListSourcePrefill {
  name?: string;
  description?: string;
  streamUrl?: string;
  plays?: Plays;
  /** The pipeline lead becoming this external station. */
  creatorId?: string;
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s.trim());

/** The form's fields for a listing as it is (A215's Change). */
function draftOf(s: ListedSource) {
  const source = s.schedule?.source ?? (s.calendarUrl ? "feed" : "none");
  // A248: a spreadsheet's link (a feed in the format `sheet`) or an uploaded file.
  const sheet = source === "file" || (source === "feed" && s.schedule?.format === "sheet");
  return {
    name: s.name,
    description: s.description ?? "",
    band: (s.station.band ?? "tv") as "tv" | "radio",
    channel: s.station.channel ?? "",
    callSign: s.station.callSign ?? "",
    plays: playsOf(s),
    streamUrl: s.streamUrl,
    schedule: (sheet ? "sheet" : source === "guide_data" ? "guide" : source) as Schedule,
    calendarUrl: sheet ? "" : (s.calendarUrl ?? ""),
    // A241: the feed's format as it was read ("" works it out from the answer).
    format: (!sheet && (source === "feed" || source === "guide_data") ? (s.schedule?.format ?? "") : "") as Format,
    checkedAgainst: source === "guide_data" ? (s.schedule?.checkedAgainst ?? "") : "",
    checkedOn: source === "guide_data" ? (s.schedule?.checkedOn ?? "") : "",
    outsideMarket: false,
    // A229: sharing X.1's call sign.
    sameBrand: s.family?.role === "member"
  };
}

/** The API's field errors under their fields: its message, or (A241) each slot's own words. */
const fieldErrors = (err: ApiError) => Object.fromEntries(Object.entries(err.fields ?? {}).map(([k, v]) => [k, k.startsWith("slots") ? v : err.message]));

export function ListSource({
  market,
  onClose,
  prefill = {},
  editing,
  onSaved,
  listings = [],
  startByHand = false
}: {
  market: Market;
  onClose: () => void;
  prefill?: ListSourcePrefill;
  /** A215: the listing to change (the form opens filled in). */
  editing?: ListedSource;
  /** After a change is saved, with the listing as it is now. */
  onSaved?: (saved: ListedSource) => void;
  /** A229: the market's listings, to offer "Same brand as X.1" on a subchannel. */
  listings?: readonly ListedSource[];
  /** A241: open on "Enter it by hand" (a webpage with no event data, from its details). */
  startByHand?: boolean;
}) {
  const toast = useToast();
  const invalidates = [networkApi.listListedSources, networkApi.getBoard, networkApi.listCreators, networkApi.listListedChanges, networkApi.listExternalOutages];
  const add = useApiMutation(networkApi.addListedSource, { invalidates });
  const update = useApiMutation(networkApi.updateListedSource, { invalidates });
  // A248: a spreadsheet file, uploaded to the listing once it's saved.
  const uploadSheet = useApiMutation(networkApi.uploadListedSchedule, { invalidates });
  const today = localDate(useNow(60_000), market.timezone || "America/Los_Angeles");
  const [f, setF] = useState(() =>
    editing
      ? { ...draftOf(editing), ...(startByHand ? { schedule: "manual" as Schedule } : {}) }
      : {
          name: prefill.name ?? "",
          description: prefill.description ?? "",
          band: "tv" as "tv" | "radio",
          channel: "",
          callSign: "",
          plays: prefill.plays ?? ("embed" as Plays),
          streamUrl: prefill.streamUrl ?? "",
          schedule: "feed" as Schedule,
          calendarUrl: "",
          format: "" as Format,
          checkedAgainst: "",
          checkedOn: "",
          outsideMarket: false,
          sameBrand: true
        }
  );
  // A241: the schedule entered by hand; from a page with no event data, where it was checked is that page.
  const [m, setM] = useState<ManualDraft>(() => manualDraftOf(editing, startByHand ? (editing?.calendarUrl ?? "") : ""));
  const [sh, setSh] = useState<SheetDraft>(() => sheetDraftOf(editing));
  // A lead's stream has no permission yet: "Not yet" until someone records it.
  const [d, setD] = useState<EvidenceDraft>(() => emptyEvidence(editing?.embedTerms ?? "allowed", prefill.creatorId ? "not_yet" : "permission"));
  const [nothing, setNothing] = useState(false);
  const warning = editing ? changeWarning(editing, { plays: f.plays, streamUrl: f.streamUrl, embedTerms: d.embedTerms }) : null;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const setE = <K extends keyof EvidenceDraft>(k: K) => (v: EvidenceDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const dash = f.plays === "stream_link" && /\.mpd($|[?#])/i.test(f.streamUrl.trim());
  // A229: X.1 whose call sign this channel could share (never X.1 itself, and never a listing's own family head for X.1).
  const head = familyHeadFor(listings.filter((l) => l.id !== editing?.id), f.band, f.channel);
  const isHead = editing?.family?.role === "head" && editing.family.members.length > 0;
  const sharing = !!head && f.sameBrand;
  const shownCallSign = sharing ? (head.station.callSign ?? "") : f.callSign;
  const familyChange = editing && isHead ? familyCallSignChange(editing, f.callSign) : null;

  /** A215: only what changed goes to the API; nothing changed says so. */
  const saveChange = async (s: ListedSource) => {
    const was = draftOf(s);
    const feedish = f.schedule === "feed" || f.schedule === "guide";
    // A248: a new file is uploaded after the rest is saved, with its zone (the change leaves the schedule to it).
    const wasSheet = sheetDraftOf(s);
    const newFile = f.schedule === "sheet" && sh.from === "file" ? sh.file : null;
    const sheetChanged = f.schedule === "sheet" && (was.schedule !== "sheet" || sh.from !== wasSheet.from || (sh.from === "link" && sh.url.trim() !== wasSheet.url) || sh.timeZone !== wasSheet.timeZone);
    const scheduleChanged =
      (f.schedule !== was.schedule && !newFile) ||
      (feedish && (f.calendarUrl.trim() !== was.calendarUrl || f.format !== was.format)) ||
      (f.schedule === "guide" && (f.checkedAgainst.trim() !== was.checkedAgainst || f.checkedOn.trim() !== was.checkedOn)) ||
      (f.schedule === "manual" && manualChanged(m, s)) ||
      (sheetChanged && !newFile);
    const body = {
      ...(f.name.trim() !== was.name ? { name: f.name.trim() } : {}),
      ...(f.description.trim() !== was.description ? { description: f.description.trim() || null } : {}),
      ...(f.streamUrl.trim() !== was.streamUrl ? { streamUrl: f.streamUrl.trim() } : {}),
      ...(f.plays !== was.plays ? { plays: f.plays } : {}),
      ...(f.plays === "embed" && (d.embedTerms !== s.embedTerms || f.plays !== was.plays) ? { embedTerms: d.embedTerms } : {}),
      // A241: a new address is worked out afresh unless a format was chosen.
      ...(scheduleChanged ? { schedule: scheduleInput(f.format !== was.format || f.calendarUrl.trim() === was.calendarUrl ? f.format || null : null) } : {}),
      ...(f.channel.trim() !== was.channel ? { channel: f.channel.trim() } : {}),
      // A229: sharing X.1's call sign, or leaving it with a call sign of its own.
      ...(sharing ? (was.sameBrand && f.channel.trim() === was.channel ? {} : { shareCallSign: true }) : f.callSign !== was.callSign ? { callSign: f.callSign, ...(was.sameBrand ? { shareCallSign: false } : {}) } : {})
    };
    setNothing(!Object.keys(body).length && !newFile);
    if (!Object.keys(body).length && !newFile) return;
    try {
      let saved = Object.keys(body).length ? await update.mutateAsync({ params: { sourceId: s.id }, body }) : s;
      if (newFile) saved = await uploadFile(s.id, newFile);
      const ch = channelText(saved);
      toast.show({ message: saved.onDial ? `${saved.name} is saved${ch ? `. It's on the dial at ${saved.station.channel}` : ""}.` : `Saved. ${saved.name} goes on the dial once ${onceWords(saved)}.` });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(fieldErrors(err));
    }
  };

  /** A248: the spreadsheet file uploaded to a listing, with its zone and tab; a refusal goes under the file. */
  const uploadFile = async (sourceId: string, file: File) => {
    try {
      return await uploadSheet.mutateAsync({ params: { sourceId }, body: { file, ...(sh.timeZone ? { timeZone: sh.timeZone } : {}), ...(sh.tab ? { sheet: sh.tab } : {}) } });
    } catch (err) {
      setErrors((e) => ({ ...e, sheetFile: errorText(err) }));
      throw err;
    }
  };

  /** A241: what's on, as the API takes it (`calendarFormat` null works it out; undefined leaves it unsaid). */
  const scheduleInput = (calendarFormat: ScheduleFormat | null | undefined): ListedScheduleInput => {
    const format = calendarFormat === undefined ? {} : { calendarFormat };
    if (f.schedule === "none") return { source: "none" };
    if (f.schedule === "manual") return manualInput(m);
    // A248: a spreadsheet's link is a feed in the format `sheet`; an uploaded one keeps its file.
    if (f.schedule === "sheet") return sh.from === "link" ? { source: "feed", calendarUrl: sh.url.trim(), calendarFormat: "sheet", timeZone: sh.timeZone || null } : { source: "file", timeZone: sh.timeZone || null };
    if (f.schedule === "feed") return { source: "feed", calendarUrl: f.calendarUrl.trim(), ...format };
    return { source: "guide_data", calendarUrl: f.calendarUrl.trim(), ...format, guideData: { checkedAgainst: f.checkedAgainst.trim(), checkedOn: f.checkedOn.trim() } };
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = editing ? {} : { ...evidenceProblems(f.plays, d) };
    if (!f.name.trim()) errs.name = "Say whose stream it is.";
    if (!/^\d{1,3}\.\d$/.test(f.channel.trim())) errs.channel = f.band === "tv" ? "A channel like 9.4." : "A frequency like 89.2.";
    const cs = sharing ? null : callSignProblem(f.callSign);
    if (cs) errs.callSign = cs;
    // A229: leaving a family needs a call sign of its own.
    else if (!sharing && editing?.family?.role === "member" && f.callSign === editing.station.callSign) errs.callSign = "Give it a call sign of its own, or keep sharing.";
    if (!isLink(f.streamUrl)) errs.streamUrl = f.plays === "embed" ? "Paste the address of their player." : "Paste the stream's address.";
    if ((f.schedule === "feed" || f.schedule === "guide") && !isLink(f.calendarUrl)) errs.calendarUrl = f.schedule === "feed" ? "Paste the link to their calendar, feed or schedule page." : "Paste the guide data's address.";
    if (f.schedule === "manual") Object.assign(errs, manualProblems(m));
    if (f.schedule === "sheet") Object.assign(errs, sheetProblems(sh, editing));
    if (f.schedule === "guide") {
      if (!isLink(f.checkedAgainst)) errs.checkedAgainst = "Paste the link to their published schedule.";
      if (!isDate(f.checkedOn)) errs.checkedOn = "The day you checked it.";
    }
    if (f.description.length > 160) errs.description = "Keep it under 160 characters.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (editing) return saveChange(editing);
    const name = f.name.trim();
    try {
      const saved = await add.mutateAsync({
        body: {
          marketId: market.id,
          band: f.band,
          channel: f.channel.trim(),
          ...(sharing ? { shareCallSign: true } : { callSign: f.callSign }),
          name,
          description: f.description.trim() || undefined,
          streamUrl: f.streamUrl.trim(),
          plays: f.plays,
          embedTerms: f.plays === "embed" ? d.embedTerms : undefined,
          // A241: what's on in one shape (a feed, guide data, by hand); none says nothing. A248: a
          // spreadsheet file is uploaded once it's listed.
          schedule: f.schedule === "none" || (f.schedule === "sheet" && sh.from === "file") ? undefined : scheduleInput(f.format || undefined),
          evidence: evidenceInput(f.plays, d),
          creatorId: prefill.creatorId,
          outsideMarket: f.outsideMarket || undefined
        }
      });
      // A248: then its spreadsheet file; listed either way, and a file it can't read says why.
      if (f.schedule === "sheet" && sh.from === "file" && sh.file) {
        try {
          await uploadFile(saved.id, sh.file);
        } catch (err) {
          toast.show({ message: `${name} is listed, but its spreadsheet wasn't read: ${errorText(err)} Upload it again from its details.` });
          onClose();
          return;
        }
      }
      toast.show({ message: saved.onDial ? `${name} is on the dial at ${f.channel.trim()}.` : `${name} is saved. It goes on the dial once ${onceWords(saved)}.` });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(fieldErrors(err));
    }
  };

  const pending = add.isPending || update.isPending || uploadSheet.isPending;
  const failed = editing ? update.error : add.error;
  return (
    <Modal
      open
      onClose={onClose}
      width={560}
      title={editing ? "Change the listing" : "List a source"}
      subtitle={
        editing
          ? `${[editing.name, channelText(editing)].filter(Boolean).join(", ")}. Its evidence is recorded on its own, and every change is kept in its history.`
          : `A station on the ${market.name} dial that plays the source's own stream. No playout, no spots.`
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="nd-list-source" disabled={pending}>
            {editing ? (warning?.waits ? "Save, and wait for evidence" : familyChange ? familyChange.button : "Save changes") : "List it"}
          </Button>
        </>
      }
    >
      <form id="nd-list-source" className="nd-form" onSubmit={submit} noValidate>
        <Field label="Whose stream" help="“City of Redlands”, “San Bernardino County”." value={f.name} onChange={(e) => set("name")(e.target.value)} error={errors.name} autoFocus />
        <TextAreaField label="What it shows" labelAside="Optional" rows={2} value={f.description} onChange={(e) => set("description")(e.target.value)} error={errors.description} />
        {!editing && (
          <div>
            <span className="nd-form__label">Band</span>
            <Segmented label="Band" value={f.band} onChange={(v) => set("band")(v)} options={[{ value: "tv", label: "TV band" }, { value: "radio", label: "Radio band" }]} />
          </div>
        )}
        <div className="nd-form__pair">
          <Field
            label="Channel"
            mono
            value={f.channel}
            placeholder={f.band === "tv" ? "9.4" : "89.2"}
            onChange={(e) => set("channel")(e.target.value)}
            error={errors.channel}
            disabled={isHead}
            help={isHead ? "Its call sign is shared on its subchannels, so it stays here." : undefined}
          />
          <Field
            label="Call sign"
            mono
            maxLength={5}
            value={shownCallSign}
            onChange={(e) => set("callSign")(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
            error={errors.callSign}
            disabled={sharing}
            help={sharing ? `The channel tells them apart: ${f.channel.trim()} ${shownCallSign}.` : undefined}
          />
        </div>
        {head && (
          <Checkbox
            checked={f.sameBrand}
            onChange={(v) => setF((x) => ({ ...x, sameBrand: v, callSign: v ? x.callSign : x.callSign === (head.station.callSign ?? "") ? "" : x.callSign }))}
            label={sameBrandLabel(head)}
            helper={f.sameBrand ? `${head.name} and this stream keep their own evidence and checks. Only the call sign is shared.` : "It takes a call sign of its own."}
            ruled={false}
          />
        )}
        {familyChange && <Notice tone="standby" icon="warn">{familyChange.text}</Notice>}
        <div>
          <span className="nd-form__label">How it plays</span>
          <Segmented label="How it plays" value={f.plays} onChange={(v) => set("plays")(v)} options={[{ value: "embed", label: "Official embed" }, { value: "stream_link", label: "Stream link" }]} />
        </div>
        {f.plays === "embed" && editing ? (
          <>
            <Field label="Their player's address" type="url" placeholder="https://" value={f.streamUrl} onChange={(e) => set("streamUrl")(e.target.value)} error={errors.streamUrl} />
            <div>
              <span className="nd-form__label">Their terms</span>
              <Segmented label="Their terms" value={d.embedTerms} onChange={(v) => setE("embedTerms")(v)} options={[{ value: "allowed", label: "Allow embedding" }, { value: "unclear", label: "Unclear" }]} />
            </div>
          </>
        ) : f.plays === "embed" ? (
          <>
            <Field label="Their player's address" type="url" placeholder="https://" value={f.streamUrl} onChange={(e) => set("streamUrl")(e.target.value)} error={errors.streamUrl} />
            <EmbedEvidenceFields d={d} set={setE} errors={errors} waitNote="Without the terms page and the day it was checked, it's saved but not on the dial." />
          </>
        ) : editing ? (
          <Field
            label="Stream address"
            type="url"
            mono
            placeholder="https://…/index.m3u8"
            help={dash ? "A DASH address (.mpd). It's saved, but waits until Settings allows DASH stream links." : "An HLS address (.m3u8). Viewers' players fetch it from the source directly."}
            value={f.streamUrl}
            onChange={(e) => set("streamUrl")(e.target.value)}
            error={errors.streamUrl}
          />
        ) : (
          <>
            <Field
              label="Stream address"
              type="url"
              mono
              placeholder="https://…/index.m3u8"
              help={dash ? "A DASH address (.mpd). Viewers' players fetch it from the source directly, while Settings allows DASH stream links." : "An HLS address (.m3u8). Viewers' players fetch it from the source directly."}
              value={f.streamUrl}
              onChange={(e) => set("streamUrl")(e.target.value)}
              error={errors.streamUrl}
            />
            <StreamEvidenceFields d={d} set={setE} errors={errors} streamUrl={f.streamUrl} />
          </>
        )}
        {!editing && !complete(f.plays, d) && <NoteField d={d} set={setE} errors={errors} />}
        <div>
          <span className="nd-form__label">What's on</span>
          <Segmented
            label="What's on"
            value={f.schedule === "guide" ? "feed" : f.schedule}
            onChange={(v) => set("schedule")(v)}
            options={[
              { value: "feed", label: "Its feed" },
              { value: "sheet", label: "A spreadsheet" },
              { value: "manual", label: "Enter it by hand" },
              { value: "none", label: "None" }
            ]}
          />
          {f.schedule === "none" && <p className="nd-form__note">The banner shows the station's name, External, Live and the source. Nothing is made up.</p>}
        </div>
        {(f.schedule === "feed" || f.schedule === "guide") && (
          <>
            <Field
              label={f.schedule === "guide" ? "Guide data address" : "Calendar, feed or schedule page"}
              type="url"
              placeholder="https://"
              help={f.schedule === "guide" ? undefined : "iCal, RSS, JSON, XMLTV, or a webpage with event data. Their real titles and times become the listings."}
              value={f.calendarUrl}
              onChange={(e) => set("calendarUrl")(e.target.value)}
              error={errors.calendarUrl}
            />
            {editing?.calendarSync === "no_event_data" && f.calendarUrl.trim() === (editing.calendarUrl ?? "") && (
              <Notice tone="standby" icon="warn">
                {NO_EVENT_DATA}{" "}
                <Button variant="text" size="sm" onClick={() => setF((x) => ({ ...x, schedule: "manual" }))}>
                  Enter the schedule by hand instead.
                </Button>
              </Notice>
            )}
            <SelectField label="Format" value={f.format} onChange={(e) => set("format")(e.target.value as Format)}>
              <option value="">Work it out from the address</option>
              {ScheduleFormat.options.map((v) => (
                <option key={v} value={v}>
                  {FORMAT_LABELS[v]}
                </option>
              ))}
            </SelectField>
            <Checkbox
              checked={f.schedule === "guide"}
              onChange={(v) => set("schedule")(v ? "guide" : "feed")}
              label="It's guide data, checked against their published schedule"
              helper="Someone else's listings for this source, not its own feed."
              ruled={false}
            />
            {f.schedule === "guide" && (
              <div className="nd-form__pair">
                <Field label="Checked against" type="url" placeholder="https://" help="Their published schedule." value={f.checkedAgainst} onChange={(e) => set("checkedAgainst")(e.target.value)} error={errors.checkedAgainst} />
                <Field label="Date checked" type="date" value={f.checkedOn} onChange={(e) => set("checkedOn")(e.target.value)} error={errors.checkedOn} />
              </div>
            )}
          </>
        )}
        {f.schedule === "sheet" && (
          <SheetScheduleFields
            value={sh}
            onChange={(next) => {
              setSh(next);
              setNothing(false);
              setErrors(({ sheetUrl: _u, sheetFile: _f, ...rest }) => rest);
            }}
            // The API's refusal of the link's address shows under it.
            errors={{ ...errors, sheetUrl: errors.sheetUrl ?? errors["schedule.calendarUrl"] ?? errors.calendarUrl ?? "" }}
            market={market}
            editing={editing}
            today={today}
          />
        )}
        {f.schedule === "manual" && (
          <ManualScheduleFields
            value={m}
            onChange={(next) => {
              setM(next);
              setNothing(false);
            }}
            errors={errors}
            timeZone={market.timezone || "America/Los_Angeles"}
          />
        )}
        {!editing && (
          <Checkbox
            checked={f.outsideMarket}
            onChange={(v) => set("outsideMarket")(v)}
            label={`The source is outside the ${market.name}`}
            helper="It waits unless Settings allows other markets' streams."
            ruled={false}
          />
        )}
        {warning && (
          <Notice tone={warning.waits ? "standby" : "plain"} icon={warning.waits ? "warn" : null}>
            {warning.text}
          </Notice>
        )}
        {nothing && <p className="nd-form__error">Nothing to change yet.</p>}
        {failed && !(failed instanceof ApiError && failed.fields) ? <p className="nd-form__error">{errorText(failed)}</p> : null}
      </form>
    </Modal>
  );
}
