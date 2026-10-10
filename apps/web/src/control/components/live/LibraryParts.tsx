// The library's parts, shared by setup step 2 (master-control A.2), the station's Library and the
// item page (live-listings 04.1): the folder rail, the drop zone with Import from a link, the
// summary, the table of items, the generated station ID's read-only row (added 2026-09-29; no
// frame draws it), and the rights pane (A.3, "Can BEAT air Crate Session 03?"). A242 (2026-10-02):
// openers, closers and off-air cards as types (the rail's "Sign-off and sign-on" lists, the drop
// zone's "Upload as", the type picker) and the sequence they air in (`SignOffSequence`; no frame
// draws them: rows and words like the library's own).

import { useEffect, useRef, useState, type DragEvent } from "react";
import { DEFAULT_OUTLETS, libraryApi, Outlet, OUTLET_WORDS, outletsWithOpencast, type Folder, type GeneratedStationId, type LibraryCode, type LibraryItem, type LibraryItem as Item } from "@opencast/contracts";
import { Button, Checkbox, ChoiceList, CodeSelect, Field, Icon, LIBRARY_CODES, LOG_CODE_WORDS, LogCode, Menu, Modal, Sheet, Table, TitleCard, cx, duration, useToast, type Column, type MenuItem, type SelectableCode } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { call } from "../../../api/client";
import { now as clockNow, STATION_TZ } from "../../../lib/clock";
import { librarySummary, readyLine } from "./logic";
import { UploadList } from "@opencast/ui/upload";
import { useUpload } from "./upload";
import { ROLE_WORDS, roleOf } from "./bumpers";
import "./LibraryParts.css";

/** An item's type as master control shows it: its identity code (A242), else its log code. */
export const typeOf = (i: Pick<Item, "code" | "identCode">): SelectableCode | "OPEN" => i.identCode ?? i.code;

/** The rail's lists of openers, closers and off-air cards (A242): their addresses and words. */
export const IDENT_LISTS = [
  { key: "openers", code: "OPN", title: "Openers", one: "opener" },
  { key: "closers", code: "CLS", title: "Closers", one: "closer" },
  { key: "off-air-cards", code: "OFF", title: "Off-air cards", one: "off-air card" }
] as const;

export const refreshLibrary = (qc: ReturnType<typeof useQueryClient>) =>
  Promise.all([qc.invalidateQueries({ queryKey: ["GET", libraryApi.getLibrary.path] }), qc.invalidateQueries({ queryKey: ["GET", libraryApi.getItem.path] })]);

// ---- Folder rail ----

export interface FolderRailProps {
  base: string;
  /** "all", a folder id, "links", "rights" or "preparing". */
  active: string;
  total: number;
  folders: Folder[];
  importedFromLinks: number;
  needsAttention: { rightsToConfirm: number; preparing: number };
  /** A242: how many openers, closers and off-air cards. Left out, the group isn't drawn. */
  identity?: { openers: number; closers: number; offAirCards: number };
  /** A243: how many bumpers (the Bumpers list). Left out, it isn't drawn. */
  bumpers?: number;
  /** A244: the station's programming blocks, a list each with how many items are theirs. */
  blocks?: Array<{ id: string; name: string; count: number }>;
}

/** A243: how many bumpers, for the rail's Bumpers list. */
export const bumperCount = (items: Item[]) => items.filter((i) => i.code === "BMP" && !i.identCode).length;

/** Counts for the rail's "Sign-off and sign-on" group (A242). */
export const identityCounts = (items: Item[]) => ({
  openers: items.filter((i) => i.identCode === "OPN").length,
  closers: items.filter((i) => i.identCode === "CLS").length,
  offAirCards: items.filter((i) => i.identCode === "OFF").length
});

