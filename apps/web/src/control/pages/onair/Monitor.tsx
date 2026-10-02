// A.7 Monitor: program and preview, the rundown to the second, Right now, the countdown to the
// next break, Cue a break now, and programs from the market that fit this station's open time.
// P.1 on the phone (the same route under 768px), and a claimable station's Monitor (rights 05.2,
// "Run by Opencast"). Everything ticks from the station clock and reads the shared log, so a break
// filled from the spot market shows here as soon as it's saved. Planned off air (G9) reads "Off
// air, back at 6:00 am" while it's on, and "Signs off at 2:00 am" when it's coming within 24 hours.
// "Prepared for air" (PlayoutStatus.readiness) says how many of the next 48 hours' items are ready
// (each item once, G13), and names the first that isn't, linked to that airing on the log.

import { useMemo, type ReactNode } from "react";
import { audienceApi, catalogApi, type Offer, playoutApi, stationsApi } from "@opencast/contracts";
import { Button, ControlTitle, KeyValueList, Notice, PictureFrame, Rundown, Tally, clock, duration, useToast, type HealthRow, type RundownItem } from "@opencast/ui";
import { useApi, useApiMutation } from "../../../api/hooks";
import { LOG_READS, useDeadAir, useLog, usePlayout } from "../../components/onair/data";
import { monitorOffAirText } from "../../components/onair/offAir";
import { ProgramPicture } from "../../components/onair/ProgramPicture";
import { AccountBanner } from "../../components/account/AccountBanner";
import { logEntryHref, readinessLine } from "../../components/onair/readiness";
import { breakLine, buildRundown, currentIndex, nextBreak, rundownFrom, type RundownRow } from "../../components/onair/rundown";
import { broadcastDay, dayClock, monthDay } from "../../components/onair/time";
import { useShellOptions, useIsPhone } from "../../layout/shell";
import { STATION_TZ, useNow } from "../../../lib/clock";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../common";
import "./Monitor.css";
import { controlPath } from "../../../areas";
import { stationLabel } from "../../station/slug";

const QUARTER = 15 * 60_000;
const HOUR = 3_600_000;
const iso = (n: number) => new Date(n).toISOString();

