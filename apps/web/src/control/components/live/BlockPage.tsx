// A246 (Phase 4, opencast-schedule 07; decisions 14 to 17): a programming block's page on the
// Schedule's Blocks tab. Its head: its mark, its name and description (edited in place with Edit),
// who makes it, "Place on the log" (a menu: on a date, or in a template) and Save. Then what it
// airs, part by part, with "Uses BEAT's" wherever it falls back to the station (blockPage.ts), Add
// from the library and Upload; its bumper order (the station's, or its own); how it looks, with a
// live preview of the bug, the banner and the guide band (BlockPreview.tsx) and the colour (4.5:1),
// logo and bug; where it airs; the syndication fields, read-only; and Archive at the foot.
//
// One Save covers everything `updateBlock` takes (name, description, colour, bug, intro, outro,
// bumper order): it's a draft until then, and leaving with it unsaved asks first. Adding a library
// clip and the logo save at once (other endpoints), and the page says so.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { blocksApi, libraryApi, logApi, stationsApi, type BumperSequences, type LibraryItem, type ProgramBlock } from "@opencast/contracts";
import { Button, ChoiceList, Field, Menu, Modal, Notice, Segmented, TextAreaField, Toggle, useToast } from "@opencast/ui";
import { ApiError, call } from "../../../api/client";
import { useApi } from "../../../api/hooks";
import { now as clockNow, useNow } from "../../../lib/clock";
import { useStation } from "../../station/StationContext";
import { ColourPicker } from "../station/ColourPicker";
import { SequenceBuilder } from "../station/settings/SequenceBuilder";
import { useLeaveGuard } from "../station/settings/useLeaveGuard";
import { SEQ_ROLE_WORDS, sequencesOf } from "../station/breakRule";
import { rowLength } from "../onair/dayRows";
import { scheduleHref } from "../onair/scheduleRoutes";
import { templateName } from "../onair/templates";
import { broadcastDay, isoDate } from "../onair/time";
import { BlockPreview } from "./BlockPreview";
import { blockRoleSupply, lengthWords } from "./blocks";
import { airsRows, initials, madeByLine, whereRows, type AirsPart } from "./blockAirs";

/** What `updateBlock` takes, as the page's draft. */
export interface BlockDraft {
  name: string;
  description: string;
  colour: string | null;
  bug: ProgramBlock["bug"];
  intro: boolean;
  outro: boolean;
  sequences: BumperSequences | null;
}

export const draftOf = (b: ProgramBlock): BlockDraft => ({ name: b.name, description: b.description ?? "", colour: b.colour, bug: b.bug, intro: b.intro, outro: b.outro, sequences: b.sequences });

/** What changed, as `updateBlock`'s body; empty when nothing did. */
export function changedFields(b: ProgramBlock, d: BlockDraft): Record<string, unknown> {
  const was = draftOf(b);
  const out: Record<string, unknown> = {};
  if (d.name.trim() !== was.name) out.name = d.name.trim();
  if ((d.description.trim() || null) !== (b.description ?? null)) out.description = d.description.trim() || null;
  if (d.colour !== was.colour) out.colour = d.colour;
  if (d.bug !== was.bug) out.bug = d.bug;
  if (d.intro !== was.intro) out.intro = d.intro;
  if (d.outro !== was.outro) out.outro = d.outro;
  if (JSON.stringify(d.sequences) !== JSON.stringify(was.sequences)) out.sequences = d.sequences;
  return out;
}

/** What a library item can be added as. */
const FOR: Array<{ value: AirsPart; label: string }> = [
  { value: "intro", label: "Intro" },
  { value: "outro", label: "Outro" },
  { value: "id", label: "Block ID" },
  { value: "into_break", label: "Into the break" },
  { value: "out_of_break", label: "Out of the break" },
  { value: "up_next", label: "Up next" },
  { value: "any", label: "Any bumper" }
];

/** The station's items a block can take for a part (intros, outros, IDs, bumpers), not already a block's. */
export function candidates(items: LibraryItem[], part: AirsPart, blockId: string): LibraryItem[] {
  const free = items.filter((i) => !i.programBlockId && i.status !== "failed" && i.programBlockId !== blockId);
  if (part === "intro") return free.filter((i) => i.identCode === "OPN");
  if (part === "outro") return free.filter((i) => i.identCode === "CLS");
  if (part === "id") return free.filter((i) => i.code === "SID" && !i.identCode);
  return free.filter((i) => i.code === "BMP" && !i.identCode);
}

