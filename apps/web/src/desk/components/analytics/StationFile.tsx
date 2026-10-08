// The desk's station file (added 2026-10-07, the user's request): beside one station's numbers, who
// made it and when, everyone on it, what it uploaded (with a preview once prepared, and the rights
// reason its people gave) and what's on its log. Previews play what's prepared already; the desk
// never asks for a file to be prepared just to look at it.

import { useEffect, useRef, useState } from "react";
import { RIGHTS_BASIS_LABELS, type AnalyticsStationFile } from "@opencast/contracts";
import { clockText, dateOf, minutesText, num, shortDate } from "./span";

type File = AnalyticsStationFile;
type Upload = File["uploads"]["items"][number];

const ROLES: Record<string, string> = { owner: "Owner", manager: "Manager", operator: "Operator", host: "Host", viewer: "Viewer" };
const CODES: Record<string, string> = { PGM: "Program", SPT: "Spot", UND: "Underwriting", BMP: "Bumper", SID: "Station ID", OPEN: "Open" };
const SOURCES: Record<string, string> = { upload: "Uploaded", link: "From a link", creator_work: "A creator's work", library: "From the library" };
const STATUS: Record<string, string> = { setting_up: "Setting up", on_air: "On air", off_air: "Off air", signed_off: "Signed off" };
const KINDS: Record<string, string> = { program: "Program", live: "Live", off_air: "Off air" };

const day = (at: string) => shortDate(dateOf(new Date(at)));
const when = (at: string) => `${day(at)}, ${clockText(new Date(at))}`;
const length = (ms: number | null) => (ms == null ? "—" : minutesText(ms / 60_000));
const who = (p: File["people"][number] | undefined) => (p ? (p.name ?? p.email ?? "A deleted account") : "nobody on it now");
const rightsText = (r: Upload["rights"]) => (r ? (RIGHTS_BASIS_LABELS[r.basis as keyof typeof RIGHTS_BASIS_LABELS] ?? r.basis) : "Not confirmed");

/** Under the station's name: when it was made, by whom, and how it started. */
export function MadeBy({ file }: { file: File }) {
  const maker = file.people.find((p) => p.madeIt);
  const s = file.station;
  return (
    <p className="nd-an__made">
      Made {day(s.createdAt)} by <b>{who(maker)}</b>
      {maker?.name && maker.email ? <span className="nd-an__q"> ({maker.email})</span> : null}.{" "}
      {file.started.how === "pipeline" && file.started.creator ? `Set up from the pipeline for ${file.started.creator.name}.` : "Signed up and made it on their own."} {STATUS[s.status] ?? s.status}
      {s.firstSignedOnAt ? `, first on air ${day(s.firstSignedOnAt)}` : ", never on air yet"}.
    </p>
  );
}

export function PeopleView({ file }: { file: File }) {
  const c = file.started.creator;
  return (
    <>
      <section className="nd-an__card" aria-labelledby="sf-people">
        <header className="nd-an__card-head">
          <div>
            <h2 id="sf-people">Everyone on {file.station.callSign ?? file.station.name}</h2>
            <p>Oldest first. Emails are for the desk only.</p>
          </div>
        </header>
        <div className="nd-an__t" role="table" aria-label="Everyone on the station">
          <div className="nd-an__th nd-an__person" role="row">
            <span role="columnheader">Person</span>
            <span role="columnheader">Role</span>
            <span role="columnheader">Joined</span>
            <span role="columnheader">Last in master control</span>
            <span role="columnheader">Last seen</span>
            <span role="columnheader">Account made</span>
          </div>
          {file.people.map((p) => (
            <div key={p.userId} className="nd-an__tr nd-an__person" role="row">
              <span role="cell" className="nd-an__who">
                <b>
                  {p.name ?? p.email ?? "A deleted account"} {p.madeIt && <span className="nd-an__pill cl">Made the station</span>}
                </b>
                {p.name && p.email && <small>{p.email}</small>}
              </span>
              <span role="cell">{ROLES[p.role] ?? p.role}</span>
              <span role="cell">{day(p.joinedAt)}</span>
              <span role="cell">{p.lastInAt ? when(p.lastInAt) : <span className="nd-an__q">Never</span>}</span>
              <span role="cell">{p.lastSeenAt ? when(p.lastSeenAt) : <span className="nd-an__q">—</span>}</span>
              <span role="cell">{day(p.accountCreatedAt)}</span>
            </div>
          ))}
          {!file.people.length && <p className="nd-an__none">Nobody is on this station.</p>}
        </div>
      </section>
      {c && (
        <section className="nd-an__card nd-an__mt" aria-labelledby="sf-creator">
          <header className="nd-an__card-head">
            <div>
              <h2 id="sf-creator">From the pipeline</h2>
              <p>The creator the desk set this station up for</p>
            </div>
          </header>
          <ul className="nd-an__rows nd-an__rows--money">
            <li>
              <span>{c.name}</span>
              <b>{c.stage.replace(/_/g, " ")}</b>
            </li>
            <li>
              <span>Where they post</span>
              <a className="nd-an__stlink" href={c.sourceUrl} target="_blank" rel="noreferrer noopener">
                {c.sourceUrl}
              </a>
            </li>
            {c.market && (
              <li>
                <span>Market</span>
                <b>{c.market.name}</b>
              </li>
            )}
          </ul>
        </section>
      )}
    </>
  );
}