/** Folders on the left: the station's own, the sign-off and sign-on lists (A242), then the two "needs attention" lists (04.1). */
export function FolderRail({ base, active, total, folders, importedFromLinks, needsAttention, identity, bumpers, blocks }: FolderRailProps) {
  const link = (key: string, label: string, count: number, warn = false) => (
    <a key={key} href={key === "all" ? `${base}/library` : `${base}/library/${key}`} className={cx(active === key && "cc-folders__on", warn && count > 0 && "cc-folders__warn")} aria-current={active === key ? "page" : undefined}>
      {label}
      <span className="cc-folders__ct" aria-label={`${count} ${count === 1 ? "item" : "items"}`}>
        {count}
      </span>
    </a>
  );
  return (
    <nav className="cc-folders" aria-label="Library folders">
      <div className="cc-folders__g">Library</div>
      {link("all", "All items", total)}
      {folders.filter((f) => !f.parentFolderId).map((f) => link(f.id, f.name, f.itemCount))}
      {link("links", "Imported from links", importedFromLinks, true)}
      {bumpers !== undefined && (
        <>
          <div className="cc-folders__g cc-folders__g--gap">Bumpers</div>
          {link("bumpers", "All bumpers", bumpers)}
        </>
      )}
      {identity && (
        <>
          <div className="cc-folders__g cc-folders__g--gap">Sign-off and sign-on</div>
          {link("closers", "Closers", identity.closers)}
          {link("off-air-cards", "Off-air cards", identity.offAirCards)}
          {link("openers", "Openers", identity.openers)}
        </>
      )}
      {/* A244: one list per programming block (its bumpers, ID, intro and outro). */}
      {blocks && blocks.length > 0 && (
        <>
          <div className="cc-folders__g cc-folders__g--gap">Blocks</div>
          {blocks.map((b) => link(`blocks/${b.id}`, b.name, b.count))}
        </>
      )}
      <div className="cc-folders__g cc-folders__g--gap">Needs attention</div>
      {link("rights", "Rights to confirm", needsAttention.rightsToConfirm, true)}
      {link("preparing", "Preparing for air", needsAttention.preparing)}
    </nav>
  );
}

// ---- Drop zone ----

/**
 * "Drop video or audio files here", Choose files, Import from a link (A.2). Files go straight to
 * storage in parts (follow-up Phase 4): each one's progress shows under the drop zone, with Pause,
 * Resume, Retry and Cancel, then "Checking" while the API reads it; once it's in the library below,
 * it leaves the list.
 */
