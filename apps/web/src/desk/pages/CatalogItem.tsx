// desk-catalog 03, adding an item: the rights check. The checklist asks for what makes it free to
// air, each answer with evidence attached (a file, or a written record); lines the public-domain
// rules in Settings answer are filled in already. Then "Send for second check", and a second person,
// never the first checker, confirms it. Only then can it go into an episode.
import { useRef, useState, type ChangeEvent } from "react";
import { useParams } from "react-router";
import { catalogShelfApi, type ChecklistLine, type LineState, type ShelfItem } from "@opencast/contracts";
import { Button, ControlTitle, Field, KeyValueList, Segmented, TextAreaField, TitleCard, duration, useToast } from "@opencast/ui";
import { useApi, useApiMutation } from "../../api/hooks";
import { useMarket } from "../layout/market";
import { DEFAULT_TZ } from "../../lib/clock";
import { dayMonth } from "../lib/dates";
import { checkRows, evidenceWords, LINE_WORDS } from "../components/shelf/shelf";
import { FailItem } from "../components/shelf/ShelfForms";
import { Crumb, ErrorLine, errorText, NotFound, Quiet, SecTop } from "./common";
import { deskPath } from "../../areas";
import "./Catalog.css";

const refreshes = [catalogShelfApi.getItem, catalogShelfApi.getSeries, catalogShelfApi.getShelf];
const MARK: Record<LineState, string> = { ok: "✓", warn: "!", todo: "", fail: "✕", not_needed: "–" };
const ANSWERS: Array<{ value: LineState; label: string }> = [
  { value: "ok", label: "Yes" },
  { value: "warn", label: "Yes, with a caution" },
  { value: "fail", label: "Not free to air" },
  { value: "todo", label: "Not answered" }
];

