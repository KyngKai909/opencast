// A246: the Add drawer (opencast-schedule 04): "Add at 11:40 pm", the space it's adding into ("20
// min free, until Late Crate, ep. 13 at 12:00 am"), and what can go there, by tab: the library,
// programs the station carries, a live block from one of its sources, or signing off. Each choice
// says how it fits the space: "Fits", "9 min over" with what it pushes (as far as the next fixed
// point, reorder.ts), "Next episode" for a series, and "Never aired". Programming Phase 2: the
// library says which episode is next (after its program's last airing, from the as-run log) and
// what never aired; a series on the day loaded goes on from its latest airing there, scheduled or
// aired. A choice joins the draft (edit mode). Quick fill
// fills dead air: repeat from the library, or sign off until the next program; with nothing
// drafted it's written at once (`fillGap`) and the draft takes the new version, else it joins the
// draft as inserts so one publish covers everything (decision 8).

import { useEffect, useMemo, useRef, useState } from "react";
import { catalogApi, libraryApi, logApi, stationsApi, type LibraryItem, type LogChange, type LogEntry } from "@opencast/contracts";
import { Drawer, Field, SelectField, Tabs, clock, minutesText, snapTime, useToast } from "@opencast/ui";
import { useApi, useApiMutation } from "../../../api/hooks";
import { now as clockNow, STATION_TZ } from "../../../lib/clock";
import { stationLabel } from "../../station/slug";
import { LOG_READS } from "./data";
import { rowLength } from "./dayRows";
import { itemOf } from "./LogEditor";
import { wholeMinutes, type DraftItem } from "./logEdit";
import { makeRoom, type Reflow } from "./reorder";
import { airable, planRepeat } from "./repeat";

const MIN = 60_000;
const t = (s: string) => Date.parse(s);
const iso = (n: number) => new Date(n).toISOString();
const DEFAULT_BREAK_MS = 2 * MIN;
/** How many library items show before "Show all". */
const SHORT_LIST = 6;

export type AddTab = "library" | "carried" | "live" | "sign_off";

/** The space something is added into: until what, and when. */
export interface AddSpace {
  at: string;
  /** Where the space ends (the next thing on the log), or null when nothing follows on the day. */
  endsAt: string | null;
  /** "Late Crate, ep. 13", "off air". */
  next: string | null;
  /** The space is dead air: quick fill can fill it. */
  gap: boolean;
}

/** "20 min free, until Late Crate, ep. 13 at 12:00 am". */
export function spaceLine(s: AddSpace, tz = STATION_TZ): string {
  if (!s.endsAt) return "Nothing after it on this day";
  const free = t(s.endsAt) - t(s.at);
  const until = s.next ? `until ${s.next} at ${clock(s.endsAt, { timeZone: tz })}` : `until ${clock(s.endsAt, { timeZone: tz })}`;
  return free > 0 ? `${minutesText(free)} free, ${until}` : `No time free: it starts ${until.replace(/^until /, "where ")}`;
}

export interface Fit {
  badge: "fits" | "over" | "next" | "never";
  /** "9 min over", "Fits", "Next episode", "Never aired". */
  label: string;
  /** "29:10, runs 9 min over: ep. 13 moves to 12:09 am". */
  line: string;
}

/** How something of `lengthMs` fits the space, and what it pushes when it doesn't. Next episode wins over Never aired. */
export function fitOf(lengthMs: number, space: AddSpace, reflow: Reflow, next: boolean, tz = STATION_TZ, neverAired = false): Fit {
  const len = wholeMinutes(lengthMs);
  const lead = next ? "Next episode. " : neverAired ? "Never aired. " : "";
  const free = space.endsAt ? t(space.endsAt) - t(space.at) : null;
  if (free === null || len <= free) {
    const left = free === null ? null : free - len;
    const rest = left === null || left < MIN ? "" : left < 5 * MIN ? `. Leaves ${rowLength(left)} for a break` : `. Leaves ${minutesText(left)}`;
    const [badge, label] = next ? (["next", "Next episode"] as const) : neverAired ? (["never", "Never aired"] as const) : (["fits", "Fits"] as const);
    return { badge, label, line: `${lead}${rowLength(len)}${rest}` };
  }
  const over = Math.ceil((len - free) / MIN);
  const moves = makeRoom(reflow, space.at, len);
  const first = moves[0]?.op === "move" ? moves[0] : null;
  const who = first ? reflow.entries.find((e) => e.id === first.entryId) : null;
  const pushes = who && first?.op === "move" ? `: ${who.title} moves to ${clock(first.startsAt, { timeZone: tz })}` : space.next ? `, into ${space.next}` : "";
  return { badge: "over", label: `${over} min over`, line: `${lead}${rowLength(len)}, runs ${over} min over${pushes}` };
}

