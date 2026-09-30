// Going live (live-listings 02.1 on the web; 05.1 standing by and 05.2 on air on the phone), and
// the private rehearsal (/live-sources/:sourceId/rehearse, with no block).
//
// A live block goes out when its block starts: stand by with a countdown, then on air (the phone's
// tally lights), then ended. A browser source sends the camera to its ingest over WHIP (B3) from
// five minutes before the block until it ends; without an ingest (no Livepeer on the server) the
// picture stays on this screen. The lower third is the API's (S15), so a second device sees it.

import { useEffect, useMemo, useState } from "react";
import { logApi, playoutApi, stationsApi, type LiveSource, type LogEntry, type LowerThird } from "@opencast/contracts";
import { Button, KeyValueList, Modal, Notice, Sheet, Toggle, clock, duration, useToast } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { call } from "../../../api/client";
import { keyFor, useApi } from "../../../api/hooks";
import { STATION_TZ, useNow } from "../../../lib/clock";
import { useShellOptions, useIsPhone } from "../../layout/shell";
import { useMe, useStation } from "../../station/StationContext";
import { blockPhase, countdown, elapsed } from "./logic";
import { AddSpeaker, CameraBar, CountdownBox, LowerThirdEditor, SecTop, SpeakerList, StudioPicture, type Speaker } from "./Studio";
import { useCamera } from "./useCamera";
import { useOnAirDevice } from "./useOnAirDevice";
import { useWhip } from "./whip";
import "./StudioView.css";

export interface StudioViewProps {
  /** The live block, or null for a rehearsal. */
  entry: LogEntry | null;
  source: LiveSource | null;
  /** The log around now, for "Viewers are watching …". */
  log: LogEntry[];
}

/** "Late Crate", not "Late Crate, ep. 11": what viewers are watching, as the frame says it. */
function seriesTitle(e: LogEntry): string {
  return e.episodeTitle && /^ep\. \d+$/.test(e.episodeTitle) ? e.title.replace(/, ep\. \d+$/, "") : e.title;
}