export function UploadsView({ file }: { file: File }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const u = file.uploads;
  const items = u.items.filter((i) => archived || !i.archivedAt);
  return (
    <section className="nd-an__card" aria-labelledby="sf-uploads">
      <header className="nd-an__card-head">
        <div>
          <h2 id="sf-uploads">What it uploaded</h2>
          <p>
            {num(u.total)} {u.total === 1 ? "item" : "items"}, {num(u.hours)} hours. {u.rightsToConfirm ? `${num(u.rightsToConfirm)} without rights confirmed, so they can't air. ` : ""}Newest first; play shows what&rsquo;s been prepared.
          </p>
        </div>
        {u.archived > 0 && (
          <button type="button" className="nd-an__chip" aria-pressed={archived} onClick={() => setArchived((a) => !a)}>
            {archived ? "Hide" : "Show"} {num(u.archived)} archived
          </button>
        )}
      </header>
      <div className="nd-an__t" role="table" aria-label="The station's uploads">
        <div className="nd-an__th nd-an__upl" role="row">
          <span role="columnheader">
            <span className="nd-an__sr">Play</span>
          </span>
          <span role="columnheader">Title</span>
          <span role="columnheader">Length</span>
          <span role="columnheader">Added</span>
          <span role="columnheader">Rights</span>
        </div>
        {items.map((i) => (
          <div key={i.id} className="nd-an__uplwrap" role="rowgroup">
            <div className="nd-an__tr nd-an__upl" role="row">
              <span role="cell">
                {i.preview?.status === "ready" && i.preview.url ? (
                  <button type="button" className="nd-an__play" aria-label={`${playing === i.id ? "Close" : "Play"} ${i.title}`} aria-expanded={playing === i.id} onClick={() => setPlaying((p) => (p === i.id ? null : i.id))}>
                    {playing === i.id ? "■" : "▶"}
                  </button>
                ) : (
                  <span className="nd-an__q" title={i.status === "failed" ? "It couldn't be prepared" : "Not prepared yet"}>
                    ·
                  </span>
                )}
              </span>
              <span role="cell" className="nd-an__who">
                <b>
                  {i.title} {i.archivedAt && <span className="nd-an__pill ne">Archived</span>} {i.status === "failed" && <span className="nd-an__pill dn">Failed</span>} {i.status === "preparing" && <span className="nd-an__pill ne">Preparing</span>}
                </b>
                <small>
                  {[i.program, CODES[i.code] ?? i.code, i.mediaKind === "audio" ? "Sound only" : null, SOURCES[i.source] ?? i.source, i.originalFilename].filter(Boolean).join(" · ")}
                  {i.sourceUrl && (
                    <>
                      {" · "}
                      <a className="nd-an__stlink" href={i.sourceUrl} target="_blank" rel="noreferrer noopener">
                        the link
                      </a>
                    </>
                  )}
                </small>
              </span>
              <span role="cell">{length(i.durationMs)}</span>
              <span role="cell">{day(i.addedAt)}</span>
              <span role="cell" className="nd-an__who">
                <span className={i.rights ? undefined : "nd-an__neg"}>{rightsText(i.rights)}</span>
                {i.rights?.note && <small>&ldquo;{i.rights.note}&rdquo;</small>}
              </span>
            </div>
            {playing === i.id && i.preview?.url && <Preview url={i.preview.url} title={i.title} audio={i.mediaKind === "audio"} />}
          </div>
        ))}
        {!items.length && <p className="nd-an__none">Nothing uploaded.</p>}
      </div>
    </section>
  );
}