export function UploadDrop({ stationId, folderId, code: preset, programBlockId }: { stationId: string; folderId?: string | null; code?: LibraryCode; programBlockId?: string | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [linking, setLinking] = useState(false);
  // A242: what the files are, when the station says ("Upload as"); else the type's guessed from the length.
  const [as, setAs] = useState<LibraryCode | "">(preset ?? "");
  useEffect(() => setAs(preset ?? ""), [preset]);
  const card = as === "OFF";
  const up = useUpload({
    id: `library-${stationId}`,
    // A244: dropped into a block's list, it's the block's (a bumper, ID, intro or outro).
    purpose: () => ({ kind: "library_item", stationId, fields: { ...(folderId ? { folderId } : {}), ...(as ? { code: as } : {}), ...(programBlockId ? { programBlockId } : {}) } }),
    clearFinishedAfterMs: 4000,
    onFinished: () => void refreshLibrary(qc),
    onBatchDone: ({ finished, failed }) => {
      for (const f of failed) toast.show({ message: `${f.name}: ${f.error ?? "Something went wrong. Try again."}` });
      if (finished.length) toast.show({ message: finished.length === 1 ? `${finished[0]!.name} is being prepared for air.` : `${finished.length} files are being prepared for air.` });
    }
  });
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) up.add(e.dataTransfer.files);
  };

  return (
    <>
      <div
        className={cx("cc-drop", over && "cc-drop--over")}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <span className="cc-drop__ic" aria-hidden="true">
          <Icon name="upload" />
        </span>
        <div>
          <b>{card ? "Drop an off-air card here" : "Drop video or audio files here"}</b>
          <small>{card ? "A picture (PNG, JPEG or WebP) or a short clip. It airs for a minute when you sign off." : "MP4, MOV, MP3, WAV and most others. They're converted for air automatically."}</small>
        </div>
        <div className="cc-drop__end">
          <label className="cc-drop__as">
            <span>Upload as</span>
            <select value={as} onChange={(e) => setAs(e.target.value as LibraryCode | "")}>
              <option value="">Guess from its length</option>
              {LIBRARY_CODES.map((c) => (
                <option key={c} value={c}>
                  {LOG_CODE_WORDS[c]}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" onClick={() => input.current?.click()}>Choose files</Button>
          <Button size="sm" icon="link" onClick={() => setLinking(true)}>
            Import from a link
          </Button>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          accept={card ? "video/*,audio/*,image/png,image/jpeg,image/webp" : "video/*,audio/*"}
          hidden
          onChange={(e) => {
            if (e.target.files?.length) up.add(e.target.files);
            e.target.value = "";
          }}
        />
        <ImportLink open={linking} stationId={stationId} onClose={() => setLinking(false)} />
      </div>
      <UploadList items={up.items} label="Uploading to the library" finishedWords="Uploaded. It's in the library below" onPause={up.pause} onResume={up.resume} onRetry={up.retry} onRemove={up.remove} />
    </>
  );
}

function ImportLink({ open, stationId, onClose }: { open: boolean; stationId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setText("");
      setError(null);
    }
  }, [open]);
  const submit = async () => {
    const urls = text.split(/\s+/).map((u) => u.trim()).filter(Boolean);
    if (!urls.length) return;
    if (urls.some((u) => !/^https?:\/\//.test(u))) {
      setError("Paste a link that starts with https://.");
      return;
    }
    setBusy(true);
    try {
      await call(libraryApi.importLinks, { params: { stationId }, body: { urls, expandPlaylists: false, code: "PGM" } });
      await refreshLibrary(qc);
      toast.show({ message: urls.length === 1 ? "Importing it. It's prepared for air when it arrives." : `Importing ${urls.length} links. Each is prepared for air when it arrives.` });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import from a link"
      footer={
        <>
          <Button variant="primary" onClick={() => void submit()} disabled={!text.trim() || busy}>
            Import
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <Field label="Link" value={text} placeholder="https://" onChange={(e) => setText(e.target.value)} error={error ?? undefined} help="A video or audio page. Anything from a link airs only on this station and can't be offered for carriage." />
    </Modal>
  );
}

// ---- Summary and table ----

export function LibrarySummary({ items }: { items: Item[] }) {
  const s = librarySummary(items);
  return (
    <p className="cc-lib-sum">
      <span>
        <b>
          {s.count} {s.count === 1 ? "item" : "items"}
        </b>
      </span>
      <span>
        <b>{s.programs}</b> of programs
      </span>
      <span>
        <b>{s.shorts}</b> of spots, IDs and bumpers
      </span>
      {s.needRights > 0 && <span className="cc-lib-sum__warn">{s.needRights} {s.needRights === 1 ? "needs" : "need"} rights confirmed</span>}
    </p>
  );
}

const dateWords = (x: string) => new Intl.DateTimeFormat("en-US", { timeZone: STATION_TZ, month: "long", day: "numeric" }).format(new Date(x));

/** "Imported from a link", "Uploaded today", "Uploaded September 24". */
export function itemOrigin(i: Pick<LibraryItem, "source" | "createdAt">, now = clockNow()): string {
  if (i.source === "link") return "Imported from a link";
  return dateWords(i.createdAt) === dateWords(now.toISOString()) ? "Uploaded today" : `Uploaded ${dateWords(i.createdAt)}`;
}

export interface LibraryTableProps {
  items: Item[];
  colour: string;
  label: string;
  onRights: (i: Item) => void;
  /** The item page's address, when rows open one. */
  hrefFor?: (i: Item) => string;
  onOpen?: (i: Item) => void;
  empty?: string;
  /** A244: the station's programming blocks, by id (a block's item shows its dot and name). */
  blocks?: Map<string, { name: string; colour: string | null }>;
}

export function LibraryTable({ items, colour, label, onRights, hrefFor, onOpen, empty, blocks }: LibraryTableProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const setCode = async (i: Item, code: SelectableCode) => {
    try {
      await call(libraryApi.updateItem, { params: { itemId: i.id }, body: { code } });
      await refreshLibrary(qc);
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : "Something went wrong. Try again." });
    }
  };
  const remove = async (i: Item) => {
    try {
      await call(libraryApi.deleteItem, { params: { itemId: i.id } });
      await refreshLibrary(qc);
      toast.show({ message: `${i.title} is removed from the library.` });
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : "Something went wrong. Try again." });
    }
  };

  const columns: Column<Item>[] = [
    { key: "pic", header: <span className="oc-sr-only">Picture</span>, width: "88px", cell: (i) => <TitleCard colour={colour} title={i.title} size="library" decorative /> },
    {
      key: "item",
      header: "Item",
      cell: (i) => (
        <>
          {hrefFor ? (
            <a className="cc-lib-row__title" href={hrefFor(i)}>
              {i.title}
            </a>
          ) : (
            <b className="cc-lib-row__title">{i.title}</b>
          )}
          <small>{itemOrigin(i)}</small>
          {/* A244: a programming block's item: its dot and name. */}
          {i.programBlockId && blocks?.get(i.programBlockId) && (
            <small className="cc-lib-row__block">
              <span className="cc-lib-row__dot" style={{ background: blocks.get(i.programBlockId)!.colour ?? "var(--ink-70)" }} aria-hidden="true" />
              {blocks.get(i.programBlockId)!.name}
            </small>
          )}
        </>
      )
    },
    {
      key: "type",
      header: "Type",
      width: "128px",
      cell: (i) => {
        const t = typeOf(i);
        // A picture is an off-air card and nothing else (A242). A243: a bumper's role under its type.
        return (
          <>
            <CodeSelect value={t === "OPEN" ? "PGM" : t} codes={i.still ? ["OFF"] : LIBRARY_CODES} label={`Type of ${i.title}`} onChange={(c) => void setCode(i, c)} />
            {t === "BMP" && <small className="cc-lib-row__role">{ROLE_WORDS[roleOf(i)]}</small>}
          </>
        );
      }
    },
    { key: "runs", header: "Runs", width: "64px", cell: (i) => <span className="cc-lib-row__d">{i.durationMs != null ? duration(i.durationMs) : i.still ? "Still" : "–"}</span> },
    { key: "status", header: "Status", width: "190px", cell: (i) => <ItemStatus item={i} onRights={() => onRights(i)} /> },
    {
      key: "menu",
      header: <span className="oc-sr-only">More</span>,
      width: "36px",
      cell: (i) => {
        const menu: MenuItem[] = [
          ...(onOpen ? [{ label: "Open", onSelect: () => onOpen(i) }] : []),
          ...(!i.rights ? [{ label: "Confirm rights", onSelect: () => onRights(i) }] : []),
          { label: "Remove", danger: true, onSelect: () => void remove(i) }
        ];
        return <Menu label={`More for ${i.title}`} items={menu} />;
      }
    }
  ];
  if (!items.length) return <p className="cc-lib-empty">{empty ?? "Nothing here yet."}</p>;
  return <Table label={label} columns={columns} rows={items} rowKey={(i) => i.id} gap={14} className="cc-lib-rows" />;
}