function LineEditor({ item, line, onDone }: { item: ShelfItem; line: ChecklistLine; onDone: () => void }) {
  const toast = useToast();
  const setCheck = useApiMutation(catalogShelfApi.setCheck, { invalidates: refreshes });
  const addEvidence = useApiMutation(catalogShelfApi.addEvidence, { invalidates: refreshes });
  const [state, setState] = useState<LineState>(line.state === "not_needed" ? "ok" : line.state);
  const [detail, setDetail] = useState(line.detail ?? "");
  const [record, setRecord] = useState(line.record ?? "");
  const file = useRef<HTMLInputElement>(null);
  const save = async () => {
    try {
      await setCheck.mutateAsync({ params: { itemId: item.id, line: line.line }, body: { state, detail: detail.trim() || null, record: record.trim() || null } });
      onDone();
    } catch (e) {
      toast.show({ message: errorText(e) });
    }
  };
  const attach = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      await addEvidence.mutateAsync({ params: { itemId: item.id, line: line.line }, body: { file: f } });
      toast.show({ message: `${f.name} is kept with the item.` });
    } catch (err) {
      toast.show({ message: errorText(err) });
    } finally {
      e.target.value = "";
    }
  };
  return (
    <div className="nd-check__edit" role="group" aria-label={`Answer: ${line.title}`}>
      <Segmented<LineState> label={`${line.title}: the answer`} size="sm" value={state} onChange={setState} options={ANSWERS} />
      <Field label="What you found" size="sm" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={line.help} />
      <TextAreaField label="The record" labelAside="If the evidence isn't a file" rows={2} value={record} onChange={(e) => setRecord(e.target.value)} placeholder="Copyright Office renewal records searched for the title and studio: none found" />
      <div className="nd-check__row">
        <Button size="sm" onClick={() => file.current?.click()} disabled={addEvidence.isPending} icon="upload">
          Attach evidence
        </Button>
        <input ref={file} type="file" hidden aria-label={`Evidence for ${line.title}`} accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.txt,application/pdf,image/*,text/plain" onChange={(e) => void attach(e)} />
        <span className="nd-check__file">{line.evidence.map((e) => e.fileName).join(", ")}</span>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={() => void save()} disabled={setCheck.isPending}>
          Save
        </Button>
      </div>
    </div>
  );
}

export default function CatalogItem() {
  const { itemId = "" } = useParams();
  const { slug } = useMarket();
  const toast = useToast();
  const item = useApi(catalogShelfApi.getItem, { params: { itemId } });
  const series = useApi(catalogShelfApi.getSeries, { params: { seriesId: item.data?.seriesId ?? "" } }, { enabled: !!item.data });
  const send = useApiMutation(catalogShelfApi.sendForSecondCheck, { invalidates: refreshes });
  const second = useApiMutation(catalogShelfApi.secondCheck, { invalidates: refreshes });
  const [editing, setEditing] = useState<string | null>(null);
  const [failing, setFailing] = useState(false);
  if (item.isLoading) return <Quiet />;
  if (item.error && (item.error as { status?: number }).status === 404) return <NotFound />;
  if (item.error || !item.data) return <ErrorLine error={item.error} />;
  const i = item.data;
  const tz = DEFAULT_TZ;
  const date = (iso: string) => dayMonth(iso, tz);
  const editable = i.canEdit && i.state === "checking";
  const firstName = i.firstCheck?.by.name;
  const act = async (f: () => Promise<unknown>, done: string) => {
    try {
      await f();
      toast.show({ message: done });
    } catch (e) {
      toast.show({ message: errorText(e) });
    }
  };
  const kind = i.workKind === "film" ? "Film" : "Sound recording";
  return (
    <>
      <Crumb href={i.state === "checking" && !i.firstCheck ? deskPath(`/markets/${slug}/catalog`) : deskPath(`/markets/${slug}/catalog/series/${i.seriesId}`)} label={i.state === "checking" ? "Catalog" : `Catalog / ${i.seriesTitle}`} here={i.state === "checking" ? "Add an item" : i.title} />
      <ControlTitle title={i.title} description={`${kind}${i.lengthMs ? `, ${duration(i.lengthMs)}` : ""}. ${i.source}.`} />
      <div className="nd-split nd-split--wide">
        <div>
          <SecTop title="Why it's free to air" sub="Every line needs evidence" first />
          <ul className="nd-checks" aria-label="Rights checklist">
            {i.checklist.map((l) => (
              <li key={l.line} className={`nd-check nd-check--${l.state}`}>
                <span className="nd-check__ic" aria-hidden="true">
                  {MARK[l.state]}
                </span>
                <div>
                  <span className="oc-sr-only">{LINE_WORDS[l.state]}: </span>
                  <b>{l.title}</b>
                  <small>{l.detail ?? l.help}</small>
                  {l.record && l.evidence.length === 0 && l.state !== "not_needed" ? <small>Record: {l.record}</small> : null}
                </div>
                <span className="nd-check__ev">
                  {l.evidence.length
                    ? l.evidence.map((e) => (
                        <a key={e.id} href={e.url} target="_blank" rel="noopener">
                          {e.fileName}
                        </a>
                      ))
                    : evidenceWords(l)}
                  {editable && l.state !== "not_needed" && editing !== l.line ? (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(l.line)} aria-label={`Answer: ${l.title}`}>
                      {l.state === "todo" ? "Answer" : "Change"}
                    </Button>
                  ) : null}
                </span>
                {editing === l.line && <LineEditor item={i} line={l} onDone={() => setEditing(null)} />}
              </li>
            ))}
            <li className={`nd-check nd-check--${i.secondCheck ? "ok" : i.state === "failed" ? "fail" : "todo"}`}>
              <span className="nd-check__ic" aria-hidden="true">
                {i.secondCheck ? "✓" : i.state === "failed" ? "✕" : ""}
              </span>
              <div>
                <span className="oc-sr-only">{i.secondCheck ? "Done" : "Not yet"}: </span>
                <b>Second check</b>
                <small>{i.secondCheck ? `${i.secondCheck.by.name} reviewed the evidence and confirmed, ${date(i.secondCheck.at)}` : `Someone other than ${firstName ?? "the first checker"} reviews the evidence and confirms`}</small>
              </div>
              <span />
            </li>
          </ul>
          <p className="nd-note">The rules today: {i.publicDomain.line}. US works only; published in {i.publicDomain.cutoffYear} or earlier is public domain, and the year moves every January 1 (Settings, Rules).</p>
        </div>
        <div className="nd-pane">
          <h4>Rights basis, as stations will see it</h4>
          <div className="nd-basis">
            <TitleCard colour={series.data?.colour ?? "#9A5412"} title={i.title} decorative />
            <div>
              <b>{i.title}</b>
              <small>{i.basis === "not_renewed" && i.publishedYear ? `${i.publishedYear}. Not renewed` : i.basisLine}</small>
              <small className="nd-quiet-text">Checked by Opencast</small>
            </div>
          </div>
          <KeyValueList items={checkRows(i, date)} />
          <div className="nd-actions">
            {i.state === "checking" && i.canEdit && (
              <>
                <Button variant="primary" block disabled={!!i.cantSendBecause || send.isPending} onClick={() => void act(() => send.mutateAsync({ params: { itemId: i.id } }), "Sent for the second check.")}>
                  Send for second check
                </Button>
                {i.cantSendBecause && <p className="nd-note">{i.cantSendBecause}</p>}
              </>
            )}
            {i.state === "second_check" && i.canSecondCheck && (
              <>
                <Button variant="primary" block disabled={second.isPending} onClick={() => void act(() => second.mutateAsync({ params: { itemId: i.id }, body: { decision: "confirm" } }), `${i.title} is checked twice. It can go into episodes.`)}>
                  Confirm: it's free to air
                </Button>
                <Button block disabled={second.isPending} onClick={() => void act(() => second.mutateAsync({ params: { itemId: i.id }, body: { decision: "return", note: "More evidence needed" } }), "Sent back for more evidence.")}>
                  Send back for more evidence
                </Button>
                <Button block variant="ghost" disabled={second.isPending} onClick={() => void act(() => second.mutateAsync({ params: { itemId: i.id }, body: { decision: "fail", note: "Failed its second check" } }), "It isn't free to air: it stays out of the catalog.")}>
                  It isn't free to air
                </Button>
              </>
            )}
            {i.state === "second_check" && !i.canSecondCheck && <p className="nd-note">Waiting for a rights reviewer or admin other than {firstName ?? "the first checker"}.</p>}
            {i.state === "passed" && i.canEdit && (
              <Button block variant="ghost" onClick={() => setFailing(true)}>
                Take it out of the catalog
              </Button>
            )}
          </div>
          <p className="nd-note">Evidence is kept with the item for as long as it's in the catalog, so any question later can be answered from the record.</p>
        </div>
      </div>
      {failing && <FailItem itemId={i.id} title={i.title} onClose={() => setFailing(false)} onDone={(w) => toast.show({ message: w })} />}
    </>
  );
}
