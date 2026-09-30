// The station page (station-pages 01.1 web, 05.1 phone): /:handle, and /:handle/pledge opens the
// pledge over it. The header is the station's own ID card; below it what's on now, the week, and a
// side column saying who runs it, what it carries, what it makes for others and who supports it.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { stationsApi } from "@opencast/contracts";
import {
  Button,
  LiveText,
  PictureFrame,
  PicturePlaceholder,
  ProgressBar,
  ScheduleList,
  StationBand,
  Tabs,
  Tag,
  TitleCard,
  scheduleStatus,
  type ScheduleItem
} from "@opencast/ui";
import type { AiringX } from "../api/ext";
import { StationPageFull, type StationPageFull as Page } from "../api/ext/station";
import { useApi } from "../../api/hooks";
import { useMarkets, usePresets, useViewerActions } from "../data/viewer";
import { useIsPhone, useShellOptions } from "../layout/shell";
import { MARKET_TZ, now as clockNow, useNow } from "../../lib/clock";
import { useBack, useLink, useOpenOverlay, useTuneIn } from "../components/station/actions";
import { SecTop, StationSide } from "../components/station/StationSide";
import { StationListing } from "../components/station/StationListing";
import { broadcastDayKey, clockAfter, onDay, weekTabs } from "../components/station/when";
import { isOffAir, stationSlug } from "../components/watch/logic";
import { BackAt } from "../components/watch/lines";
import "../components/station/Station.css";

const DAY = 86400e3;

/** The line under a schedule row: "Carried from REEL 24.1", "Live from the Redlands studio", "Beat showcase". */
function rowSubtitle(a: AiringX) {
  // Planned off air (G9): "Off air", back at its sign-on.
  if (isOffAir(a)) return <BackAt at={a.backAt ?? a.endsAt} />;
  if (a.carriedFrom) return `Carried from ${[a.carriedFrom.callSign, a.carriedFrom.channel].filter(Boolean).join(" ")}`;
  const note = a.note ?? a.episodeTitle;
  if (a.live && note?.startsWith("Live ")) return <><LiveText /> {note.slice(5)}</>;
  if (a.live) return note ? <><LiveText />, {note}</> : <LiveText />;
  return note ?? undefined;
}

function PresetAction({ page, phone }: { page: Page; phone: boolean }) {
  const { presets } = usePresets();
  const { savePreset } = useViewerActions();
  const link = useLink();
  const mine = presets.find((p) => p.station.id === page.station.id);
  const variant = phone ? "ghost" : "line-station";
  if (mine)
    return (
      <Button variant={variant} icon="check" set={phone} {...link("/presets")} aria-label={mine.key ? `Preset ${mine.key}. Open presets` : "In your presets. Open presets"}>
        {mine.key ? `Preset ${mine.key}` : "In your presets"}
      </Button>
    );
  return (
    <Button variant={variant} onClick={() => savePreset(page.station)}>
      Add to presets
    </Button>
  );
}

