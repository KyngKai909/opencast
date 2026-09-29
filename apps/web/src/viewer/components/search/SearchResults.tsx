// Search's results, the same on the web overlay (03.1) and the phone's Search tab (05.2): a
// "Tune to" row when the query is a channel or frequency, then Programs (airing next first),
// Stations, and Recent searches kept on this device.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { stationsApi } from "@opencast/contracts";
import { Button, Chip, Icon, Kbd, LiveText, TitleCard, clock } from "@opencast/ui";
import { SearchFull, type SearchAiring, type SearchStation } from "../../api/ext/station";
import { useApi } from "../../../api/hooks";
import { useChannels, useMarketSlug, useViewerActions } from "../../data/viewer";
import { MARKET_TZ, useNow } from "../../../lib/clock";
import { stationPath, useLink, useTuneIn } from "../station/actions";
import { capital, dayWord } from "../station/when";
import { addRecentSearch, useRecentSearches } from "./recent";
import { highlight, matchChannel, namedOnce, nearestChannels, numberQuery } from "./searchLogic";
import "./Search.css";

/** Waits for typing to pause before asking the API. */
function useDebounced(value: string, ms = 150): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Marked({ text, q }: { text: string; q: string }) {
  return (
    <>
      {highlight(text, q).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

function ResHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="vw-res-h">
      <h2>{title}</h2>
      {sub && <span>{sub}</span>}
    </div>
  );
}

function cs(s: { callSign: string | null; name: string }) {
  return s.callSign ?? s.name;
}

/** When a result airs: "Live now, until 9:30 pm", "Tuesday, 7:00 pm", "October 8, 6:30 pm". */
function When({ a, t, inline }: { a: SearchAiring; t: Date; inline?: boolean }) {
  const onNow = Date.parse(a.airing.startsAt) <= t.getTime();
  if (onNow) {
    const until = clock(a.airing.endsAt, { timeZone: MARKET_TZ });
    const head = a.airing.live ? <LiveText>{inline ? "live now" : "Live now"}</LiveText> : inline ? "on now" : "On now";
    return (
      <>
        {head}, until <span className="oc-mono">{until}</span>
      </>
    );
  }
  const word = dayWord(a.airing.startsAt, t, MARKET_TZ);
  const time = clock(a.airing.startsAt, { timeZone: MARKET_TZ });
  const day = inline ? word : capital(word);
  // The phone's one line reads "Sunday 2:00 pm"; a date keeps its comma.
  return (
    <>
      {day}
      {inline && !/\d/.test(word) ? " " : ", "}
      <span className="oc-mono">{time}</span>
    </>
  );
}

export interface SearchResultsProps {
  /** What's typed. */
  q: string;
  /** Put a query in the field (a recent search). */
  onQuery: (q: string) => void;
  phone?: boolean;
}

/** The "Tune to" row's target, from the market's dial: what typed digits tune to, and what's on. */
export function useTuneTo(q: string) {
  const channels = useChannels();
  return useMemo(() => {
    const typed = numberQuery(q);
    if (!typed) return null;
    const m = matchChannel(typed, channels.map((c) => c.station.channel ?? ""));
    if (!m) return null;
    const row = m.found ? channels.find((c) => c.station.channel === m.channel) ?? null : null;
    const nearest = row ? [] : nearestChannels(m.channel, channels.map((c) => c.station.channel ?? "").filter(Boolean)).map((ch) => channels.find((c) => c.station.channel === ch)!);
    return { typed, channel: m.channel, row, nearest };
  }, [q, channels]);
}

export function SearchResults({ q, onQuery, phone }: SearchResultsProps) {
  const query = q.trim();
  const dq = useDebounced(query);
  const market = useMarketSlug();
  const t = useNow(30_000);
  const link = useLink();
  const tuneIn = useTuneIn();
  const { remind } = useViewerActions();
  const recent = useRecentSearches();
  const tuneTo = useTuneTo(query);
  const res = useApi(stationsApi.search, { query: { q: dq, market } }, { schema: SearchFull, enabled: dq.length > 0, placeholderData: (prev) => prev });
  const data = dq.length > 0 ? res.data : undefined;
  const remember = () => addRecentSearch(query);

  const tuneRow = tuneTo && (
    <div className="vw-tune-wrap">
      {tuneTo.row ? (
        <button
          type="button"
          className="vw-tune"
          onClick={() => {
            remember();
            tuneIn(tuneTo.row!.station);
          }}
        >
          <span className="vw-tune__ch oc-mono">{tuneTo.row.station.channel}</span>
          <span className="vw-tune__text">
            <b>Tune to {cs(tuneTo.row.station)}</b>
            <small>{tuneTo.row.now?.title ?? "Off air"}</small>
          </span>
          <span className="vw-tune__end" aria-hidden="true">
            {!phone && <Kbd>Enter</Kbd>}
            <Icon name="chev" />
          </span>
        </button>
      ) : (
        <div className="vw-tune vw-tune--none" role="status">
          <span className="vw-tune__ch oc-mono">{tuneTo.channel}</span>
          <span className="vw-tune__text">
            <b>No station on {tuneTo.typed}</b>
            {tuneTo.nearest.length > 0 && <small>Nearest: {tuneTo.nearest.map((c) => `${c.station.channel} ${cs(c.station)}`).join(" and ")}</small>}
          </span>
        </div>
      )}
    </div>
  );

  const programs = data?.airings ?? [];
  const stations: SearchStation[] = data?.stations ?? [];
  const named = namedOnce(programs.map((r) => r.station.id));

  const programRows = programs.map((r, i) => {
    const onNow = Date.parse(r.airing.startsAt) <= t.getTime();
    const stationLine = `${cs(r.station)} ${r.station.channel ?? ""}`.trim() + (r.listed ? ", listed from the city's stream" : named[i] ? `, ${r.station.name}` : "");
    const card = <TitleCard colour={r.station.colour ?? "#33507A"} title={r.program?.title ?? r.airing.title} className="vw-res__tc" decorative />;
    const doTune = () => {
      remember();
      tuneIn(r.station);
    };
    const doRemind = () => {
      remember();
      remind({ airing: r.airing, station: r.station });
    };
    const key = `${r.station.id}:${r.airing.startsAt}`;
    if (phone) {
      const open = onNow ? doTune : r.program ? undefined : doRemind;
      const body = (
        <>
          {card}
          <span className="vw-res__text">
            <b>
              <Marked text={r.airing.title} q={query} />
            </b>
            <small>
              {cs(r.station)} {r.station.channel}, <When a={r} t={t} inline />
            </small>
          </span>
        </>
      );
      return (
        <li key={key}>
          {open ? (
            <button type="button" className="vw-res vw-res--phone" onClick={open}>
              {body}
            </button>
          ) : (
            <a className="vw-res vw-res--phone" {...link(`/program/${r.program!.id}`)} onClickCapture={remember}>
              {body}
            </a>
          )}
        </li>
      );
    }
    return (
      <li key={key} className="vw-res">
        {card}
        <span className="vw-res__text">
          <b>
            {r.program ? (
              <a {...link(`/program/${r.program.id}`)} onClickCapture={remember}>
                <Marked text={r.airing.title} q={query} />
              </a>
            ) : (
              <Marked text={r.airing.title} q={query} />
            )}
          </b>
          <small>{stationLine}</small>
        </span>
        <span className="vw-res__when">
          <When a={r} t={t} />
        </span>
        <span className="vw-res__act">
          {onNow ? (
            <Button variant="primary" size="sm" onClick={doTune}>
              Tune in
            </Button>
          ) : (
            <Button size="sm" icon="bell" onClick={doRemind} disabled={!r.airing.logEntryId && !r.airing.listedAiringId}>
              Remind me
            </Button>
          )}
        </span>
      </li>
    );
  });

  const stationRows = stations.map((s) => {
    const body = (
      <>
        <span className="vw-res__ch oc-mono">{s.channel}</span>
        <span className="vw-res__cs oc-cs">{cs(s)}</span>
        <span className="vw-res__text">
          <b>
            <Marked text={s.name} q={query} />
          </b>
          {s.description && <small>{s.description}</small>}
        </span>
      </>
    );
    if (phone)
      return (
        <li key={s.id}>
          <a className="vw-res vw-res--st vw-res--phone" {...link(stationPath(s))} onClickCapture={remember}>
            {body}
          </a>
        </li>
      );
    return (
      <li key={s.id} className="vw-res vw-res--st">
        {body}
        <span className="vw-res__act">
          <Button size="sm" {...link(stationPath(s))} onClickCapture={remember}>
            Station
          </Button>
        </span>
      </li>
    );
  });

  const recentBlock = recent.length > 0 && (!phone || !query) && (
    <section aria-label="Recent searches">
      <ResHead title="Recent searches" />
      <div className="vw-recent">
        {recent.map((r) => (
          <Chip key={r} size="sm" role="button" onClick={() => onQuery(r)}>
            {r}
          </Chip>
        ))}
      </div>
    </section>
  );

  let body: ReactNode;
  if (!query) {
    body = recentBlock || <p className="vw-search__hint">Type a channel, a call sign or a program.</p>;
  } else if (res.error && dq) {
    body = (
      <>
        {tuneRow}
        <p className="vw-search__hint" role="alert">
          {res.error.message}
        </p>
      </>
    );
  } else {
    const loading = !data && (res.isFetching || dq !== query);
    const empty = !!data && !programs.length && !stations.length && !tuneTo?.row;
    const programsBlock = programs.length > 0 && (
      <section aria-label="Programs">
        <ResHead title="Programs" sub={phone ? undefined : "Airing next first"} />
        <ul className="vw-res-list">{programRows}</ul>
      </section>
    );
    const stationsBlock = stations.length > 0 && (
      <section aria-label="Stations">
        <ResHead title="Stations" />
        <ul className="vw-res-list">{stationRows}</ul>
      </section>
    );
    body = (
      <>
        {tuneRow}
        {loading && (
          <div aria-busy="true" aria-label="Searching">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="vw-skel vw-skel--res" />
            ))}
          </div>
        )}
        {/* A number: the station first. Anything else: programs first, as the frames order them. */}
        {tuneTo ? stationsBlock : programsBlock}
        {tuneTo ? programsBlock : stationsBlock}
        {empty && !tuneTo && (
          <p className="vw-search__hint" role="status">
            Nothing on the dial matches “{query}”. Try a call sign, a channel or a program's name.
          </p>
        )}
        {recentBlock}
      </>
    );
  }
  return <div className={phone ? "vw-search__results vw-search__results--phone" : "vw-search__results"}>{body}</div>;
}