/** "Add from the library": what it's for, then the clip. It's the block's at once. */
function AddFromLibrary({ block, items, onAdd, onClose }: { block: ProgramBlock; items: LibraryItem[]; onAdd: (item: LibraryItem, part: AirsPart) => Promise<void>; onClose: () => void }) {
  const [part, setPart] = useState<AirsPart>("into_break");
  const list = candidates(items, part, block.id);
  return (
    <Modal open onClose={onClose} width={480} eyebrow={block.name} title="Add from the library" subtitle="It airs only during the block, and it's the block's as soon as you pick it." footer={<Button onClick={onClose}>Cancel</Button>}>
      <Segmented<AirsPart> label="It's for" size="sm" value={part} onChange={setPart} options={FOR} className="cc-bpage__for" />
      {list.length ? (
        <ChoiceList
          label="From your library"
          options={list.map((i) => ({ value: i.id, title: i.title, helper: i.durationMs ? lengthWords(i.durationMs) : undefined }))}
          value={null}
          onChange={(id) => {
            const item = list.find((i) => i.id === id);
            if (item) void onAdd(item, part);
          }}
        />
      ) : (
        <p className="cc-blk__quiet">Nothing in your library fits here yet. Upload one into the block.</p>
      )}
    </Modal>
  );
}

/** "Place on the log", on a date: which date, then the Log's edit mode with Add a block set to it. */
function OnADate({ block, onClose }: { block: ProgramBlock; onClose: () => void }) {
  const s = useStation();
  const navigate = useNavigate();
  const [date, setDate] = useState(isoDate(broadcastDay(clockNow())));
  return (
    <Modal
      open
      onClose={onClose}
      width={400}
      title={`Place ${block.name} on a date`}
      subtitle="The Log opens in edit mode with Add a block set to it. Publish when it's where you want it."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => navigate(`${scheduleHref(s.base)}?edit=1&day=${date}&addBlock=${block.id}`)} disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)}>
            Open the Log
          </Button>
        </>
      }
    >
      <Field label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
    </Modal>
  );
}

export interface BlockPageProps {
  block: ProgramBlock;
  /** The tab's head, given the guarded way to another page. */
  head: (go: (to: string) => void) => ReactNode;
  /** The list of blocks, beside it. */
  list: ReactNode;
}

