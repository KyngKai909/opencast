// 04.1 a library item (/:callSign/library/items/:itemId?folder=:folderId): the file, how it was
// prepared for air, its rights, whether it's offered for carriage, where it's scheduled and every
// time it has aired (L5), replacing its file (L6), and removing it (guarded while anything uses it).
// "For air" is L5's `preparation`: prepared for air, being prepared, or couldn't be prepared. What
// preparing did to the picture (programming Phase 1) follows its size: "1920 by 1080. Converted from HDR".

import { useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { libraryApi, RIGHTS_BASIS_LABELS, blocksApi } from "@opencast/contracts";
import { Button, Checkbox, KeyValueList, Modal, PictureFrame, PicturePlaceholder, duration, useToast } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { call } from "../../../api/client";
import { useApi } from "../../../api/hooks";
import { now as clockNow, STATION_TZ } from "../../../lib/clock";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { useStation } from "../../station/StationContext";
import { bumperCount, FolderRail, identityCounts, ItemStatus, refreshLibrary, RightsPane, typeOf } from "../../components/live/LibraryParts";
import { AirWindowSection, BlockSection, BumperRoleSection, WINDOWED } from "../../components/live/BumperFields";
import { airedLabel, readyLine, relativeLabel, whenLabel } from "../../components/live/logic";
import { languageName } from "../../components/live/listings";
import { conversionWords, preparationWords } from "../../components/onair/readiness";
import { SecTop } from "../../components/live/Studio";
import { UploadList } from "@opencast/ui/upload";
import { useUpload } from "../../components/live/upload";
import { NotFound, Quiet } from "../common";
import "./Library.css";
import "./LibraryItem.css";

const CODE_WORDS: Record<string, string> = { PGM: "Program", SPT: "Spot", UND: "Underwriting", BMP: "Bumper", SID: "Station ID", OPEN: "Open", OPN: "Opener", CLS: "Closer", OFF: "Off-air card" };
const TERMS: Record<string, string> = { barter: "Barter terms", cash: "Cash terms", cash_and_barter: "Cash and barter terms", free: "Free to carry" };
const dateWords = (x: string) => new Intl.DateTimeFormat("en-US", { timeZone: STATION_TZ, month: "long", day: "numeric" }).format(new Date(x));

export default function LibraryItem() {
  const { itemId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const s = useStation();
  const phone = useIsPhone();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  useShellOptions({ flush: true });
  const lib = useApi(libraryApi.getLibrary, { params: { stationId: s.id }, query: {} });
  const itemQ = useApi(libraryApi.getItem, { params: { itemId } }, { refetchInterval: (q) => (q.state.data?.status === "preparing" ? 2000 : false) });
  const history = useApi(libraryApi.getItemHistory, { params: { itemId } }, { retry: false });
  const blocks = useApi(blocksApi.listBlocks, { params: { stationId: s.id } }, { retry: false });
  const file = useRef<HTMLInputElement>(null);
  // L6: the new file goes straight to storage in parts (follow-up Phase 4), then through the same checks.
  const up = useUpload({
    id: `replace-${itemId}`,
    purpose: () => ({ kind: "library_replace", itemId }),
    clearFinishedAfterMs: 4000,
    onFinished: (f) => {
      void refreshLibrary(qc);
      toast.show({ message: `${f.name} is being prepared for air. ${itemQ.data?.title ?? "The item"} keeps its history and schedule.` });
    },
    onFailed: (f) => toast.show({ message: f.error ?? "Something went wrong. Try again." })
  });
  const [exporting, setExporting] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  if (itemQ.isLoading || lib.isLoading) return <Quiet />;
  const item = itemQ.data;
  if (!item) return itemQ.error && (itemQ.error as { status?: number }).status !== 404 ? <p role="alert">{itemQ.error.message}</p> : <NotFound />;
  const data = lib.data;
  const folder = data?.folders.find((f) => f.id === (params.get("folder") ?? item.folderId));
  const callSign = s.label;
  const ident = `${s.station.callSign ?? s.station.name} ${s.station.channel ?? ""}`.trim();
  const program = data?.programs.find((p) => p.id === item.programId);
  const h = history.data;
  const now = clockNow();
  const inUse = h ? h.logEntries + h.carriers > 0 : true;

  const replace = (f: File) => up.add([f]);
  const remove = async () => {
    try {
      await call(libraryApi.deleteItem, { params: { itemId: item.id } });
      await refreshLibrary(qc);
      toast.show({ message: `${item.title} is removed from the library.` });
      navigate(`${s.base}/library${folder ? `/${folder.id}` : ""}`, { replace: true });
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    }
  };

  const usageWords = h
    ? [h.logEntries ? `in ${h.logEntries} log ${h.logEntries === 1 ? "entry" : "entries"}` : null, h.carriers ? `carried by ${h.carriers} ${h.carriers === 1 ? "station" : "stations"}` : null].filter(Boolean).join(" and ")
    : "";
  const rightsTitle = item.rights ? (item.rights.basis === "made_it" ? `Made by ${callSign}` : RIGHTS_BASIS_LABELS[item.rights.basis]) : null;
  const sound = item.status === "ready" ? `${h?.audioLayout ? `${h.audioLayout[0]!.toUpperCase()}${h.audioLayout.slice(1)}, ` : ""}levelled to broadcast loudness` : null;
  const captions = item.captions === "none" ? "None" : `${item.captions === "generated" ? "Generated" : "Uploaded"}${h?.captionLanguage ? `, ${languageName(h.captionLanguage)}` : ""}`;
  const contentId = item.storage?.contentId;
  const prepared = preparationWords(h?.preparation?.status);
  const converted = conversionWords(h?.preparation?.converted);

  return (
    <div className="cc-libwrap">
      {data && <FolderRail base={s.base} active={folder?.id ?? "all"} total={data.items.length} folders={data.folders} importedFromLinks={data.importedFromLinks} needsAttention={data.needsAttention} identity={identityCounts(data.items)} bumpers={bumperCount(data.items)} />}
      <div className="cc-item">
        <nav className="cc-item__crumbs" aria-label="Where this is">
          <a href={`${s.base}/library`}>Library</a>
          {folder && (
            <>
              {" / "}
              <a href={`${s.base}/library/${folder.id}`}>{folder.name}</a>
            </>
          )}
        </nav>
        <div className="cc-item__h">
          <div>
            <h1>{item.title}</h1>
            <p>
              {CODE_WORDS[typeOf(item)]}
              {item.still ? ", a picture" : null}
              {item.durationMs != null ? <>, <span className="oc-mono">{duration(item.durationMs)}</span></> : null}. {item.source === "link" ? "Imported from a link" : `Uploaded ${dateWords(item.createdAt)}`}.
            </p>
          </div>
          <div className="cc-item__end">
            <Button size="sm" onClick={() => file.current?.click()} disabled={up.busy}>
              Replace file
            </Button>
            {item.identCode ? (
              // A242: openers, closers and off-air cards air at sign-off and sign-on, not from the log.
              <Button size="sm" href={`${s.base}/schedule/rules`}>
                Sign-off and sign-on
              </Button>
            ) : item.rights && item.status === "ready" ? (
              <Button size="sm" href={`${s.base}/schedule?edit=1&add=${item.id}`}>Schedule</Button>
            ) : (
              <Button size="sm" disabled title="Confirm its rights, and let it be prepared for air, to schedule it.">
                Schedule
              </Button>
            )}
            {s.can("manage") && item.source !== "link" && (
              <Button size="sm" onClick={() => setExporting(true)} disabled={!item.storage || !!item.storage.ipfs}>
                Export to IPFS
              </Button>
            )}
            <input
              ref={file}
              type="file"
              accept={item.identCode === "OFF" ? "video/*,audio/*,image/png,image/jpeg,image/webp" : "video/*,audio/*"}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void replace(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        <UploadList items={up.items} label="Replacing the file" finishedWords="Uploaded. It airs once it's prepared" onPause={up.pause} onResume={up.resume} onRetry={up.retry} onRemove={up.remove} />

        <div className="cc-item__grid">
          <div>
            <PictureFrame label={`${item.title}, the picture`}>
              <PicturePlaceholder scene="reel" title={program?.title ?? item.title} subtitle={item.episodeNumber ? `Episode ${item.episodeNumber}` : undefined} />
            </PictureFrame>
            {item.status !== "ready" && (
              <div className="cc-item__status">
                <ItemStatus item={item} onRights={() => setParams((p) => (p.set("rights", item.id), p))} />
              </div>
            )}

            <section className="cc-item__sec" aria-labelledby="cc-inlog-h">
              <SecTop
                id="cc-inlog-h"
                title={
                  <>
                    In the log{h && <span className="cc-item__sub">{h.scheduled.length ? `${h.scheduled.length} ${h.scheduled.length === 1 ? "airing" : "airings"} scheduled` : "Nothing scheduled"}</span>}
                  </>
                }
              />
              {history.isError ? (
                <p className="cc-item__quiet">{history.error.message}</p>
              ) : (
                <KeyValueList
                  variant="rows"
                  className="cc-item__airs"
                  items={(h?.scheduled ?? []).map((a) => ({
                    title: whenLabel(a.startsAt, now, STATION_TZ),
                    detail: a.note ?? `${a.station.callSign ?? a.station.name} ${a.station.channel ?? ""}`.trim(),
                    value: <span className="cc-item__rel">{relativeLabel(a.startsAt, now, STATION_TZ)}</span>
                  }))}
                />
              )}
            </section>

            <section className="cc-item__sec" aria-labelledby="cc-aired-h">
              <SecTop
                id="cc-aired-h"
                title={
                  <>
                    Aired<span className="cc-item__sub">From the as-run log</span>
                  </>
                }
              />
              {h && !h.aired.length && <p className="cc-item__quiet">It hasn't aired yet.</p>}
              <KeyValueList
                variant="rows"
                className="cc-item__airs"
                items={(h?.aired ?? []).map((a) => ({
                  title: airedLabel(a.startedAt, STATION_TZ),
                  detail: [`${a.station.callSign ?? a.station.name} ${a.station.channel ?? ""}`.trim(), a.carried ? "carried" : null, a.audioOnly ? "audio only" : null, a.note].filter(Boolean).join(", "),
                  value: <span className="cc-item__rel">Aired</span>
                }))}
              />
            </section>
          </div>

          <div>
            <section aria-labelledby="cc-prep-h">
              <SecTop id="cc-prep-h" title="Prepared for air" />
              <KeyValueList
                className="cc-item__kv"
                items={[
                  // Cleaner pictures: an HDR phone clip tonemapped, an interlaced one deinterlaced, said after its size.
                  { label: "Picture", value: [item.picture ? `${item.picture.width} by ${item.picture.height}` : item.mediaKind === "audio" ? "Audio only" : "Not yet", converted].filter(Boolean).join(". ") },
                  ...(sound ? [{ label: "Sound", value: sound }] : []),
                  { label: "Captions", value: captions },
                  ...(item.storage ? [{ label: "Stored", value: item.storage.sharedWith > 0 ? "Once, shared by every station airing it" : "Once" }] : []),
                  ...(contentId ? [{ label: "Content ID", value: <span className="oc-mono cc-item__cid">{shortId(contentId)}</span> }] : []),
                  ...(item.storage?.ipfs ? [{ label: "On IPFS", value: <a href={item.storage.ipfs.url} target="_blank" rel="noreferrer" className="oc-mono cc-item__cid">{shortId(item.storage.ipfs.cid)}</a> }] : []),
                  // Prepare once, then assemble: where its preparation for air stands (not asked for yet: no line).
                  ...(prepared ? [{ label: "For air", value: prepared }] : [])
                ]}
              />
              {item.status === "ready" && !sound && <small className="cc-item__quiet">{readyLine(item)}</small>}
            </section>

            {/* A243: a bumper's role, and when bumpers, station IDs, openers and closers air. */}
            {typeOf(item) === "BMP" && <BumperRoleSection item={item} radio={s.station.band === "radio"} canEdit={s.can("programming")} />}
            {WINDOWED.includes(typeOf(item)) && <AirWindowSection item={item} canEdit={s.can("programming")} />}
            {/* A244: a bumper, station ID, opener or closer can be a programming block's. */}
            {WINDOWED.includes(typeOf(item)) && <BlockSection item={item} callSign={s.label} blocks={blocks.data?.blocks ?? []} canEdit={s.can("programming")} />}

            <section className="cc-item__side" aria-labelledby="cc-rights-h">
              <SecTop id="cc-rights-h" title="Rights" />
              {item.rights ? (
                <KeyValueList variant="rows" items={[{ title: rightsTitle, detail: `Confirmed by ${item.rights.confirmedBy ?? "the station"}, ${dateWords(item.rights.confirmedAt)}` }]} />
              ) : (
                <KeyValueList
                  variant="rows"
                  items={[
                    {
                      title: <span className="cc-item__warn">Confirm rights to air it</span>,
                      detail: "It can sit in the library, but it can't go on the log until you do.",
                      actions: (
                        <Button size="sm" onClick={() => setParams((p) => (p.set("rights", item.id), p))}>
                          Confirm rights
                        </Button>
                      )
                    }
                  ]}
                />
              )}
            </section>

            <section className="cc-item__side" aria-labelledby="cc-carriage-h">
              <SecTop id="cc-carriage-h" title="Carriage" />
              <KeyValueList
                variant="rows"
                items={[
                  !item.offerable
                    ? { title: "Can't be offered for carriage", detail: `It came from a link, so it airs only on ${callSign}.` }
                    : h?.carriage.offered
                      ? {
                          title: `Offered as part of ${h.carriage.program}`,
                          detail: `${h.carriage.terms ? TERMS[h.carriage.terms] : "Terms set"}. Carried by ${h.carriers} ${h.carriers === 1 ? "station" : "stations"}`,
                          actions: s.can("programming") ? (
                            <Button size="sm" href={`${s.base}/market/offered`}>
                              Terms
                            </Button>
                          ) : undefined
                        }
                      : { title: "Not offered", detail: program ? `Offer ${program.title} in the syndication market to let other stations carry it.` : "Put it in a program to offer it in the syndication market." }
                ]}
              />
            </section>

            <section className="cc-item__side" aria-labelledby="cc-remove-h">
              <SecTop id="cc-remove-h" title="Remove" />
              {inUse ? (
                <KeyValueList variant="rows" items={[{ title: "Can't be deleted yet", detail: h ? `It's ${usageWords}. Take it out of those first.` : "Checking what uses it." }]} />
              ) : (
                <KeyValueList
                  variant="rows"
                  items={[
                    {
                      title: "Nothing uses it",
                      detail: "Removing it deletes the file from the library.",
                      actions: (
                        <Button size="sm" onClick={() => void remove()}>
                          Remove
                        </Button>
                      )
                    }
                  ]}
                />
              )}
              {removeError && (
                <p className="cc-item__quiet" role="alert">
                  {removeError}
                </p>
              )}
            </section>
          </div>
        </div>
      </div>
      <RightsPane item={params.get("rights") === item.id ? item : null} callSign={callSign} phone={phone} onClose={() => setParams((p) => (p.delete("rights"), p), { replace: true })} />
      <ExportIpfs open={exporting} itemId={item.id} title={item.title} onClose={() => setExporting(false)} />
    </div>
  );
}

/** "bafy…3xq7": a content ID's start and end. */
function shortId(id: string): string {
  const clean = id.replace("…", "");
  return clean.length > 12 ? `${clean.slice(0, 4)}…${clean.slice(-4)}` : id;
}

/** IPFS files are public and can't be taken back, so it asks once (owners only). */
function ExportIpfs({ open, itemId, title, onClose }: { open: boolean; itemId: string; title: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    try {
      await call(libraryApi.exportToIpfs, { params: { itemId }, body: { understandPublicAndPermanent: true } });
      await refreshLibrary(qc);
      toast.show({ message: `${title} is on IPFS.` });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export to IPFS"
      subtitle={title}
      footer={
        <>
          <Button variant="primary" onClick={() => void go()} disabled={!sure}>
            Export to IPFS
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <p className="cc-item__dialog-p">Your original is published to IPFS under the same content ID, for a copy that lives outside Opencast.</p>
      <Checkbox checked={sure} onChange={setSure} label="I understand IPFS files are public and can't be taken back." />
      {error && (
        <p className="cc-item__dialog-p" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