export function ItemStatus({ item, onRights }: { item: Item; onRights?: () => void }) {
  const rights = !item.rights && (
    <button type="button" className="cc-lib-rights" onClick={onRights}>
      Confirm rights to air it
    </button>
  );
  if (item.status === "preparing") {
    const pct = item.prepProgress ?? 0;
    return (
      <span className="cc-lib-status">
        Preparing for air, {pct}%
        <span className="cc-lib-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`Preparing ${item.title} for air`}>
          <i style={{ width: `${pct}%` }} />
        </span>
        {rights}
      </span>
    );
  }
  if (item.status === "failed") return <span className="cc-lib-status cc-lib-status--warn">Couldn't prepare it for air. Replace the file.</span>;
  if (!item.rights) return <span className="cc-lib-status">{rights}</span>;
  return (
    <span className="cc-lib-status">
      Ready for air
      <small>{item.still ? `A picture${item.picture ? `, ${item.picture.width}×${item.picture.height}` : ""}` : readyLine(item)}</small>
    </span>
  );
}

// ---- Sign-off and sign-on (A242) ----

const SEQUENCE_STEPS = ["Closer", "Off-air card", "off air", "Opener", "(Station ID)", "first program"] as const;

/**
 * "Closer → Off-air card → off air → Opener → (Station ID) → first program": what airs when the
 * station signs off and back on, with what it airs where it has none of its own. `items`: the
 * library's (to say which are its own); `ident`: "12.1 BEAT", as the automatic ones say it;
 * `radio`: the radio band's words.
 */
