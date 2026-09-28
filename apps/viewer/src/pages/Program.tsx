// The program page (station-pages 02.1): /program/:programId. It leads with the station that makes
// the program, even when you arrived from a station that carries it; says where it airs in your
// market and when; and lists episodes with each one's next airing. Nothing plays on demand:
// everything leads to tuning in or a reminder.

import { useState } from "react";
import { useParams } from "react-router";
import { libraryApi } from "@opencast/contracts";
import { Button, IconButton, Tag, TitleCard } from "@opencast/ui";
import { ProgramPageX, type EpisodeX, type WhereToWatch } from "../api/ext/station";
import { useApi } from "../api/hooks";
import { useMarkets, useMarketSlug, useViewerActions } from "../data/viewer";
import { useIsPhone, useShellOptions } from "../layout/shell";
import { useNowPlaying } from "../player/PlayerRoot";
import { MARKET_TZ, useNow } from "../lib/clock";
import { stationPath, useBack, useLink, useTuneIn } from "../components/station/actions";
import { SecTop } from "../components/station/StationSide";
import {
  carriedByText,
  episodeLine,
  episodeState,
  episodeWindow,
  episodesMeta,
  primaryAction,
  primaryLabel,
  stationLabel,
  whereAction,
  whereLines
} from "../components/station/program";
import "../components/station/Program.css";

/**
 * Open question 1/3 (watch from the start, on demand): nothing plays here. An episode's action
 * comes from this one function, so a Play action could be added without re-laying out the list.
 */
function episodeAction(ep: EpisodeX): "remind" | "on-now" | null {
  const s = episodeState(ep);
  return s === "now" ? "on-now" : s === "next" ? "remind" : null;
}