function OnNow({ page, t }: { page: Page; t: Date }) {
  const link = useLink();
  // Planned off air (G9) on now: off air, and when it's back.
  const off = isOffAir(page.now);
  const a = off ? null : page.now;
  const next = page.upNext.find((x) => !isOffAir(x));
  const nextLine = next && (
    <p className="vw-now__next">
      Next at <span className="oc-mono">{clockAfter(next.startsAt, a?.endsAt ?? t, MARKET_TZ)}</span>: <b>{next.title}</b>
      {next.live && <> <LiveText /></>}
    </p>
  );
  // An external station (follow-up Phase 6) with nothing scheduled is still on: Live, from the
  // source's own stream, never a made-up title. Down, it's off the dial until it's back.
  const external = page.station.kind === "listed" ? page.external : undefined;
  if (!a && external && !isOffAir(page.now))
    return (
      <div className="vw-now vw-now--off">
        <div>
          <b className="vw-now__title">{page.station.name}</b>
          <p className="vw-now__line">
            <Tag variant="listed">External</Tag>{" "}
            {external.down ? `${external.source}'s stream is down. It's off the dial until it's back.` : <><LiveText /> from {external.source}.</>}
          </p>
          {nextLine}
        </div>
      </div>
    );
  if (!a)
    return (
      <div className="vw-now vw-now--off">
        <div>
          <Tag variant="off">Off air</Tag>
          {off && page.now && (
            <p className="vw-now__next">
              <BackAt at={page.now.backAt ?? page.now.endsAt} />
            </p>
          )}
          {nextLine}
        </div>
      </div>
    );
  const line = a.episodeTitle ?? a.note;
  const cf = a.carriedFrom;
  return (
    <div className="vw-now">
      {page.station.band === "radio" ? (
        // Radio has no picture: its card in the station's colour, as the player shows it.
        <TitleCard size="lg" colour={page.station.colour ?? "#33507A"} title={<span className="oc-mono">{page.station.channel}</span>} bottom={page.station.callSign} className="vw-now__radio" decorative />
      ) : (
        // An external station's picture is the source's own: no Opencast bug on it.
        <PictureFrame bug={page.station.kind === "listed" ? undefined : { callSign: page.station.callSign ?? "", channel: page.station.channel ?? "" }} label={`${a.title}, on ${page.station.callSign ?? page.station.name}`}>
          {page.station.category === "Public affairs" ? <PicturePlaceholder scene="podium" /> : <PicturePlaceholder scene="reel" title={a.title} />}
        </PictureFrame>
      )}
      <div>
        <span className="vw-now__time">
          <ProgressBar size="text" start={a.startsAt} end={a.endsAt} now={t} timeZone={MARKET_TZ} />
        </span>
        <b className="vw-now__title">{a.title}</b>
        {(line || cf || a.live) && (
          <p className="vw-now__line">
            {a.live && line?.startsWith("Live ") ? (
              <>
                <LiveText /> {line.slice(5)}.{" "}
              </>
            ) : (
              <>
                {a.live && (
                  <>
                    <LiveText />
                    {line || cf ? ". " : ""}
                  </>
                )}
                {line && `${line}. `}
              </>
            )}
            {cf && (
              <>
                Carried from{" "}
                <a className="vw-now__from" {...link(a.programId ? `/program/${a.programId}` : `/${cf.handle ?? stationSlug(cf)}`)}>
                  {[cf.callSign, cf.channel].filter(Boolean).join(" ")}
                </a>
                .
              </>
            )}
          </p>
        )}
        {nextLine}
      </div>
    </div>
  );
}