export function SignOffSequence({ items, ident, radio, stationIdAfterOpener }: { items: Item[]; ident: string; radio: boolean; stationIdAfterOpener?: boolean }) {
  const counts = identityCounts(items.filter((i) => i.status === "ready" && i.rights));
  const own = (n: number, one: string, many: string, fallback: string) => (n === 0 ? fallback : n === 1 ? `Your ${one}` : `Your ${n} ${many}, a day each in turn`);
  const rows = [
    { code: "CLS" as const, title: "Closer", detail: own(counts.closers, "closer", "closers", `Made for you: "${ident} · Signing off · Back at 6:00 am", in your look`) },
    { code: "OFF" as const, title: "Off-air card", detail: own(counts.offAirCards, "off-air card", "off-air cards", `Made for you: ${ident}, off air, and when you're back`) + ". For a minute, then the channel ends" },
    { code: "OPN" as const, title: "Opener", detail: own(counts.openers, "opener", "openers", `Made for you: "${ident} · Signing on", in your look`) + ". It ends as the first program starts" },
    { code: "SID" as const, title: "Station ID", detail: stationIdAfterOpener ? "After the opener" : "Only if you turn it on in Settings, Breaks. The opener replaces it" }
  ];
  return (
    <section className="cc-signoff" aria-label="When you sign off and back on">
      <p className="cc-signoff__line">
        {SEQUENCE_STEPS.map((step, n) => (
          <span key={step}>
            {n > 0 && <span aria-hidden="true"> → </span>}
            {step}
          </span>
        ))}
      </p>
      <ul className="cc-signoff__rows">
        {rows.map((r) => (
          <li key={r.code}>
            <LogCode code={r.code} />
            <span>
              <b>{r.title}</b>
              <small>{r.detail}</small>
            </span>
          </li>
        ))}
      </ul>
      <p className="cc-signoff__note">
        {radio ? "On the radio band, openers and closers are audio, and the off-air card is a short clip or a picture your relays show." : "Openers and closers are short clips. An off-air card is a picture or a short clip."} Off air time too short to go dark keeps the channel on: closer, the card, opener.
      </p>
    </section>
  );
}

// ---- The generated station ID (added 2026-09-29) ----

const GENERATED_STATUS: Record<GeneratedStationId["status"], string> = { ready: "Ready for air", preparing: "Being prepared", failed: "Couldn't be prepared" };

/**
 * The station ID Opencast makes while the station has none of its own that can air: a read-only
 * row beside the library's items, laid out like theirs (picture, item, type, runs, status), with
 * Preview. Any station ID the station uploads replaces it.
 */
export function GeneratedStationIdRow({ generated, callSign, colour, radio, phone }: { generated: GeneratedStationId; callSign: string; colour: string; radio: boolean; phone: boolean }) {
  const [open, setOpen] = useState(false);
  const Dialog = phone ? Sheet : Modal;
  const look = generated.look;
  return (
    <div className="cc-gensid" role="group" aria-label="Generated station ID">
      <TitleCard colour={look.colour ?? colour} title={look.callSign ?? look.name} size="library" decorative />
      <div className="cc-gensid__item">
        <b className="cc-lib-row__title">Generated station ID</b>
        <small>Made for {callSign}. Replaced by any station ID you upload</small>
      </div>
      <span className="cc-gensid__code">
        <LogCode code="SID" />
      </span>
      <span className="cc-lib-row__d">{duration(generated.durationMs)}</span>
      <span className={cx("cc-lib-status", generated.status === "failed" && "cc-lib-status--warn")}>
        {GENERATED_STATUS[generated.status]}
        <span className="cc-gensid__preview">
          <Button variant="text" size="sm" onClick={() => setOpen(true)}>
            Preview
          </Button>
        </span>
      </span>
      <Dialog open={open} onClose={() => setOpen(false)} eyebrow="Made for you" title="Generated station ID" footer={<Button onClick={() => setOpen(false)}>Done</Button>}>
        <div className="cc-gensid__card" style={{ background: look.colour ?? colour }} role="img" aria-label={`${[look.callSign ?? look.name, look.channel].filter(Boolean).join(" ")} in ${callSign}'s colour`}>
          <b>{look.callSign ?? look.name}</b>
          {look.channel && <span className="oc-mono">{look.channel}</span>}
          <small>{[look.callSign ? look.name : null, look.city].filter(Boolean).join(" · ")}</small>
        </div>
        <p className="cc-gensid__note">
          {radio
            ? `Ten seconds of a soft sound bed, where ${callSign} needs a station ID. Relays show ${callSign}'s colour with its call sign and channel over it.`
            : `Ten seconds over a soft sound bed, where ${callSign} needs a station ID: in breaks, in open time and when it signs back on.`}{" "}
          It's made again when {callSign}'s name, call sign, channel or colour changes, and any station ID you upload replaces it.
        </p>
      </Dialog>
    </div>
  );
}