/**
 * Each series' next episode. On the day loaded, the episode after its latest airing there
 * (scheduled or aired); otherwise the library's (`nextEpisode`: after its last airing in the as-run
 * log, Programming Phase 2).
 */
export function nextEpisodes(entries: Array<Pick<LogEntry, "itemId" | "programId" | "startsAt">>, items: LibraryItem[]): Set<string> {
  const latest = new Map<string, LibraryItem>();
  for (const e of [...entries].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const it = e.itemId ? items.find((i) => i.id === e.itemId) : undefined;
    if (it?.programId && it.episodeNumber !== null) latest.set(it.programId, it);
  }
  const next = new Set<string>();
  for (const [programId, it] of latest) {
    const n = items.find((i) => i.programId === programId && (i.seasonNumber ?? null) === (it.seasonNumber ?? null) && i.episodeNumber === (it.episodeNumber ?? 0) + 1);
    if (n) next.add(n.id);
  }
  for (const i of items) if (i.nextEpisode && i.programId && !latest.has(i.programId)) next.add(i.id);
  return next;
}

/** Library items in the order they're shown: next episodes, then what fits, then the rest; a search narrows them. */
function ordered(items: LibraryItem[], next: Set<string>, fits: (i: LibraryItem) => boolean, query: string): LibraryItem[] {
  const q = query.trim().toLowerCase();
  const rank = (i: LibraryItem) => (next.has(i.id) ? 0 : fits(i) ? 1 : 2);
  return items.filter((i) => !q || i.title.toLowerCase().includes(q)).sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}

/** Repeat from the library, as inserts in the draft: in order, whole minutes, a break after each, the last cut where the space ends. */
export function repeatInserts(items: Array<Pick<LibraryItem, "id" | "durationMs">>, at: string, endsAt: string, breakMs: number, key: (i: number) => string): LogChange[] {
  const out: LogChange[] = [];
  const end = t(endsAt);
  let cursor = Math.ceil(t(at) / MIN) * MIN;
  for (let n = 0; cursor < end && n < 200 && items.length; n++) {
    const it = items[n % items.length];
    const stop = Math.min(end, cursor + wholeMinutes(it.durationMs ?? 0));
    if (stop - cursor < MIN) break;
    out.push({ op: "insert", key: key(n), entry: { kind: "program", startsAt: iso(cursor), endsAt: iso(stop), itemId: it.id } });
    cursor = stop + breakMs;
  }
  return out;
}

export interface AddDrawerProps {
  stationId: string;
  space: AddSpace;
  /** The draft's entries and how they move. */
  reflow: Reflow;
  /** The day's log as loaded, for "Next episode". */
  loaded: LogEntry[];
  /** Nothing drafted: quick fill writes at once. */
  draftEmpty: boolean;
  /** A choice joins the draft (and opens edit mode). */
  onAdd: (changes: LogChange[], items: DraftItem[]) => void;
  /** Quick fill wrote to the log at once: the draft takes the new version. */
  onFilled: () => void;
  nextKey: () => string;
  /** `?add=<itemId>`: the library item to show first. */
  highlight?: string | null;
  base: string | null;
  onClose: () => void;
}