function Skeleton({ phone }: { phone: boolean }) {
  return (
    <div className="vw-station" aria-busy="true" aria-label="Loading the station">
      <div className={phone ? "vw-skel vw-skel--band-phone" : "vw-skel vw-skel--band"} />
      <div className="vw-station__body">
        <div>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="vw-skel vw-skel--row" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function StationPage() {
  const { handle = "" } = useParams();
  const loc = useLocation();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const back = useBack();
  const t = useNow(15_000);
  const link = useLink();
  const tuneIn = useTuneIn();
  const openOverlay = useOpenOverlay();
  const markets = useMarkets();
  const { remind } = useViewerActions();
  useShellOptions({ padded: false, back: { title: "Station", onBack: back } });

  // The schedule from the start of today to a week on (S5), asked once per visit.
  const [range] = useState(() => {
    const n = clockNow().getTime();
    return { from: new Date(n - 18 * 3600e3).toISOString(), to: new Date(n + 7 * DAY).toISOString() };
  });
  const q = useApi(stationsApi.getStation, { params: { stationRef: handle }, query: range }, { schema: StationPageFull, refetchInterval: 60_000 });
  const page = q.data;

  // /:handle/pledge (the TV's QR code): the pledge opens over the station page.
  const pledgePath = loc.pathname.endsWith("/pledge");
  useEffect(() => {
    if (pledgePath && page?.station.callSign) navigate({ pathname: `/${handle}`, search: `?modal=pledge&station=${stationSlug(page.station)}` }, { replace: true });
  }, [pledgePath, page?.station.callSign, handle, navigate]);

  const tabs = useMemo(() => weekTabs(t, MARKET_TZ), [broadcastDayKey(t, MARKET_TZ)]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = tabs.find((d) => d.today)!.value;
  const [day, setDay] = useState<string | null>(null);
  const shownDay = day && tabs.some((d) => d.value === day) ? day : today;
  const [listing, setListing] = useState<AiringX | null>(null);

  if (q.isLoading) return <Skeleton phone={phone} />;
  if (q.error || !page)
    return (
      <div className="vw-station vw-station--error">
        <p>{q.error?.message ?? "That station wasn't found."}</p>
        <Button {...link("/")}>Back to the dial</Button>
      </div>
    );

  const s = page.station;
  const cs = s.callSign ?? s.name;
  const listed = s.kind === "listed";
  const marketName = markets.data?.find((m) => m.slug === s.marketSlug)?.name ?? null;
  const schedule = page.schedule ?? [page.now, ...page.upNext].filter((a): a is AiringX => !!a);
  const dayAirings = onDay(schedule, phone ? today : shownDay, MARKET_TZ);
  // The phone's "Tonight" starts at the program on now: its past rows are hidden (Station.css), so
  // the times still read as the whole evening's column ("8:30", not "8:30 pm").
  const rows = dayAirings;
  const tonightLeft = dayAirings.some((a) => Date.parse(a.endsAt) > t.getTime());
  const programDescription = (a: AiringX) => page.programs.find((p) => p.id === a.programId)?.description ?? null;

  // Off air isn't something to be reminded of: no bell on its row.
  const items: ScheduleItem[] = rows.map((a) => ({ id: a.logEntryId ?? a.listedAiringId ?? a.startsAt, start: a.startsAt, end: a.endsAt, title: a.title, subtitle: rowSubtitle(a), remindable: !isOffAir(a) }));
  const status = scheduleStatus(items, t);
  const openable = items.map((it, i) => (status[i] === "next" && !isOffAir(rows[i]) && (rows[i]!.logEntryId || rows[i]!.listedAiringId) ? { ...it, title: <button type="button" className="vw-sch-open" onClick={() => setListing(rows[i]!)}>{it.title}</button> } : it));
  const byId = new Map(items.map((it, i) => [it.id, rows[i]!]));
  const remindRow = (it: ScheduleItem) => {
    const a = byId.get(it.id);
    if (a && !isOffAir(a)) remind({ airing: a, station: s });
  };

  const bandName = `${s.name}. ${page.description ?? ""}`.trim();
  // A229: overlays name the station by its address, so a family member is the one meant.
  const pledge = () => openOverlay({ modal: "pledge", station: stationSlug(s) });
  const share = () => openOverlay({ modal: "share", station: stationSlug(s) });

  const schedHeading = (
    <SecTop
      title={phone ? "Tonight" : "This week"}
      end={
        phone ? undefined : (
          <Button variant="text" {...link("/guide")}>
            Full guide
          </Button>
        )
      }
    />
  );

  const listingEl = listing && <StationListing airing={listing} station={s} description={programDescription(listing)} onClose={() => setListing(null)} />;

  if (phone)
    return (
      <div className="vw-station vw-station--phone">
        <StationBand variant="phone" channel={s.channel ?? ""} callSign={cs} colour={s.colour ?? "#33507A"} name={bandName} />
        <div className="vw-station__acts">
          <Button variant="primary" onClick={() => tuneIn(s)}>
            Tune in
          </Button>
          <PresetAction page={page} phone />
          {!listed && (
            <Button variant="ghost" onClick={pledge}>
              Pledge
            </Button>
          )}
        </div>
        <div className="vw-station__sec">
          <section aria-label="Tonight">
            {schedHeading}
            {tonightLeft ? <ScheduleList items={openable} now={t} variant="week-phone" timeZone={MARKET_TZ} /> : <p className="vw-station__empty">Nothing else tonight.</p>}
          </section>
          <StationSide page={page} marketName={marketName} phone />
        </div>
        {listingEl}
      </div>
    );

  return (
    <div className="vw-station">
      <StationBand
        variant="page"
        channel={s.channel ?? ""}
        callSign={cs}
        colour={s.colour ?? "#33507A"}
        name={bandName}
        actions={
          <>
            <Button variant="on-station" onClick={() => tuneIn(s)}>
              Tune in
            </Button>
            <PresetAction page={page} phone={false} />
            {!listed && (
              <Button variant="line-station" onClick={pledge}>
                Pledge
              </Button>
            )}
            <Button variant="line-station" icon="share" onClick={share}>
              Share
            </Button>
          </>
        }
      />
      <div className="vw-station__body">
        <div className="vw-station__main">
          <section aria-label="On now">
            <SecTop title="On now" />
            <OnNow page={page} t={t} />
          </section>
          <section aria-label="This week">
            {schedHeading}
            <Tabs
              variant="days"
              label="Day"
              className="vw-station__days"
              value={shownDay}
              onChange={setDay}
              items={tabs.map((d) => ({ value: d.value, label: <>{d.label}<span className="oc-sr-only">{d.long.slice(d.long.indexOf(","))}</span></>, controls: "vw-station-day" }))}
            />
            <div id="vw-station-day" role="tabpanel" aria-label={tabs.find((d) => d.value === shownDay)?.long}>
              {items.length ? (
                <ScheduleList items={openable} now={t} variant="week" onRemind={remindRow} timeZone={MARKET_TZ} />
              ) : (
                <p className="vw-station__empty">Nothing is listed for this day yet.</p>
              )}
            </div>
          </section>
        </div>
        <aside className="vw-station__side" aria-label={`About ${s.sharesCallSign && s.channel ? `${cs} ${s.channel}` : cs}`}>
          <StationSide page={page} marketName={marketName} />
        </aside>
      </div>
      {listingEl}
    </div>
  );
}