export default function ProgramPage() {
  const { programId = "" } = useParams();
  const phone = useIsPhone();
  const back = useBack();
  const t = useNow(15_000);
  const link = useLink();
  const tuneIn = useTuneIn();
  const market = useMarketSlug();
  const markets = useMarkets();
  const np = useNowPlaying();
  const { remind } = useViewerActions();
  const [showOutside, setShowOutside] = useState(false);
  useShellOptions({ padded: false, back: { title: "Program", onBack: back } });

  const q = useApi(libraryApi.getProgram, { params: { programId }, query: { market } }, { schema: ProgramPageX, refetchInterval: 60_000 });
  const p = q.data;

  if (q.isLoading)
    return (
      <div className="vw-program" aria-busy="true" aria-label="Loading the program">
        <div className="vw-program__head">
          <div className="vw-skel vw-skel--card" />
          <div>
            <div className="vw-skel vw-skel--line" />
            <div className="vw-skel vw-skel--title" />
            <div className="vw-skel vw-skel--line" />
          </div>
        </div>
      </div>
    );
  if (q.error || !p)
    return (
      <div className="vw-program vw-program--error">
        <p>{q.error?.message ?? "That program wasn't found."}</p>
        <Button {...link("/")}>Back to the dial</Button>
      </div>
    );

  const maker = p.station;
  const makerLabel = stationLabel(maker);
  const where = p.whereToWatch ?? [];
  const primary = primaryAction(where, np.row?.station.id ?? null);
  const marketName = markets.data?.find((m) => m.slug === market)?.name;
  const meta = [episodesMeta(p.episodeCount, p.typicalLengthMs), p.rightsNote, p.carriers ? carriedByText(p.carriers.total) : null].filter((x): x is string => !!x);
  const episodes = episodeWindow(p.episodes);
  const remindRow = (row: WhereToWatch) => row.next && remind({ airing: row.next, station: row.station });

  const onPrimary = () => {
    if (!primary) return;
    if (primary.kind === "tune") tuneIn(primary.row.station);
    else remindRow(primary.row);
  };

  return (
    <div className={phone ? "vw-program vw-program--phone" : "vw-program"}>
      <header className="vw-program__head">
        <TitleCard size="lg" colour={maker.colour ?? "#33507A"} title={p.title} bottom={<span className="oc-mono">{makerLabel}</span>} className="vw-program__card" decorative />
        <div>
          <span className="vw-program__from">
            A series from <b>{makerLabel}</b>
          </span>
          <h1 className="vw-program__title">{p.title}</h1>
          {meta.length > 0 && (
            <div className="vw-program__meta">
              {meta.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          )}
          {p.description && <p className="vw-program__desc">{p.description}</p>}
          <div className="vw-program__acts">
            {primary ? (
              <Button variant="primary" icon={primary.kind === "remind" ? "bell" : undefined} onClick={onPrimary}>
                {primaryLabel(primary)}
              </Button>
            ) : (
              <span className="vw-program__none">Not scheduled yet</span>
            )}
            <Button variant="ghost" {...link(stationPath(maker))}>
              About {maker.callSign ?? maker.name}
            </Button>
          </div>
        </div>
      </header>

      <div className="vw-program__body">
        <section aria-labelledby="vw-where">
          <SecTop title={<span id="vw-where">Where to watch</span>} sub={marketName ? `In the ${marketName}` : undefined} />
          {where.length ? (
            <ul className="vw-wt-list">
              {where.map((row) => {
                const lines = whereLines(row, maker.id, t, MARKET_TZ);
                const act = whereAction(row, primary);
                return (
                  <li key={row.station.id} className="vw-wt">
                    <span className="vw-wt__ch oc-mono">{row.station.channel}</span>
                    <a className="vw-wt__cs oc-cs" {...link(stationPath(row.station))}>
                      {row.station.callSign ?? row.station.name}
                    </a>
                    <div>
                      <b>{lines.title}</b>
                      {lines.sub && <small>{lines.sub}</small>}
                    </div>
                    <span className="vw-wt__act">
                      {act === "on-now" && <Tag className="vw-tag-now">On now</Tag>}
                      {act === "tune" && (
                        <Button size="sm" onClick={() => tuneIn(row.station)}>
                          Tune in
                        </Button>
                      )}
                      {act === "remind" && (
                        <Button size="sm" icon="bell" onClick={() => remindRow(row)}>
                          Remind me
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="vw-program__quiet">Not scheduled in your market yet.</p>
          )}
          {p.carriers && p.carriers.outsideMarket > 0 && (
            <>
              <p className="vw-program__quiet">
                Also on {p.carriers.outsideMarket} station{p.carriers.outsideMarket === 1 ? "" : "s"} outside your market.{" "}
                {p.carriers.outside.length > 0 && (
                  <button type="button" className="vw-link" aria-expanded={showOutside} aria-controls="vw-outside" onClick={() => setShowOutside((v) => !v)}>
                    See where
                  </button>
                )}
              </p>
              {showOutside && (
                <ul id="vw-outside" className="vw-lk-list vw-program__outside">
                  {p.carriers.outside.map((c) => (
                    <li key={c.station.id} className="vw-lk">
                      <span className="vw-lk__ch oc-mono">{c.station.channel}</span>
                      <div>
                        <b className="vw-lk__title">{c.station.callSign ?? c.station.name}</b>
                        <small>
                          {c.station.name}, {c.market}
                        </small>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        {p.episodes.length > 0 && (
          <section aria-labelledby="vw-episodes">
            <SecTop title={<span id="vw-episodes">Episodes</span>} sub={p.airedCount !== undefined ? `${p.airedCount} of ${p.episodeCount} aired so far` : undefined} />
            <ul className="vw-ep-list">
              {episodes.map((ep) => {
                const state = episodeState(ep);
                const act = episodeAction(ep);
                return (
                  <li key={ep.id} className={state === "aired" ? "vw-ep vw-ep--aired" : "vw-ep"}>
                    <span className="vw-ep__n oc-mono">{ep.episodeNumber}</span>
                    <div>
                      <b>{ep.title}</b>
                      <small>{episodeLine(ep, t, MARKET_TZ)}</small>
                    </div>
                    <span className="vw-ep__act">
                      {act === "on-now" && <Tag className="vw-tag-now">On now</Tag>}
                      {act === "remind" && ep.nextAiring && (
                        <IconButton icon="bell" bare label={`Remind me: ${ep.title}`} onClick={() => remind({ airing: ep.nextAiring!.airing, station: ep.nextAiring!.station })} />
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {/* Open questions 1 and 3: where on-demand viewing would attach, if it's ever added. */}
            <div className="vw-program__on-demand" data-slot="on-demand" hidden />
          </section>
        )}
      </div>
    </div>
  );
}