function sameDay(a: string | number, b: string | number) {
  const x = broadcastDay(a);
  const y = broadcastDay(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

function toItems(rows: RundownRow[]): RundownItem[] {
  return rows.map((r) => ({ id: r.id, at: r.at, code: r.code, title: r.title, source: r.source ?? undefined, length: r.lengthMs }));
}

const SERVICE: Record<string, string> = { youtube: "YouTube", twitch: "Twitch" };
const TRANSLATOR_STATUS: Record<string, string> = { relaying: "Relaying", connected: "Connected", not_connected: "Not connected" };

export default function Monitor() {
  const s = useStation();
  const phone = useIsPhone();
  const toast = useToast();
  const t = useNow(1000).getTime();
  // The windows move on the quarter hour, so the queries stay put between ticks.
  const quarter = Math.floor(t / QUARTER) * QUARTER;
  const params = { stationId: s.id };

  const playout = usePlayout(s.id);
  const log = useLog(s.id, iso(quarter - 4 * HOUR), iso(quarter + 12 * HOUR), { refetchInterval: 15_000 });
  const deadAir = useDeadAir(s.id);
  const setup = useApi(stationsApi.getSetup, { params }, { retry: false });
  const translators = useApi(stationsApi.listTranslators, { params }, { retry: false });
  const audience = useApi(audienceApi.getAudience, { params, query: { from: iso(quarter - HOUR), to: iso(quarter + QUARTER) } }, { retry: false, refetchInterval: 30_000 });
  const market = useApi(catalogApi.browse, { query: { forStation: s.id, fitsSchedule: true } }, { retry: false });
  const claimable = s.station.kind === "claimable";
  const page = useApi(stationsApi.getStation, { params: { stationRef: s.station.slug ?? s.station.callSign ?? s.id } }, { enabled: claimable, retry: false });

  const cue = useApiMutation(playoutApi.cueBreak, { invalidates: LOG_READS });
  const signOn = useApiMutation(playoutApi.signOn, { invalidates: LOG_READS });

  const rows = useMemo(() => (log.data ? buildRundown(log.data.entries, log.data.breaks, undefined, log.data.offAir) : []), [log.data]);
  const current = rows[currentIndex(rows, t)] ?? null;
  const liveEntry = log.data?.entries.find((e) => e.kind === "live" && Date.parse(e.startsAt) <= t && t < Date.parse(e.endsAt)) ?? null;
  const inBreak = current?.kind === "break";
  const status = playout.data;
  const onAir = !!status?.onAir;
  const canCue = s.can("live") && onAir && !!liveEntry && !inBreak;
  const brk = nextBreak(rows, t);

  const doCue = () =>
    cue.mutate(
      { params },
      {
        onSuccess: () => toast.show({ message: `Break cued. Back to ${liveEntry?.title ?? "the live program"} after the break.` }),
        onError: (e) => toast.show({ message: e.message })
      }
    );

  const cueButton = (label: string, size?: "sm") => (
    <Button size={size} onClick={doCue} disabled={!canCue || cue.isPending} title={canCue ? undefined : "For live programs"}>
      {label}
    </Button>
  );
  const signOff = s.can("manage") ? <Button href={`${s.base}/monitor?modal=sign-off`}>Sign off</Button> : null;
  useShellOptions(phone && onAir ? { actions: <>{cueButton("Cue a break")}{signOff}</> } : {}, [phone, onAir, canCue, cue.isPending]);

  if (playout.isLoading || log.isLoading) return <Quiet />;
  if (playout.isError) return <ControlTitle title="Monitor" description={playout.error.message} />;

  // Not signed on yet: the setup steps come first.
  if (setup.data?.status === "setting_up" && !status?.onAir) {
    return (
      <div className="cc-mon-page">
        <ControlTitle title="Monitor" description={`${s.label} isn't on air yet. Finish setting it up, then sign on.`} />
        <Button variant="primary" href={controlPath(`/setup/${s.id}/station`)}>
          Continue setting up
        </Button>
      </div>
    );
  }

  // G9: planned off air, on now or within 24 hours. Not dead air: never a warning.
  const offAirText = monitorOffAirText(status?.offAir ?? null, t);
  const plannedOffNow = !!status?.offAir && (status.offAir.now || Date.parse(status.offAir.startsAt) <= t);
  const since = status?.onAirSince ?? null;
  const sinceText = since ? (sameDay(since, t) ? clock(since, { timeZone: STATION_TZ }) : monthDay(since)) : null;
  const breakIn = status?.nextBreakAt ? Date.parse(status.nextBreakAt) - t : null;
  const description: ReactNode = onAir ? (
    <>
      {sinceText ? `On air since ${sinceText}.` : "On air."}
      {breakIn !== null && breakIn > 0 && (
        <>
          {" "}Break in <span className="oc-mono">{duration(breakIn)}</span>.
        </>
      )}
    </>
  ) : plannedOffNow && offAirText ? (
    `${offAirText}.`
  ) : (
    "Off air."
  );

  const runBy = claimable && page.data?.claimable && !page.data.claimable.claimed ? <span className="cc-mon__runby">Run by Opencast for {page.data.claimable.runFor}, not yet claimed. Earnings held in escrow</span> : null;

  const doSignOn = () => signOn.mutate({ params }, { onError: (e) => toast.show({ message: e.message }) });
  const end = (
    <>
      {runBy}
      {onAir && (liveEntry || !runBy) && cueButton("Cue a break now", "sm")}
      {!onAir && !plannedOffNow && s.can("manage") && (
        <Button variant="ink" size="sm" onClick={doSignOn} disabled={signOn.isPending}>
          Sign on
        </Button>
      )}
    </>
  );

  // Right now.
  const health: HealthRow[] = [];
  if (onAir && audience.data) health.push({ label: "Tuned in", value: audience.data.tunedInNow.toLocaleString("en-US") });
  if (onAir && status?.output.bitrateKbps) health.push({ label: "Signal", value: `${(status.output.bitrateKbps / 1000).toFixed(1)} Mbps`, good: true });
  for (const tr of translators.data ?? []) {
    if (tr.status === "not_connected" || !tr.enabled) continue;
    health.push({ label: SERVICE[tr.service] ?? tr.name, value: TRANSLATOR_STATUS[tr.status], good: tr.status === "relaying" });
  }
  const runsUntil = deadAir.data?.logRunsUntil ?? null;
  const shortLog = !!deadAir.data?.nextGapAt;
  if (deadAir.data) health.push({ label: "Log runs until", value: runsUntil ? dayClock(runsUntil) : "Nothing on the log", attention: shortLog, textValue: !runsUntil });
  // Prepare once, then assemble: the next 48 hours' items, prepared for air.
  // The item named links to its airing on the log (G13).
  const ready = readinessLine(status?.readiness, t);
  const named = ready?.parts.item;
  if (ready)
    health.push({
      label: "Prepared for air",
      value: named?.entryId ? (
        <>
          {ready.parts.head};{" "}
          <a className="cc-mon__ready" href={logEntryHref(s.base, named.entryId, named.airsAt)}>
            {named.title}
          </a>
          {named.rest}
        </>
      ) : (
        ready.text
      ),
      textValue: true,
      good: ready.good,
      attention: ready.attention
    });
  if (offAirText) health.push({ label: "Off air hours", value: offAirText, textValue: true });

  // From the market: programs that fit this station's open time.
  const gapAt = deadAir.data?.nextGapAt ?? null;
  const offers = (market.data ?? []).filter((o) => o.fitsYourSchedule).slice(0, 2);
  // The slot each fits (C1, the Market area's field): "Sat, 11:40 pm gap", "Weeknights after 1:00 am".
  const fitOf = (o: Offer) => o.fit?.find((f) => f.reason === "dead_air") ?? o.fit?.[0] ?? null;
  const fitLabel = (o: Offer) => {
    const f = fitOf(o);
    if (!f) return "";
    return f.reason === "dead_air" && f.startsAt ? `${dayClock(f.startsAt).split(" ")[0]}, ${f.label}` : f.title;
  };
  const offerHref = (o: Offer) => {
    const f = fitOf(o);
    const g = f ? (f.reason === "dead_air" ? f.startsAt : null) : gapAt;
    return g ? `${s.base}/market?gap=${encodeURIComponent(g)}` : `${s.base}/market/offers/${o.id}`;
  };
  const maker = (o: Offer) => (o.makerKind === "catalog" ? "catalog" : `from ${stationLabel(o.maker)}`);
  const marketRows: HealthRow[] = offers.map((o) => ({
    label: (
      <>
        <a className="cc-mon__offer" href={offerHref(o)}>
          {o.program.title}
        </a>
        , {maker(o)}
      </>
    ),
    value: fitLabel(o),
    textValue: true,
    attention: fitOf(o)?.reason === "dead_air"
  }));

  const onNow = status?.now ?? null;
  const programTitle = onNow?.title.replace(/, part \d+$/, "") ?? null;
  const onEntry = log.data?.entries.find((e) => Date.parse(e.startsAt) <= t && t < Date.parse(e.endsAt));
  const next = status?.next ?? null;
  const upcoming = rundownFrom(rows, t, phone ? 5 : 9);

  const picture = onAir ? (
    <ProgramPicture station={s.station} url={status?.output.playbackUrl ?? null} title={programTitle} subtitle={onEntry?.episodeTitle ?? null} square={phone} />
  ) : null;

  const rundown = upcoming.length ? (
    <Rundown items={toItems(upcoming)} nowId={onAir ? current?.id : undefined} variant={phone ? "compact" : "full"} timeZone={STATION_TZ} className="cc-mon__rundown" />
  ) : (
    <p className="cc-mon__quiet">Nothing is on the log from now.</p>
  );

  const countdownTo = brk ? Date.parse(brk.at) - t : null;

  if (phone) {
    // What's next, past any open time: a break ("Mission Soda, then 6 more") or a program.
    const upNext = rows.find((r) => Date.parse(r.at) > t && r.code !== "OPEN" && r.kind !== "gap") ?? rows.find((r) => Date.parse(r.at) > t);
    const nextUp = !!brk && upNext?.breakId === brk.first.breakId;
    return (
      <div className="cc-pm">
        {runBy && <div className="cc-pm__sec">{runBy}</div>}
        <AccountBanner className="cc-pm__banner" />
        {picture}
        {onAir && upNext && (
          <div className="cc-pm__sec cc-pm__next">
            <div>
              <small>{nextUp ? "Next, a break" : "Next"}</small>
              <b>{nextUp && brk ? breakLine(brk) : upNext.title}</b>
            </div>
            <span className="cc-pm__cd oc-mono">{duration(Date.parse(upNext.at) - t)}</span>
          </div>
        )}
        {!onAir && (
          <div className="cc-pm__sec">
            <ControlTitle title="Monitor" description={description} as="h1" />
            {s.can("manage") && !plannedOffNow && (
              <Button variant="ink" onClick={doSignOn} disabled={signOn.isPending}>
                Sign on
              </Button>
            )}
          </div>
        )}
        <div className="cc-pm__sec">
          <h2 className="cc-pm__h">Tonight</h2>
          {rundown}
        </div>
        {health.length > 0 && (
          <div className="cc-pm__sec cc-pm__sec--last">
            <KeyValueList variant="health" items={health.filter((h) => h.label === "Tuned in" || h.label === "Log runs until" || h.label === "Prepared for air" || h.label === "Off air hours")} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="cc-mon-page">
      <ControlTitle title="Monitor" description={description} end={end} />
      <AccountBanner className="cc-mon__banner" />
      {signOn.isError && <Notice tone="standby">{signOn.error.message}</Notice>}
      <div className="cc-mon">
        <div>
          {onAir && (
            <>
              <div className="cc-mon__lbl">
                <Tally state="lit" flicker={false} />
                Program
              </div>
              {picture}
            </>
          )}
          {rundown}
        </div>
        <div>
          {onAir && next && (
            <>
              <div className="cc-mon__lbl">Preview, next up{next.producer ? ` from ${next.producer}'s break time` : ""}</div>
              <PictureFrame className="cc-mon__pv">
                <div className="cc-mon__card" style={{ background: next.colour ?? undefined }}>
                  <b>{next.title}</b>
                  {next.detail && <span>{next.detail}</span>}
                </div>
              </PictureFrame>
            </>
          )}
          {onAir && countdownTo !== null && countdownTo > 0 && (
            <div className="cc-mon__cd">
              <span>Break in</span>
              <span className="cc-mon__cdv oc-mono">{duration(countdownTo)}</span>
            </div>
          )}
          <h2 className="cc-mon__h">Right now</h2>
          <KeyValueList variant="health" items={health} />
          <h2 className="cc-mon__h cc-mon__h--split">
            From the market<span>Fits your schedule</span>
          </h2>
          {market.isLoading ? null : marketRows.length ? (
            <KeyValueList variant="health" items={marketRows} className="cc-mon__market" />
          ) : (
            <p className="cc-mon__quiet">{market.isError ? market.error.message : "Nothing in the market fits your open time right now."}</p>
          )}
          <Button size="sm" href={`${s.base}/market`} className="cc-mon__open">
            Open the market
          </Button>
        </div>
      </div>
    </div>
  );
}