// ---- Rights (A.3) ----

type Basis = "made_it" | "owner_permission" | "public_domain";

/**
 * Programming Phase 6 (P6.13): where the owner's permission lets it go besides this station, as
 * the API keeps it (`opencast` always; `opencast` and `relays` until the person says otherwise).
 */
function ownerOutlets(item: Item | null): Outlet[] {
  return item?.rights?.basis === "owner_permission" && item.rights.outlets ? outletsWithOpencast(item.rights.outlets) : [...DEFAULT_OUTLETS];
}

export function RightsPane({ item, callSign, phone, onClose }: { item: Item | null; callSign: string; phone: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [basis, setBasis] = useState<Basis | null>(null);
  const [outlets, setOutlets] = useState<Outlet[]>(() => ownerOutlets(item));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBasis(item?.rights && item.rights.basis !== "permission_record" && item.rights.basis !== "licence_record" ? item.rights.basis : null);
    setOutlets(ownerOutlets(item));
    setError(null);
  }, [item?.id, item?.rights]);
  if (!item) return null;
  const confirm = async () => {
    if (!basis) return;
    setBusy(true);
    try {
      // Only the owner's permission has a say: made it and public domain go everywhere.
      await call(libraryApi.confirmRights, { params: { itemId: item.id }, body: basis === "owner_permission" ? { basis, outlets: outletsWithOpencast(outlets) } : { basis } });
      await refreshLibrary(qc);
      toast.show({ message: `${callSign} can air ${item.title}.` });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await call(libraryApi.deleteItem, { params: { itemId: item.id } });
      await refreshLibrary(qc);
      toast.show({ message: `${item.title} is removed from the library.` });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const Dialog = phone ? Sheet : Modal;
  const link = item.source === "link";
  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow={link ? "Imported from a link" : itemOrigin(item)}
      title={`Can ${callSign} air ${item.title}?`}
      footer={
        <>
          <Button variant="primary" onClick={() => void confirm()} disabled={!basis || busy}>
            Confirm rights
          </Button>
          <Button onClick={() => void remove()} disabled={busy}>
            Remove it
          </Button>
        </>
      }
    >
      <ChoiceList<Basis>
        label={`Can ${callSign} air ${item.title}?`}
        value={basis}
        onChange={setBasis}
        options={[
          { value: "made_it", title: "I made it", helper: "You own it outright" },
          { value: "owner_permission", title: "The owner gave permission", helper: "Keep that permission somewhere you can find it" },
          { value: "public_domain", title: "It's in the public domain", helper: "No one owns it any more" }
        ]}
      />
      {basis === "owner_permission" && (
        <div className="cc-rights__outlets">
          <h3 className="cc-rights__h">Where the owner allows it</h3>
          <p className="cc-rights__sub">Opencast is always on. Tick what else the owner agreed to.</p>
          <div role="group" aria-label="Where the owner allows it">
            {Outlet.options.map((o) => (
              <Checkbox
                key={o}
                checked={o === "opencast" || outlets.includes(o)}
                disabled={o === "opencast"}
                onChange={(on) => setOutlets(on ? [...outlets, o] : outlets.filter((x) => x !== o))}
                label={OUTLET_WORDS[o].label}
                helper={OUTLET_WORDS[o].detail}
              />
            ))}
          </div>
        </div>
      )}
      {link && <p className="cc-rights__note">Because it came from a link, it can air on {callSign} but can't be offered to other stations for carriage. If the owner asks, it comes off air the same day.</p>}
      {error && (
        <p className="cc-rights__error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