export function BlockPage({ block, head, list }: BlockPageProps) {
  const s = useStation();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const canEdit = s.can("programming");
  // "Uses BEAT's": the station's call sign.
  const cs = s.station.callSign ?? s.label;
  const now = useNow(60_000);
  const [draft, setDraft] = useState<BlockDraft>(() => draftOf(block));
  const [naming, setNaming] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [onDate, setOnDate] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  // A different block: the draft starts from it. The same one read again (saved, a clip added, the
  // logo): what's been changed here stays, the rest follows what's saved.
  const last = useRef(block);
  useEffect(() => {
    const was = last.current;
    last.current = block;
    if (was.id !== block.id) {
      setDraft(draftOf(block));
      setErrors({});
      setNaming(false);
      return;
    }
    const before = draftOf(was);
    const now = draftOf(block);
    setDraft((d) => {
      const keep = <K extends keyof BlockDraft>(k: K) => (JSON.stringify(d[k]) !== JSON.stringify(before[k]) ? d[k] : now[k]);
      return { name: keep("name"), description: keep("description"), colour: keep("colour"), bug: keep("bug"), intro: keep("intro"), outro: keep("outro"), sequences: keep("sequences") };
    });
  }, [block]);

  const own = useApi(libraryApi.getLibrary, { params: { stationId: s.id }, query: { programBlockId: block.id } }, { retry: false });
  const library = useApi(libraryApi.getLibrary, { params: { stationId: s.id }, query: {} }, { retry: false });
  const rule = useApi(stationsApi.getBreakRule, { params: { stationId: s.id } }, { retry: false });
  const setup = useApi(stationsApi.getSetup, { params: { stationId: s.id } }, { retry: false });
  const templates = useApi(logApi.listTemplates, { params: { stationId: s.id } }, { retry: false });
  // The next airing, for the preview: its programs, as the log has them.
  const next = block.onLog?.dates[0];
  const airing = useApi(logApi.getLog, { params: { stationId: s.id }, query: { from: next?.startsAt ?? "", to: next?.endsAt ?? "" } }, { enabled: !!next, retry: false });
  const programs = useMemo(() => {
    const span = airing.data?.blocks?.find((b) => b.id === next?.spanId);
    return (span?.entryIds ?? []).flatMap((id) => {
      const e = airing.data?.entries.find((x) => x.id === id);
      return e ? [{ id: e.id, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt }] : [];
    });
  }, [airing.data, next?.spanId]);

  const changes = changedFields(block, draft);
  const dirty = Object.keys(changes).length > 0;
  const guard = useLeaveGuard(dirty, () => setDraft(draftOf(block)), { title: "Leave without saving?", subtitle: `Your changes to ${block.name} haven't been saved. Leaving drops them.` });
  const set = (patch: Partial<BlockDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const refresh = () => Promise.all([blocksApi.getBlock, blocksApi.listBlocks, libraryApi.getLibrary, logApi.getLog].map((e) => qc.invalidateQueries({ queryKey: [e.method, e.path] })));
  const save = async () => {
    if (!draft.name.trim()) return setErrors({ name: "Name it." });
    setBusy(true);
    try {
      await call(blocksApi.updateBlock, { params: { stationId: s.id, blockId: block.id }, body: changes });
      await refresh();
      toast.show({ message: `${draft.name.trim()} saved.` });
      setErrors({});
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.code === "block_name_taken" ? { name: e.message } : { form: e.message, ...(e.fields ?? {}) });
    } finally {
      setBusy(false);
    }
  };
  // These save at once: they're other endpoints than updateBlock.
  const uploadLogo = async (f: File) => {
    setBusy(true);
    try {
      await call(blocksApi.uploadBlockLogo, { params: { stationId: s.id, blockId: block.id }, body: { file: f } });
      await refresh();
      toast.show({ message: "Logo saved." });
    } catch (e) {
      if (e instanceof ApiError) setErrors({ logo: e.message });
    } finally {
      setBusy(false);
    }
  };
  const removeLogo = async () => {
    setBusy(true);
    try {
      await call(blocksApi.updateBlock, { params: { stationId: s.id, blockId: block.id }, body: { removeLogo: true } });
      await refresh();
      toast.show({ message: "Logo removed." });
    } finally {
      setBusy(false);
    }
  };
  const addItem = async (item: LibraryItem, part: AirsPart) => {
    const role = part === "into_break" || part === "out_of_break" || part === "up_next" || part === "any" ? part : null;
    await call(libraryApi.updateItem, { params: { itemId: item.id }, body: { programBlockId: block.id, ...(role ? { bumperRole: role } : {}) } });
    setAdding(false);
    await refresh();
    toast.show({ message: `${item.title} is part of ${block.name} now. Added at once.` });
  };
  const archive = async (takeOffLog: boolean) => {
    try {
      const r = await call(blocksApi.archiveBlock, { params: { stationId: s.id, blockId: block.id }, query: takeOffLog ? { takeOffLog: true } : {} });
      await refresh();
      toast.show({ message: r.kept ? `${block.name} is archived. ${r.kept} edited ${r.kept === 1 ? "date keeps its" : "dates keep theirs"}.` : `${block.name} is archived.` });
      navigate(scheduleHref(s.base, "blocks"));
    } catch (e) {
      if (e instanceof ApiError) setArchiving(e.message);
    }
  };

  const rows = airsRows(draft, own.data?.items ?? [], library.data?.items ?? [], cs, now);
  const stationSeq = rule.data ? sequencesOf(rule.data) : null;
  const where = whereRows(block, scheduleHref(s.base));
  const look = { id: block.id, name: draft.name.trim() || block.name, colour: draft.colour, logoUrl: block.logoUrl, bug: draft.bug };
  const placeItems = [
    { label: "On a date", detail: "The Log, in edit mode", onSelect: () => setOnDate(true) },
    ...(templates.data?.templates ?? []).map((tpl) => ({ label: `In ${templateName(tpl)}`, detail: "The template editor", onSelect: () => guard.go(`${scheduleHref(s.base, "templates")}/${tpl.id}?edit=1&addBlock=${block.id}`) }))
  ];

  const end = canEdit ? (
    <div className="cc-bpage__end">
      <Menu label={`Place ${block.name} on the log`} items={placeItems} trigger={{ content: <>Place on the log</>, className: "cc-btn-xs cc-bpage__place" }} />
      <Button size="sm" variant="primary" onClick={() => void save()} disabled={!dirty || busy}>
        Save
      </Button>
    </div>
  ) : null;

  return (
    <>
      {head(guard.go)}
      <div className="cc-blks">
        {list}
    <div className="cc-bpage">
      <div className="cc-bpage__head">
        <span className="cc-bpage__mark" style={{ background: draft.colour ?? "var(--ink-70)" }} aria-hidden="true">
          {block.logoUrl ? <img src={block.logoUrl} alt="" /> : initials(look.name)}
        </span>
        <div className="cc-bpage__who">
          {naming ? (
            <div className="cc-bpage__naming">
              <Field label="Name" size="sm" value={draft.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} error={errors.name} autoFocus />
              <TextAreaField label="Description" help="Shown on your station page" value={draft.description} maxLength={160} onChange={(e) => set({ description: e.target.value })} />
              <Button size="sm" variant="text" onClick={() => setNaming(false)}>
                Done
              </Button>
            </div>
          ) : (
            <>
              <h2 className="cc-bpage__h">
                {look.name}{" "}
                {canEdit && (
                  <button type="button" className="cc-bpage__edit" onClick={() => setNaming(true)}>
                    Edit<span className="oc-sr-only"> the name and description</span>
                  </button>
                )}
              </h2>
              <small>
                {draft.description.trim() ? `"${draft.description.trim()}" ` : ""}Made by {[block.owner.callSign ?? block.owner.name, block.owner.channel].filter(Boolean).join(" ")}
              </small>
              {errors.name && <small className="cc-blk__err">{errors.name}</small>}
            </>
          )}
        </div>
        {end}
      </div>
      {dirty && <p className="cc-bpage__unsaved">Unsaved changes. Save keeps them; leaving drops them.</p>}
      {errors.form && (
        <p className="cc-blk__err" role="alert">
          {errors.form}
        </p>
      )}

      <div className="cc-bpage__grid">
        <div>
          <section className="cc-bsec" aria-labelledby="cc-bsec-airs">
            <h3 className="cc-bsec__h" id="cc-bsec-airs">
              What it airs <small>Anything it doesn't have falls back to {cs}'s</small>
            </h3>
            <ul className="cc-irows">
              {rows.map((r) => (
                <li key={r.part} className="cc-irow">
                  <span className="cc-code2" aria-hidden="true">
                    {r.code}
                  </span>
                  <div>
                    <b id={`cc-irow-${r.part}`}>{r.title}</b>
                    <small>{r.detail}</small>
                  </div>
                  <span className="cc-irow__n">{r.lengthMs ? rowLength(r.lengthMs) : ""}</span>
                  {r.part === "intro" || r.part === "outro" ? (
                    <span className="cc-irow__end">
                      {r.fallback && <span className="cc-irow__fb">{r.fallback}</span>}
                      <Toggle checked={r.part === "intro" ? draft.intro : draft.outro} onChange={(on) => set(r.part === "intro" ? { intro: on } : { outro: on })} aria-labelledby={`cc-irow-${r.part}`} disabled={!canEdit} />
                    </span>
                  ) : (
                    <span className="cc-irow__fb">{r.fallback}</span>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="cc-bsec__acts">
                <button type="button" className="cc-btn-xs" onClick={() => setAdding(true)}>
                  Add from the library
                </button>
                <a className="cc-btn-xs" href={`${s.base}/library/blocks/${block.id}`}>
                  Upload
                </a>
              </div>
            )}
            <p className="cc-why">Added clips and uploads save straight away; everything else saves with Save.</p>
          </section>

          <section className="cc-bsec" aria-labelledby="cc-bsec-order">
            <h3 className="cc-bsec__h" id="cc-bsec-order">
              Bumper order <small>{draft.sequences ? `Its own, instead of ${cs}'s` : `${cs}'s`}</small>
            </h3>
            <Segmented<"station" | "own">
              label="Bumper order"
              size="sm"
              value={draft.sequences ? "own" : "station"}
              onChange={(v) => set({ sequences: v === "own" ? (stationSeq ?? null) : null })}
              options={[
                { value: "station", label: `Same as ${cs}`, disabled: !canEdit },
                { value: "own", label: "Its own", disabled: !canEdit || !stationSeq }
              ]}
            />
            {draft.sequences ? (
              <div className="cc-blk__seq">
                {(["open", "close", "between"] as const).map((p) => (
                  <SequenceBuilder
                    key={p}
                    position={p}
                    title={p === "open" ? "Opening a break" : p === "close" ? "Closing a break" : "Between programs"}
                    rule={draft.sequences![p]}
                    onChange={(next) => set({ sequences: { ...draft.sequences!, [p]: next } })}
                    supply={(role) => blockRoleSupply(block, role, cs)}
                    disabled={!canEdit}
                  />
                ))}
              </div>
            ) : (
              stationSeq && (
                <ul className="cc-orders" aria-label={`${cs}'s bumper order`}>
                  {(["open", "close", "between"] as const).map((p) => (
                    <li key={p}>
                      <span>{p === "open" ? "Opening a break" : p === "close" ? "Closing a break" : "Between programs"}</span>
                      <span className="cc-orders__roles">{stationSeq[p].roles.length ? stationSeq[p].roles.map((r) => <span key={r}>{SEQ_ROLE_WORDS[r]}</span>) : <em>None</em>}</span>
                    </li>
                  ))}
                </ul>
              )
            )}
          </section>
        </div>

        <div>
          <section className="cc-bsec" aria-labelledby="cc-bsec-look">
            <h3 className="cc-bsec__h" id="cc-bsec-look">
              How it looks
            </h3>
            <BlockPreview block={look} station={block.owner} stationBug={setup.data ?? null} programs={programs} sample={!next} now={now.getTime()} />
            <div className="cc-ctrl cc-ctrl--colour">
              <ColourPicker value={draft.colour ?? "#1F5C99"} onChange={(hex) => set({ colour: hex })} disabled={!canEdit} />
            </div>
            <div className="cc-ctrl">
              <span>Logo</span>
              <span className="cc-ctrl__acts">
                <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && void uploadLogo(e.target.files[0])} />
                <button type="button" className="cc-btn-xs" onClick={() => file.current?.click()} disabled={!canEdit || busy}>
                  {block.logoUrl ? "Replace" : "Upload"}
                  <span className="oc-sr-only"> the logo</span>
                </button>
                {block.logoUrl && canEdit && (
                  <button type="button" className="cc-btn-xs" onClick={() => void removeLogo()} disabled={busy}>
                    Remove
                  </button>
                )}
                <small>{errors.logo ?? "Saves straight away"}</small>
              </span>
            </div>
            <div className="cc-ctrl">
              <span id="cc-ctrl-bug">The bug shows</span>
              <Segmented<ProgramBlock["bug"]>
                label="The bug shows"
                size="sm"
                value={draft.bug}
                onChange={(bug) => set({ bug })}
                options={[
                  { value: "station", label: `${cs}'s`, disabled: !canEdit },
                  { value: "logo", label: "Block logo", disabled: !canEdit },
                  { value: "off", label: "Nothing", disabled: !canEdit }
                ]}
              />
            </div>
            {draft.bug === "logo" && !block.logoUrl && <p className="cc-why">Until it has a logo, {cs}'s bug shows.</p>}
          </section>

          <section className="cc-bsec" aria-labelledby="cc-bsec-where">
            <h3 className="cc-bsec__h" id="cc-bsec-where">
              Where it airs
            </h3>
            {where.length ? (
              <ul className="cc-where">
                {where.map((w) => (
                  <li key={w.key}>
                    <div>
                      <b>{w.title}</b>
                      <small>{w.detail}</small>
                    </div>
                    <a className="cc-btn-xs" href={w.href} onClick={(e) => (e.preventDefault(), guard.go(w.href))}>
                      Open<span className="oc-sr-only"> {w.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="cc-blk__quiet">Not on the log yet. Place it on a date, or in a template.</p>
            )}
          </section>

          <p className="cc-fallback">{madeByLine(block)}</p>
          {canEdit &&
            (archiving ? (
              <Notice
                tone="standby"
                title={archiving}
                action={
                  <Button size="sm" onClick={() => void archive(true)}>
                    Take it off the log and archive
                  </Button>
                }
              >
                Dates you edited by hand keep theirs.
              </Notice>
            ) : (
              <button type="button" className="cc-btn-xs cc-bpage__archive" onClick={() => void archive(false)}>
                Archive block
              </button>
            ))}
        </div>
      </div>
    </div>
      </div>
      {adding && <AddFromLibrary block={block} items={library.data?.items ?? []} onAdd={addItem} onClose={() => setAdding(false)} />}
      {onDate && <OnADate block={block} onClose={() => setOnDate(false)} />}
      {guard.dialog}
    </>
  );
}
