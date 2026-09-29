// The library's parts, shared by setup step 2 (master-control A.2), the station's Library and the
// item page (live-listings 04.1): the folder rail, the drop zone with Import from a link, the
// summary, the table of items, and the rights pane (A.3, "Can BEAT air Crate Session 03?").

import { useEffect, useRef, useState, type DragEvent } from "react";
import { libraryApi, type Folder, type LibraryItem, type LibraryItem as Item } from "@opencast/contracts";
import { Button, ChoiceList, CodeSelect, Field, Icon, Menu, Modal, Sheet, Table, TitleCard, cx, duration, useToast, type Column, type MenuItem, type SelectableCode } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { call } from "../../../api/client";
import { useAuth } from "../../../auth/AuthProvider";
import { now as clockNow, STATION_TZ } from "../../../lib/clock";
import { librarySummary, readyLine } from "./logic";
import { sendFile } from "./upload";
import "./LibraryParts.css";

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
}

/** Folders on the left: the station's own, then the two "needs attention" lists (04.1). */
export function FolderRail({ base, active, total, folders, importedFromLinks, needsAttention }: FolderRailProps) {
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
      <div className="cc-folders__g cc-folders__g--gap">Needs attention</div>
      {link("rights", "Rights to confirm", needsAttention.rightsToConfirm, true)}
      {link("preparing", "Preparing for air", needsAttention.preparing)}
    </nav>
  );
}

// ---- Drop zone ----

/** "Drop video or audio files here", Choose files, Import from a link (A.2). */
export function UploadDrop({ stationId, folderId }: { stationId: string; folderId?: string | null }) {
  const auth = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [linking, setLinking] = useState(false);

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    let sent = 0;
    for (const f of list) {
      try {
        await sendFile(libraryApi.upload, { stationId }, f, { folderId: folderId ?? undefined }, auth.getToken);
        sent++;
      } catch (e) {
        toast.show({ message: `${f.name}: ${e instanceof Error ? e.message : "Something went wrong. Try again."}` });
      }
    }
    if (sent) {
      await refreshLibrary(qc);
      toast.show({ message: sent === 1 ? `${list[0]!.name} is being prepared for air.` : `${sent} files are being prepared for air.` });
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
  };

  return (
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
        <b>Drop video or audio files here</b>
        <small>MP4, MOV, MP3, WAV and most others. They're converted for air automatically.</small>
      </div>
      <div className="cc-drop__end">
        <Button size="sm" onClick={() => input.current?.click()}>Choose files</Button>
        <Button size="sm" icon="link" onClick={() => setLinking(true)}>
          Import from a link
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept="video/*,audio/*"
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = "";
        }}
      />
      <ImportLink open={linking} stationId={stationId} onClose={() => setLinking(false)} />
    </div>
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
}

export function LibraryTable({ items, colour, label, onRights, hrefFor, onOpen, empty }: LibraryTableProps) {
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
        </>
      )
    },
    { key: "type", header: "Type", width: "128px", cell: (i) => <CodeSelect value={i.code === "OPEN" ? "PGM" : i.code} label={`Type of ${i.title}`} onChange={(c) => void setCode(i, c)} /> },
    { key: "runs", header: "Runs", width: "64px", cell: (i) => <span className="cc-lib-row__d">{i.durationMs != null ? duration(i.durationMs) : "–"}</span> },
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
      <small>{readyLine(item)}</small>
    </span>
  );
}

// ---- Rights (A.3) ----

type Basis = "made_it" | "owner_permission" | "public_domain";

export function RightsPane({ item, callSign, phone, onClose }: { item: Item | null; callSign: string; phone: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [basis, setBasis] = useState<Basis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBasis(item?.rights && item.rights.basis !== "permission_record" && item.rights.basis !== "licence_record" ? item.rights.basis : null);
    setError(null);
  }, [item?.id, item?.rights]);
  if (!item) return null;
  const confirm = async () => {
    if (!basis) return;
    setBusy(true);
    try {
      await call(libraryApi.confirmRights, { params: { itemId: item.id }, body: { basis } });
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
      {link && <p className="cc-rights__note">Because it came from a link, it can air on {callSign} but can't be offered to other stations for carriage. If the owner asks, it comes off air the same day.</p>}
      {error && (
        <p className="cc-rights__error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
