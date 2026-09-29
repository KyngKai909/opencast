// A station's info, "About Inland Beat" ("/about/:stationRef"; not drawn). A panel on the right,
// like Pledge (tv 05.4), with the picture playing beside it: the station's name, call sign and
// channel, its description, what's on now and next, "Tune to BEAT now" (focused) and "Pledge to
// Inland Beat" (/pledge/:stationRef). Back returns to where it opened from (a program's options).

import { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { stationsApi } from "@opencast/contracts";
import { usePlayer } from "@opencast/player";
import { clock, LiveText } from "@opencast/ui";
import { StationPageX, type AiringX, type StationIdentX } from "../../api/ext";
import type { ApiError } from "../../api/client";
import { useApi } from "../../api/hooks";
import { MARKET_TZ, useNow } from "../../lib/clock";
import { useCommandLayer } from "../../tv/commands";
import { useChannels } from "../../tv/data";
import { focusKey, FocusContext, useTvFocusable } from "../../tv/focus";
import { TvButton } from "../../components/guide/TvButton";
import { cellLine, identText, type Cell } from "../../components/guide/guideLogic";
import { signOnAt } from "../../components/watching/offAir";
import "./About.css";

/** Stations that take pledges: not a city's listed stream, a studio or the catalog. */
export function takesPledges(s: StationIdentX): boolean {
  return s.kind === "station" || s.kind === "claimable";
}

function asCell(stationId: string, a: AiringX): Cell {
  return { key: "", stationId, start: Date.parse(a.startsAt), end: Date.parse(a.endsAt), airing: a, signOnAt: null };
}

export default function About() {
  const { stationRef = "" } = useParams();
  const ref = decodeURIComponent(stationRef);
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? null;
  const page = useApi(stationsApi.getStation, { params: { stationRef: ref } }, { schema: StationPageX });
  const channels = useChannels();
  const [player, engine] = usePlayer();
  const now = useNow(15_000).getTime();

  // Back: to the options it opened from, or the picture.
  useCommandLayer((c) => {
    if (c.type !== "back") return false;
    navigate(from ?? "/", { replace: true });
    return true;
  });

  const box = useTvFocusable({ focusKey: "tvg-about", trackChildren: true, isFocusBoundary: true });
  const ready = !!page.data;
  useEffect(() => {
    if (ready) focusKey("tvg-about-tune");
  }, [ready]);

  const station = page.data?.station;
  const row = station ? channels.find((c) => c.station.id === station.id) : undefined;
  const onNow = row ? row.now : (page.data?.now ?? null);
  const next = row ? row.next : (page.data?.upNext[0] ?? null);
  const onAir = row ? row.onAir && row.now?.kind !== "off_air" : !!page.data?.onAir;
  // Off air: when it's back (G9's back time), else its next airing.
  const signOn = row ? signOnAt(row) : page.data?.now?.kind === "off_air" ? (page.data.now.backAt ?? page.data.now.endsAt) : (next?.startsAt ?? null);

  let body;
  if (page.error) body = <p className="tvg-about__msg" role="alert">{(page.error as ApiError).message}</p>;
  else if (!station)
    body = (
      <div aria-busy="true" aria-label="Loading the station">
        <div className="tvg-about__ph tvg-about__ph--sm" />
        <div className="tvg-about__ph tvg-about__ph--lg" />
        <div className="tvg-about__ph" />
        <div className="tvg-about__ph" />
      </div>
    );
  else {
    const nowLine = onNow ? cellLine(asCell(station.id, onNow), now, MARKET_TZ) : null;
    body = (
      <>
        <div className="tvg-about__id oc-mono">{identText(station)}</div>
        <h3 id="tvg-about-title" className="tvg-about__name">
          {station.name}
        </h3>
        {page.data?.description && <p className="tvg-about__desc">{page.data.description}</p>}
        <div className="tvg-about__sched">
          <div className="tvg-about__slot">
            <small>On now</small>
            {onAir && onNow ? (
              <>
                <b>{onNow.title}</b>
                {nowLine && (
                  <span>
                    {nowLine.live && (
                      <>
                        <LiveText className="tvg-live" />
                        {nowLine.text ? ", " : ""}
                      </>
                    )}
                    {nowLine.text}
                  </span>
                )}
              </>
            ) : (
              <>
                <b>Off air</b>
                {signOn && <span>Signs on at {clock(signOn, { timeZone: MARKET_TZ })}</span>}
              </>
            )}
          </div>
          {onAir && next && (
            <div className="tvg-about__slot">
              <small>Next at {clock(next.startsAt, { timeZone: MARKET_TZ })}</small>
              <b>{next.title}</b>
              {next.live && (
                <span>
                  <LiveText className="tvg-live" />
                </span>
              )}
            </div>
          )}
        </div>
        <div className="tvg-about__actions">
          <TvButton
            focusKey="tvg-about-tune"
            primary
            label={`Tune to ${station.callSign ?? station.name} now`}
            onSelect={() => {
              if (station.id !== player.currentId) void engine.tune(station.id, { input: "app" });
              navigate("/", { replace: true });
            }}
          />
          {takesPledges(station) && (
            <TvButton
              focusKey="tvg-about-pledge"
              label={`Pledge to ${station.name}`}
              onSelect={() => navigate(`/pledge/${encodeURIComponent(station.callSign ?? station.id)}`, { state: { from: `/about/${encodeURIComponent(ref)}` } })}
            />
          )}
        </div>
      </>
    );
  }

  return (
    <FocusContext.Provider value={box.focusKey}>
      <aside ref={box.ref} className="tvg-about" aria-labelledby={station ? "tvg-about-title" : undefined} aria-label={station ? undefined : "About the station"}>
        {body}
      </aside>
    </FocusContext.Provider>
  );
}