export function AddDrawer({ stationId, space, reflow, loaded, draftEmpty, onAdd, onFilled, nextKey, highlight, base, onClose }: AddDrawerProps) {
  const toast = useToast();
  const [tab, setTab] = useState<AddTab>("library");
  const [query, setQuery] = useState("");
  // The first few, then all of them: quick fill stays in view below a short list.
  const [all, setAll] = useState(false);
  const library = useApi(libraryApi.getLibrary, { params: { stationId }, query: {} });
  const rule = useApi(stationsApi.getBreakRule, { params: { stationId } }, { retry: false });
  const agreements = useApi(catalogApi.listAgreements, { params: { stationId } }, { enabled: tab === "carried", retry: false });
  const [agreementId, setAgreementId] = useState<string | null>(null);
  const carrying = (agreements.data?.carrying ?? []).filter((a) => !a.endsAt || Date.parse(a.endsAt) > clockNow().getTime());
  const agreement = carrying.find((a) => a.id === agreementId) ?? carrying[0];
  const offer = useApi(catalogApi.getOffer, { params: { offerId: agreement?.offerId ?? "" } }, { enabled: tab === "carried" && !!agreement?.offerId, retry: false });
  const sources = useApi(stationsApi.listLiveSources, { params: { stationId } }, { enabled: tab === "live", retry: false });
  const [programId, setProgramId] = useState("");
  const fill = useApiMutation(logApi.fillGap, { invalidates: LOG_READS });
  const list = useRef<HTMLUListElement>(null);

  const items = airable(library.data?.items ?? []);
  const next = useMemo(() => nextEpisodes(loaded, library.data?.items ?? []), [loaded, library.data]);
  const free = space.endsAt ? t(space.endsAt) - t(space.at) : Infinity;
  const shown = ordered(items, next, (i) => wholeMinutes(i.durationMs ?? 0) <= free, query);
  if (highlight) shown.sort((a, b) => Number(b.id === highlight) - Number(a.id === highlight));
  useEffect(() => {
    if (highlight) list.current?.querySelector<HTMLElement>(`[data-item="${highlight}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [highlight, library.data]);

  const breakMs = rule.data?.lengthMs ?? DEFAULT_BREAK_MS;
  const until = space.endsAt ? clock(space.endsAt, { timeZone: STATION_TZ }) : null;

  const put = (entry: Extract<LogChange, { op: "insert" }>["entry"], item: DraftItem | null, lengthMs: number) => {
    onAdd([{ op: "insert", key: nextKey(), entry }, ...makeRoom(reflow, space.at, lengthMs)], item ? [item] : []);
  };
  const addItem = (i: LibraryItem) => put({ kind: "program", startsAt: space.at, itemId: i.id }, itemOf(i), wholeMinutes(i.durationMs ?? 0));

  const plan = space.gap && space.endsAt && library.data ? planRepeat(library.data.items, library.data.programs, { startsAt: space.at, endsAt: space.endsAt }, breakMs) : null;
  const quickRepeat = () => {
    if (!plan || !space.endsAt) return;
    if (draftEmpty) {
      fill.mutate(
        { params: { stationId }, body: { with: "repeat", startsAt: space.at, endsAt: space.endsAt, itemIds: plan.itemIds } },
        {
          onSuccess: () => {
            toast.show({ message: `Filled ${clock(space.at, { timeZone: STATION_TZ })} to ${until} from your library.` });
            onFilled();
            onClose();
          },
          onError: (e) => toast.show({ message: e.message })
        }
      );
      return;
    }
    const chosen = plan.itemIds.map((id) => library.data!.items.find((i) => i.id === id)!).filter(Boolean);
    onAdd(repeatInserts(chosen, space.at, space.endsAt, breakMs, () => nextKey()), chosen.map(itemOf));
    onClose();
  };
  const signOff = () => {
    const end = space.endsAt ?? iso(t(space.at) + 60 * MIN);
    if (draftEmpty && space.gap && space.endsAt) {
      fill.mutate(
        { params: { stationId }, body: { with: "sign_off", startsAt: space.at, endsAt: end } },
        {
          onSuccess: () => {
            toast.show({ message: `Off air from ${clock(space.at, { timeZone: STATION_TZ })} to ${until}.` });
            onFilled();
            onClose();
          },
          onError: (e) => toast.show({ message: e.message })
        }
      );
      return;
    }
    onAdd([{ op: "insert", key: nextKey(), entry: { kind: "off_air", startsAt: space.at, endsAt: end } }], []);
    onClose();
  };

  const quick = (
    <div className="cc-quick">
      {space.gap && space.endsAt && (
        <div className="cc-quick__card">
          <div>
            <b>Repeat from your library</b>
            <small>{plan ? `Fills all ${minutesText(t(space.endsAt) - t(space.at))}, in order, with the break rule` : "Nothing in your library can air yet"}</small>
          </div>
          <button type="button" className="cc-btn-xs cc-btn-xs--pri" onClick={quickRepeat} disabled={!plan || fill.isPending}>
            Fill
          </button>
        </div>
      )}
      <div className="cc-quick__card">
        <div>
          <b>{until ? `Sign off until ${until}` : "Sign off for an hour"}</b>
          <small>Planned off air, not dead air. Viewers see when you're back</small>
        </div>
        <button type="button" className="cc-btn-xs" onClick={signOff} disabled={fill.isPending}>
          Sign off
        </button>
      </div>
    </div>
  );

  const pick = (key: string, title: string, lengthMs: number, isNext: boolean, colour: string | null, onPick: () => void, data?: string, neverAired = false) => {
    const f = fitOf(lengthMs, space, reflow, isNext, STATION_TZ, neverAired);
    return (
      <li key={key} data-item={data} className={data && data === highlight ? "cc-pick cc-pick--hl" : "cc-pick"}>
        <button type="button" onClick={onPick}>
          <span className="cc-pick__th" style={{ "--cc-pc": colour ?? "var(--ink-70)" } as never} aria-hidden="true" />
          <span className="cc-pick__w">
            <b>{title}</b>
            <small>{f.line}</small>
          </span>
          <span className={`cc-fitb cc-fitb--${f.badge}`}>{f.label}</span>
          <span className="oc-sr-only">. Add it</span>
        </button>
      </li>
    );
  };

  const programs = library.data?.programs ?? [];
  const colourOf = (programId: string | null) => programs.find((p) => p.id === programId)?.station.colour ?? null;
  const livePrograms = programs.filter((p) => p.live);
  const episodes = (offer.data?.episodes ?? []).filter((e) => e.durationMs);

  return (
    <Drawer open onClose={onClose} title={`Add at ${clock(space.at, { timeZone: STATION_TZ })}`} subtitle={spaceLine(space)} className="cc-add">
      <Tabs<AddTab>
        label="Add from"
        value={tab}
        onChange={setTab}
        items={[
          { value: "library", label: "Library", controls: "cc-add-panel" },
          { value: "carried", label: "Carried", controls: "cc-add-panel" },
          { value: "live", label: "Live", controls: "cc-add-panel" },
          { value: "sign_off", label: "Sign off", controls: "cc-add-panel" }
        ]}
        className="cc-add__tabs"
      />
      <div id="cc-add-panel" role="tabpanel" className="cc-add__panel">
        {tab === "library" && (
          <>
            <Field label="Search your library" size="sm" value={query} onChange={(e) => setQuery(e.target.value)} className="cc-add__search" />
            {shown.length ? (
              <ul ref={list} className="cc-picks" aria-label="Your library">
                {(all || query ? shown : shown.slice(0, SHORT_LIST)).map((i) => pick(i.id, i.title, i.durationMs ?? 0, next.has(i.id), colourOf(i.programId), () => addItem(i), i.id, i.neverAired === true))}
              </ul>
            ) : (
              <p className="cc-log__quiet">{library.isLoading ? null : query ? "Nothing in your library by that name." : "Nothing in your library can air yet."}</p>
            )}
            {!all && !query && shown.length > SHORT_LIST && (
              <button type="button" className="cc-add__more" onClick={() => setAll(true)}>
                Show all {shown.length}
              </button>
            )}
            {quick}
          </>
        )}
        {tab === "carried" && (
          <>
            {carrying.length > 1 && (
              <SelectField label="Program" size="sm" value={agreement?.id ?? ""} onChange={(e) => setAgreementId(e.target.value)}>
                {carrying.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.program.title}, from {stationLabel(a.maker)}
                  </option>
                ))}
              </SelectField>
            )}
            {agreement && episodes.length ? (
              <ul className="cc-picks" aria-label={`Episodes of ${agreement.program.title}`}>
                {episodes.map((ep) =>
                  pick(ep.id, ep.title, ep.durationMs ?? 0, false, agreement.maker.colour, () =>
                    put(
                      { kind: "program", startsAt: space.at, itemId: ep.id, carriageAgreementId: agreement.id, programId: agreement.program.id },
                      { id: ep.id, title: agreement.program.title, durationMs: ep.durationMs, programId: agreement.program.id, carriageAgreementId: agreement.id, carriedFrom: agreement.maker },
                      wholeMinutes(ep.durationMs ?? 0)
                    )
                  )
                )}
              </ul>
            ) : (
              <p className="cc-log__quiet">{agreements.isLoading || offer.isLoading ? null : "You don't carry anything yet."}</p>
            )}
            {base && (
              <p className="cc-log__note">
                <a className="cc-log__link" href={`${base}/market`}>
                  Find more in the syndication market
                </a>
                . Your changes are kept while you look.
              </p>
            )}
          </>
        )}
        {tab === "live" && (
          <>
            {livePrograms.length > 0 && (
              <SelectField label="Program" size="sm" value={programId} onChange={(e) => setProgramId(e.target.value)}>
                <option value="">No program</option>
                {livePrograms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </SelectField>
            )}
            {sources.data?.length ? (
              <ul className="cc-picks" aria-label="Your live sources">
                {sources.data.map((src) => {
                  const end = space.endsAt && t(space.endsAt) > t(space.at) ? space.endsAt : iso(t(space.at) + 60 * MIN);
                  const length = t(end) - t(space.at);
                  return pick(src.id, src.name, length, false, null, () =>
                    put({ kind: "live", startsAt: space.at, endsAt: snapTime(end), liveSourceId: src.id, ...(programId ? { programId } : {}) }, { id: `live:${src.id}`, title: livePrograms.find((p) => p.id === programId)?.title ?? "Live", durationMs: length }, length)
                  );
                })}
              </ul>
            ) : (
              <p className="cc-log__quiet">{sources.isLoading ? null : "No live sources yet. Add one under Live sources."}</p>
            )}
          </>
        )}
        {tab === "sign_off" && quick}
      </div>
    </Drawer>
  );
}