export function StudioView({ entry, source, log }: StudioViewProps) {
  const s = useStation();
  const me = useMe();
  const phone = useIsPhone();
  const toast = useToast();
  const qc = useQueryClient();
  const now = useNow(250);
  const kind = source?.kind ?? "browser";
  const camera = useCamera(kind === "browser");
  const callSign = s.label;
  const bug = { callSign: s.station.callSign ?? s.station.name, channel: s.station.channel ?? "" };

  const stationId = s.id;
  const entryParams = entry ? { stationId, entryId: entry.id } : null;
  const block = useApi(logApi.getLiveBlock, { params: entryParams ?? {} }, { enabled: !!entry, retry: false, refetchInterval: 15_000 });
  const saved = useApi(stationsApi.getLowerThird, { params: entryParams ?? {} }, { enabled: !!entry, retry: false });
  const speakers = useApi(stationsApi.getSpeakers, { params: { programId: entry?.programId ?? "" } }, { enabled: !!entry?.programId, retry: false });
  const rule = useApi(stationsApi.getBreakRule, { params: { stationId } }, { enabled: !!entry, retry: false });

  const phase = entry ? blockPhase(entry, now, block.data?.endedEarlyAt) : "rehearsal";
  const onAir = phase === "on_air";
  const device = useOnAirDevice(onAir);
  // B3: the camera goes to the ingest from five minutes before the block, so it's there when it starts.
  const sending = kind === "browser" && !!entry && (onAir || (phase === "standby" && Date.parse(entry.startsAt) - now.getTime() <= 5 * 60_000));
  const whip = useWhip(kind === "browser" ? camera.stream : null, source?.ingest, sending);

  // The lower third: what the API holds (S15), or kept here when it can't say (a rehearsal).
  const [lt, setLt] = useState<LowerThird | null>(null);
  useEffect(() => {
    if (lt) return;
    if (saved.data) setLt(saved.data);
    else if (!entry || saved.isError) {
      const first = speakers.data?.[0];
      setLt({ entryId: entry?.id ?? "rehearsal", hidden: false, speakerId: first?.id ?? null, name: first?.name ?? me.data?.displayName ?? "", title: first?.title ?? null });
    }
  }, [saved.data, saved.isError, speakers.data, entry, lt, me.data]);

  const save = async (next: LowerThird) => {
    if (!entryParams) return;
    try {
      const out = await call(stationsApi.setLowerThird, { params: entryParams, body: { hidden: next.hidden, speakerId: next.speakerId, name: next.name, title: next.title } });
      qc.setQueryData([...keyFor(stationsApi.getLowerThird, { params: entryParams }), 0], out);
    } catch (e) {
      // It stays on this screen; say why the API didn't take it.
      toast.show({ message: e instanceof Error ? e.message : "Something went wrong. Try again." });
    }
  };
  const change = (patch: Partial<LowerThird>, commit: boolean) => {
    setLt((cur) => {
      if (!cur) return cur;
      const next = { ...cur, ...patch };
      if (commit) void save(next);
      return next;
    });
  };
  const show = (sp: Speaker) => change({ speakerId: sp.id, name: sp.name, title: sp.title, hidden: false }, true);

  // Speakers.
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const addSpeaker = async (name: string, title: string | null) => {
    if (!entry?.programId) return;
    const list = speakers.data ?? [];
    try {
      const out = await call(stationsApi.setSpeakers, { params: { programId: entry.programId }, body: [...list.map((x) => ({ name: x.name, title: x.title })), { name, title }] });
      qc.setQueryData([...keyFor(stationsApi.getSpeakers, { params: { programId: entry.programId } }), 0], out);
      setAdding(false);
      setAddError(null);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    }
  };

  // During the show.
  const [cueing, setCueing] = useState(false);
  const breakLength = rule.data ? duration(rule.data.lengthMs) : null;
  const cue = async () => {
    setCueing(true);
    try {
      await call(playoutApi.cueBreak, { params: { stationId } });
      toast.show({ message: breakLength ? `Break cued: ${breakLength} from the rotation, then back to you.` : "Break cued: from the rotation, then back to you." });
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : "Something went wrong. Try again." });
    } finally {
      setCueing(false);
    }
  };
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const end = async () => {
    if (!entryParams) return;
    try {
      await call(logApi.endEarly, { params: entryParams });
      await Promise.all([block.refetch(), qc.invalidateQueries({ queryKey: ["GET", logApi.getLog.path] })]);
      setEnding(false);
    } catch (e) {
      setEndError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    }
  };

  const current = useMemo(() => {
    const t = now.toISOString();
    return log.find((e) => e.startsAt <= t && t < e.endsAt && e.id !== entry?.id) ?? null;
    // Once a second is enough for this line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, entry?.id, Math.floor(now.getTime() / 1000)]);

  const title = entry?.title ?? "Rehearsal";
  const count = entry ? countdown(entry.startsAt, now) : "";
  const elapsedText = entry ? elapsed(entry.startsAt, now) : "";
  // The connection dropped: this device went offline, or the ingest lost it (it reconnects).
  const dropped = onAir && (!device.online || whip === "dropped");

  const note =
    phase === "on_air"
      ? "On air: viewers see this picture."
      : phase === "ended"
        ? null
        : `Rehearsal: this preview isn't going anywhere yet.${current ? ` Viewers are watching ${seriesTitle(current)} until ${clock(current.endsAt, { timeZone: STATION_TZ, suffix: false })}.` : ""}`;

  const cueRow = {
    title: "Cue a break",
    detail: breakLength ? `${breakLength} from the rotation, then back to you` : "From the rotation, then back to you",
    actions: onAir ? (
      <Button size="sm" onClick={() => void cue()} disabled={cueing}>
        Cue a break
      </Button>
    ) : (
      <Button size="sm" disabled>
        On air only
      </Button>
    )
  };
  const endRow = {
    title: "End early",
    detail: "Hands back to the log",
    actions: onAir ? (
      <Button size="sm" onClick={() => setEnding(true)}>
        End early
      </Button>
    ) : (
      <Button size="sm" disabled>
        On air only
      </Button>
    )
  };

  useShellOptions(
    phone
      ? {
          flush: true,
          context: phase === "on_air" ? elapsedText : phase === "ended" ? "Ended" : "Go live",
          // Stand by before the block, lit while it goes out; otherwise the station's own tally.
          tally: phase === "on_air" ? "lit" : phase === "standby" ? "standby" : undefined,
          actions: onAir ? (
            <>
              <Button onClick={() => void cue()} disabled={cueing}>
                Cue a break
              </Button>
              <Button onClick={() => setEnding(true)}>End early</Button>
            </>
          ) : undefined
        }
      : {},
    [phone, phase, elapsedText, cueing]
  );

  const picture = (
    <StudioPicture
      kind={kind}
      camera={camera}
      signalUrl={source?.previewUrl ?? null}
      bug={bug}
      lowerThird={lt}
      standby={!phone && phase === "standby"}
      dropped={dropped}
      fill={phone}
      label={kind === "browser" ? `Your camera, with ${callSign}'s graphics` : `${source?.name ?? "The encoder"}'s signal, with ${callSign}'s graphics`}
    />
  );

  const endDialog = entry && (
    <EndEarly
      open={ending}
      phone={phone}
      title={entry.title}
      endsAt={entry.endsAt}
      error={endError}
      onClose={() => {
        setEnding(false);
        setEndError(null);
      }}
      onEnd={() => void end()}
    />
  );
  const addDialog = <AddSpeaker open={adding} phone={phone} onClose={() => setAdding(false)} onAdd={(n, t) => void addSpeaker(n, t)} error={addError} />;
  const speakerList = entry?.programId && speakers.data ? <SpeakerList speakers={speakers.data} showing={lt && !lt.hidden ? lt.speakerId : null} onShow={show} onAdd={() => setAdding(true)} /> : null;

  if (phone) {
    return (
      <div className="cc-live-phone">
        <div className="cc-live-phone__pic">{picture}</div>
        {device.battery && (
          <div className="cc-live-phone__sec">
            <Notice title={`Battery at ${Math.round(device.battery.level * 100)}%`}>{device.battery.minutesLeft ? `, about ${device.battery.minutesLeft} min left at this rate.` : "."}</Notice>
          </div>
        )}
        {phase === "standby" && entry && (
          <>
            <div className="cc-live-phone__sec cc-live-phone__next">
              <div>
                <small>Goes out at {clock(entry.startsAt, { timeZone: STATION_TZ })}</small>
                <b>{entry.title}</b>
              </div>
              <span className="cc-live-phone__cd" role="timer" aria-label={`${count} to go`}>
                {count}
              </span>
            </div>
            <LowerThirdRow lt={lt} speakers={speakers.data ?? []} onShow={show} onToggle={(on) => change({ hidden: !on }, true)} onAdd={() => setAdding(true)} />
          </>
        )}
        {phase === "on_air" && <div className="cc-live-phone__sec">{speakerList}</div>}
        {phase === "ended" && entry && (
          <div className="cc-live-phone__sec">
            <p className="cc-live-phone__ended">
              {entry.title} ended at <span className="oc-mono">{clock(block.data?.endedEarlyAt ?? entry.endsAt, { timeZone: STATION_TZ })}</span>. The log took over.
            </p>
          </div>
        )}
        {phase === "rehearsal" && (
          <div className="cc-live-phone__sec">
            <p className="cc-live-phone__ended">A private rehearsal only you see.</p>
          </div>
        )}
        {endDialog}
        {addDialog}
      </div>
    );
  }

  return (
    <div className="cc-golive">
      <div>
        {picture}
        {kind === "browser" ? (
          <CameraBar camera={camera} />
        ) : (
          <div className="cc-studio__bar">
            <span className="cc-golive__signal">{source?.signal === "receiving" ? `Receiving${source.quality ? `, ${source.quality}` : ""} from ${source.name}` : `Nothing is arriving from ${source?.name ?? "the encoder"} yet.`}</span>
          </div>
        )}
        {note && <p className="cc-studio__note">{note}</p>}
        {device.battery && (
          <Notice className="cc-golive__battery" title={`Battery at ${Math.round(device.battery.level * 100)}%`}>
            {device.battery.minutesLeft ? `, about ${device.battery.minutesLeft} min left at this rate.` : "."}
          </Notice>
        )}
        {speakerList && <div className="cc-golive__speakers">{speakerList}</div>}
      </div>
      <div>
        {entry && <CountdownBox phase={phase as "standby" | "on_air" | "ended"} title={entry.title} startsAt={entry.startsAt} endsAt={entry.endsAt} count={count} elapsedText={elapsedText} endedAt={block.data?.endedEarlyAt ?? null} />}
        <div className="cc-golive__side">
          <LowerThirdEditor value={lt} onChange={change} />
          {entry && (
            <section aria-labelledby="cc-show-h">
              <SecTop id="cc-show-h" title="During the show" />
              <KeyValueList variant="rows" items={[cueRow, endRow]} className="cc-golive__rows" />
            </section>
          )}
        </div>
      </div>
      {endDialog}
      {addDialog}
    </div>
  );
}

/** Phone, standing by: the lower third in a line, and Change for the speaker list (05.1). */
function LowerThirdRow({ lt, speakers, onShow, onToggle, onAdd }: { lt: LowerThird | null; speakers: Speaker[]; onShow: (s: Speaker) => void; onToggle: (on: boolean) => void; onAdd: () => void }) {
  const [open, setOpen] = useState(false);
  const words = lt && !lt.hidden && lt.name ? [lt.name, lt.title?.split(",")[0]].filter(Boolean).join(", ") : "Hidden";
  return (
    <div className="cc-live-phone__sec cc-live-phone__sec--last">
      <KeyValueList
        variant="rows"
        className="cc-live-phone__l3"
        items={[
          {
            title: "Lower third",
            detail: words,
            actions: (
              <Button size="sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
                Change
              </Button>
            )
          }
        ]}
      />
      <Sheet open={open} onClose={() => setOpen(false)} title="Lower third">
        <KeyValueList variant="rows" items={[{ title: "Show the lower third", actions: <Toggle checked={!!lt && !lt.hidden} label="Show the lower third" onChange={onToggle} /> }]} />
        <SpeakerList
          heading={false}
          speakers={speakers}
          showing={lt && !lt.hidden ? lt.speakerId : null}
          onShow={(s) => {
            onShow(s);
            setOpen(false);
          }}
          onAdd={() => {
            setOpen(false);
            onAdd();
          }}
        />
      </Sheet>
    </div>
  );
}

/** Ending early can't be taken back, so it asks once (G3). */
function EndEarly({ open, phone, title, endsAt, error, onClose, onEnd }: { open: boolean; phone: boolean; title: string; endsAt: string; error: string | null; onClose: () => void; onEnd: () => void }) {
  const Dialog = phone ? Sheet : Modal;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`End ${title} early?`}
      footer={
        <>
          <Button variant="ink" onClick={onEnd}>
            End early
          </Button>
          <Button onClick={onClose}>Keep going</Button>
        </>
      }
    >
      <p className="cc-golive__dialog-p">
        The log fills the rest of the block, until <span className="oc-mono">{clock(endsAt, { timeZone: STATION_TZ })}</span>. It never goes to dead air.
      </p>
      {error && (
        <p className="cc-golive__dialog-p" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