/** A prepared file's preview: native HLS where the browser has it (Safari), hls.js elsewhere. */
function Preview({ url, title, audio }: { url: string; title: string; audio: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      return;
    }
    let destroy: (() => void) | undefined;
    let gone = false;
    void import("hls.js")
      .then(({ default: Hls }) => {
        if (gone) return;
        if (!Hls.isSupported()) return setFailed(true);
        const hls = new Hls();
        hls.on(Hls.Events.ERROR, (_e, data) => data.fatal && setFailed(true));
        hls.loadSource(url);
        hls.attachMedia(video);
        destroy = () => hls.destroy();
      })
      .catch(() => setFailed(true));
    return () => {
      gone = true;
      destroy?.();
    };
  }, [url]);
  return (
    <div className={`nd-an__preview${audio ? " nd-an__preview--audio" : ""}`}>
      <video ref={ref} controls autoPlay playsInline aria-label={`Preview of ${title}`} />
      {failed && <p className="nd-an__none">The preview couldn&rsquo;t be played.</p>}
    </div>
  );
}

export function ScheduleView({ file }: { file: File }) {
  const s = file.schedule;
  const week = 7 * 24 * 60;
  const pct = (n: number) => `${Math.round((n / week) * 100)}%`;
  return (
    <>
      <div className="nd-an__kps nd-an__kps--5">
        <Kpi label="On now" value={s.now ? (s.now.title ?? KINDS[s.now.kind]!) : file.station.onAir ? "Filling" : "Nothing"} note={s.now ? `until ${clockText(new Date(s.now.endsAt))}` : file.station.onAir ? "nothing scheduled, so playout fills" : "off the air"} />
        <Kpi label="Next 7 days scheduled" value={pct(s.week.program + s.week.live)} note={`${minutesText(s.week.program + s.week.live)}`} />
        <Kpi label="Nothing scheduled" value={minutesText(s.week.empty)} note={`${pct(s.week.empty)} of the week`} bad={s.week.empty > week / 2} />
        <Kpi label="Log runs to" value={s.lastScheduledAt ? day(s.lastScheduledAt) : "—"} note={s.lastScheduledAt ? clockText(new Date(s.lastScheduledAt)) : "nothing ever scheduled"} />
        <Kpi label="Live sources" value={num(s.liveSources)} note={s.week.live ? `${minutesText(s.week.live)} live this week` : "no live shows this week"} />
      </div>
      <section className="nd-an__card nd-an__mt" aria-labelledby="sf-log">
        <header className="nd-an__card-head">
          <div>
            <h2 id="sf-log">The next 48 hours</h2>
            <p>From the station&rsquo;s log, Pacific time. Gaps are filled from its library while it&rsquo;s on air.</p>
          </div>
        </header>
        <div className="nd-an__t" role="table" aria-label="The next 48 hours of the log">
          {s.entries.map((e) => (
            <div key={e.startsAt} className="nd-an__tr nd-an__logrow" role="row">
              <span role="cell" className="nd-an__q">
                {when(e.startsAt)} to {clockText(new Date(e.endsAt))}
              </span>
              <span role="cell">{e.title ?? <span className="nd-an__q">Untitled</span>}</span>
              <span role="cell">
                <span className={`nd-an__pill ${e.kind === "live" ? "cl" : "ne"}`}>{e.kind === "program" ? (CODES[e.code] ?? e.code) : KINDS[e.kind]}</span>
              </span>
            </div>
          ))}
          {!s.entries.length && <p className="nd-an__none">Nothing on the log in the next 48 hours.</p>}
        </div>
      </section>
    </>
  );
}

function Kpi({ label, value, note, bad }: { label: string; value: string; note: string; bad?: boolean }) {
  return (
    <div className="nd-an__kp">
      <span className="nd-an__kp-l">{label}</span>
      <b className={`nd-an__kp-v${bad ? " nd-an__neg" : ""}`}>{value}</b>
      <span className="nd-an__kp-c">
        <span className="nd-an__q">{note}</span>
      </span>
    </div>
  );
}
