// 03.1 Listings (/:callSign/listings?range=week; one airing's editor at /listings/:entryId): every
// airing this week with whether its listing is complete, and an editor with previews of how it
// reads on the dial and on a TV banner. Carried programs are the maker's words: read-only, with a
// local note. Per-airing listings are the proposed G5; captions the proposed L7.

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { libraryApi } from "@opencast/contracts";
import { ChipRow, ControlTitle, DialRow, Field, Icon, KeyValueList, LiveText, Segmented, Table, TextAreaField, Toggle, clock, cx, type Column } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { call } from "../../api/client";
import { useApi } from "../../api/hooks";
import { listListings, updateListing, updateProgramCaptions, type Listing } from "../../api/ext/live";
import { now as clockNow, STATION_TZ } from "../../lib/clock";
import { useStation } from "../../station/StationContext";
import { dayLabel, descriptionCount } from "../../components/live/logic";
import { CATEGORIES, isEpisodeNumber, listingLine, STATUS } from "../../components/live/listings";
import { Quiet } from "../common";
import "./Listings.css";

/** The end of today in the station's zone, for "Today". */
function endOfToday(t: Date): string {
  const d = new Date(t.getTime() - 7 * 3600e3);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 7)).toISOString();
}

export default function Listings() {
  const { entryId } = useParams();
  const [params, setParams] = useSearchParams();
  const range = params.get("range") === "today" ? "today" : "week";
  const s = useStation();
  const navigate = useNavigate();
  const window = useMemo(() => {
    const t = clockNow();
    return { from: t.toISOString(), to: new Date(t.getTime() + 7 * 86400e3).toISOString() };
  }, []);
  const q = useApi(listListings, { params: { stationId: s.id }, query: window }, { retry: false });
  const now = clockNow();

  const rows = useMemo(() => {
    // A repeat shares its episode's listing: each episode once, at its next airing.
    const seen = new Set<string>();
    const all = (q.data?.listings ?? []).filter((l) => {
      const key = l.itemId ?? `${l.program?.id ?? l.title}:${l.episodeTitle ?? l.entryId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return range === "today" ? all.filter((l) => l.startsAt < endOfToday(now)) : all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, range]);

  if (q.isLoading) return <Quiet />;
  const need = q.data?.needDescription ?? 0;
  const callSign = s.station.callSign ?? s.station.name;
  const selected = rows.find((l) => l.entryId === entryId) ?? rows.find((l) => l.status === "needs_description") ?? rows[0];

  const columns: Column<Listing>[] = [
    {
      key: "airs",
      header: "Airs",
      width: "84px",
      cell: (l) => (
        <span className="cc-ls-row__t">
          {dayLabel(l.startsAt, now, STATION_TZ)}
          <br />
          {clock(l.startsAt, { timeZone: STATION_TZ })}
        </span>
      )
    },
    {
      key: "program",
      header: "Program",
      cell: (l) => (
        <>
          <b>{l.title}</b>
          <small className="oc-clamp1">{listingLine(l)}</small>
        </>
      )
    },
    { key: "status", header: "Listing", width: "150px", cell: (l) => <span className={cx("cc-ls-row__st", l.status === "needs_description" && "cc-ls-row__st--need")}>{STATUS[l.status]}</span> },
    { key: "open", header: <span className="oc-sr-only">Open</span>, width: "26px", cell: () => <Icon name="down" size={16} className="cc-ls-row__chev" /> }
  ];

  return (
    <div className="cc-listings">
      <ControlTitle
        title="Listings"
        description={
          q.isError ? undefined : need ? (
            <>
              This week on {callSign}. <b className="cc-listings__need">{need} need a description</b> before they air.
            </>
          ) : (
            <>This week on {callSign}. Every listing is complete.</>
          )
        }
        end={
          <Segmented
            label="Which listings"
            value={range}
            onChange={(v) => setParams(v === "week" ? {} : { range: v }, { replace: true })}
            options={[
              { value: "today", label: "Today" },
              { value: "week", label: "This week" }
            ]}
          />
        }
      />
      {q.isError ? (
        <p role="alert" className="cc-listings__empty">
          {q.error.message}
        </p>
      ) : (
        <div className="cc-listings__split">
          <div>
            {rows.length ? (
              <Table
                label="Listings"
                columns={columns}
                rows={rows}
                rowKey={(l) => l.entryId}
                selectedKey={selected?.entryId}
                onSelect={(l) => navigate({ pathname: `${s.base}/listings/${l.entryId}`, search: params.toString() }, { replace: true })}
                rowPadding={10}
                className="cc-ls-rows"
              />
            ) : (
              <p className="cc-listings__empty">{range === "today" ? "Nothing else airs today." : "Nothing is on the log this week."}</p>
            )}
          </div>
          {selected && <Editor key={selected.entryId} listing={selected} />}
        </div>
      )}
    </div>
  );
}

function Editor({ listing }: { listing: Listing }) {
  const s = useStation();
  const qc = useQueryClient();
  const program = listing.program;
  const carried = !!listing.carriedFrom;
  const [title, setTitle] = useState(program?.title ?? listing.title);
  const [episode, setEpisode] = useState(listing.episodeTitle ?? "");
  const [desc, setDesc] = useState(listing.episodeDescription ?? "");
  const [note, setNote] = useState(listing.localNote ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [listing.entryId]);
  const count = descriptionCount(desc);
  const refresh = () => qc.invalidateQueries({ queryKey: ["GET", listListings.path] });

  const run = async (fn: () => Promise<unknown>) => {
    try {
      setError(null);
      await fn();
      await refresh();
      await qc.invalidateQueries({ queryKey: ["GET", libraryApi.getLibrary.path] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    }
  };
  const patchListing = (body: Record<string, string | null>) => run(() => call(updateListing, { params: { stationId: s.id, entryId: listing.entryId }, body }));
  const patchProgram = (body: Record<string, unknown>) => program && run(() => call(libraryApi.updateProgram, { params: { programId: program.id }, body }));

  const captions = program?.captions ?? null;
  const captionsOn = !!captions && captions.mode !== "none";
  const captionWords = captions && captionsOn ? `${captions.mode === "generated_live" ? "Generated live" : captions.mode === "generated" ? "Generated" : "Uploaded"}${captions.language ? `, ${captions.language}` : ""}` : "Off";
  const categories = program?.category && !CATEGORIES.includes(program.category) ? [...CATEGORIES, program.category] : CATEGORIES;
  const seriesTitle = program?.title ?? listing.title;
  const shownDescription = desc || program?.description || "";

  return (
    <aside className="cc-listings__editor" aria-label={`Listing for ${listing.title}`}>
      <Field
        label="Title"
        value={title}
        disabled={carried || !program}
        maxLength={120}
        help={carried ? `From ${listing.carriedFrom?.callSign ?? listing.carriedFrom?.name}. ${s.station.callSign ?? s.station.name} can add a local note.` : undefined}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => program && title.trim() && title !== program.title && void patchProgram({ title: title.trim() })}
      />
      <Field
        label="This episode"
        value={episode}
        disabled={carried}
        maxLength={200}
        onChange={(e) => setEpisode(e.target.value)}
        onBlur={() => episode !== (listing.episodeTitle ?? "") && void patchListing({ episodeTitle: episode.trim() || null })}
      />
      <div className="cc-listings__desc">
        <TextAreaField
          label="Description"
          value={carried ? program?.description ?? "" : desc}
          placeholder={program?.description ?? undefined}
          disabled={carried}
          rows={3}
          error={count.over ? "A description fits in 160 characters: that's what fits the guide and a TV banner." : undefined}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => !count.over && desc !== (listing.episodeDescription ?? "") && void patchListing({ episodeDescription: desc.trim() || null })}
        />
        {!carried && <div className="cc-listings__count">{count.label}</div>}
      </div>
      {carried && (
        <Field
          label="Local note"
          value={note}
          maxLength={160}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (listing.localNote ?? "") && void patchListing({ localNote: note.trim() || null })}
        />
      )}
      {error && (
        <p className="cc-listings__error" role="alert">
          {error}
        </p>
      )}
      {program && (
        <>
          <div className="cc-listings__label" id="cc-cat-h">
            Category
          </div>
          <ChipRow layout="wrap" label="Category" value={program.category ?? ""} options={categories.map((c) => ({ value: c, label: c, disabled: carried }))} onChange={(c) => void patchProgram({ category: c })} />
          <div className="cc-listings__label">Details</div>
          <KeyValueList
            variant="rows"
            className="cc-listings__details"
            items={[
              { title: "Live", actions: <Toggle checked={program.live} label="Live" disabled={carried} onChange={(v) => void patchProgram({ live: v })} /> },
              {
                title: "Captions",
                detail: captionWords,
                actions: (
                  <Toggle
                    checked={captionsOn}
                    label="Captions"
                    disabled={carried}
                    onChange={(v) =>
                      void run(() => call(updateProgramCaptions, { params: { programId: program.id }, body: v ? { mode: program.live ? "generated_live" : "generated", language: "English" } : { mode: "none", language: null } }))
                    }
                  />
                )
              },
              {
                title: "Advisory",
                actions: (
                  <Segmented
                    label="Advisory"
                    size="md"
                    value={program.advisory}
                    onChange={(v) => !carried && void patchProgram({ advisory: v })}
                    options={[
                      { value: "none", label: "None", disabled: carried },
                      { value: "language", label: "Language", disabled: carried },
                      { value: "mature", label: "Mature", disabled: carried }
                    ]}
                  />
                )
              }
            ]}
          />
        </>
      )}
      <div className="cc-prevs">
        <div>
          <div className="cc-prevs__lbl">On the dial</div>
          <DialRow
            variant="preview"
            station={{ channel: s.station.channel ?? "", callSign: s.station.callSign ?? s.station.name, colour: s.station.colour ?? "#8C3B7A" }}
            now={{
              title: seriesTitle,
              detail: (
                <>
                  {program?.live || listing.kind === "live" ? (
                    <>
                      <LiveText />, until{" "}
                    </>
                  ) : (
                    "Until "
                  )}
                  {clock(listing.endsAt, { timeZone: STATION_TZ })}
                </>
              )
            }}
            timeZone={STATION_TZ}
          />
        </div>
        <div>
          <div className="cc-prevs__lbl">On a TV banner</div>
          <div className="cc-mini-banner" aria-label="TV banner preview">
            <span className="cc-mini-banner__ch">{s.station.channel}</span>
            <b>{seriesTitle}</b>
            <small>{(!isEpisodeNumber(episode) && episode) || shownDescription}</small>
          </div>
        </div>
      </div>
    </aside>
  );
}
