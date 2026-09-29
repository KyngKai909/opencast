// Home's hero (01.1, 02.1): a muted preview of what's live in your market, with its own small
// player. It's labelled "Preview, muted" and has no tally: it isn't on your screen until you tune in.

import { useCallback, useEffect, useRef, useState } from "react";
import { libraryApi } from "@opencast/contracts";
import { defaultDriver } from "@opencast/player";
import { Button, PictureFrame, Tag, TitleCard, clock } from "@opencast/ui";
import type { DialRowX } from "../../api/ext";
import { useApi } from "../../../api/hooks";
import { useAuth } from "../../../auth/AuthProvider";
import { useMe } from "../../data/viewer";
import { useDevice } from "../../device/store";
import { identText, type HeroPick } from "./logic";
import { useOpenStation, useTuneAndWatch } from "./nav";
import "./Hero.css";

/** The system setting, or Settings, Appearance, "Reduce motion" (data-motion on <html>). */
function usePrefersReducedMotion(): boolean {
  const q = "(prefers-reduced-motion: reduce)";
  const read = () => typeof window !== "undefined" && (!!window.matchMedia?.(q).matches || document.documentElement.dataset.motion === "reduce");
  const [m, setM] = useState(read);
  useEffect(() => {
    const on = () => setM(read());
    const mq = window.matchMedia?.(q);
    mq?.addEventListener("change", on);
    const mo = new MutationObserver(on);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    return () => {
      mq?.removeEventListener("change", on);
      mo.disconnect();
    };
  }, []);
  return m;
}

/** Settings, Watching: "Muted previews" (on unless turned off). */
function useMutedPreviews(): boolean {
  const auth = useAuth();
  const me = useMe();
  const device = useDevice();
  const w = auth.signedIn ? me.data?.settings.watching : device.settings.watching;
  return w?.mutedPreviews !== false;
}

/** The hero's own player: always muted, joining live, never the app's player (so no tally, no heartbeat). */
function MutedPreview({ url, onFail }: { url: string; onFail: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    const handle = defaultDriver().attach(v, url, onFail);
    const play = () => void v.play().catch(() => {});
    v.addEventListener("canplay", play, { once: true });
    play();
    return () => {
      v.removeEventListener("canplay", play);
      handle.destroy();
    };
  }, [url, onFail]);
  return <video ref={ref} muted playsInline autoPlay aria-hidden="true" tabIndex={-1} />;
}

function HeroPicture({ row }: { row: DialRowX }) {
  const allowed = useMutedPreviews();
  const reduced = usePrefersReducedMotion();
  const [failed, setFailed] = useState(false);
  const url = row.playback?.kind === "hls" ? row.playback.url : null;
  useEffect(() => setFailed(false), [url]);
  const s = row.station;
  const live = !!row.now?.live;
  // A still in the station's colour when there's no picture to preview: radio, a city's own
  // stream, previews turned off, reduced motion, or a stream that won't load.
  const still = <TitleCard colour={s.colour ?? "#33507A"} title={row.now?.title ?? s.name} bottom={identText(s)} size="lg" className="vw-hero__still" decorative />;
  const onFail = useCallback(() => setFailed(true), []);
  return (
    <PictureFrame
      className="vw-hero__pic"
      label={`Preview, muted: ${row.now?.title ?? s.name} on ${identText(s)}`}
      corner={
        <>
          {live && (
            <Tag variant="live" onPicture>
              Live
            </Tag>
          )}
          <Tag onPicture>Preview, muted</Tag>
        </>
      }
      bug={url && !failed ? { callSign: s.callSign ?? "", channel: s.channel ?? "" } : undefined}
    >
      {url && allowed && !reduced && !failed ? <MutedPreview url={url} onFail={onFail} /> : still}
    </PictureFrame>
  );
}

function kicker(pick: HeroPick): string {
  if (pick.why === "local") return "Your market";
  if (pick.why === "carried") return `Carried from ${identText(pick.row.now?.carriedFrom ?? {})}`;
  return "Preset 1";
}

/** The hero: the picture, what it is, and Tune in / Station. */
export function Hero({ pick, phone, timeZone }: { pick: HeroPick; phone: boolean; timeZone: string }) {
  const tuneAndWatch = useTuneAndWatch();
  const openStation = useOpenStation();
  const { row } = pick;
  const s = row.station;
  const now = row.now!;
  const programId = now.programId;
  const program = useApi(libraryApi.getProgram, { params: { programId: programId ?? "" } }, { enabled: !!programId, staleTime: 300_000 });
  // G5: tonight's episode, described, before the program's own description.
  const description = now.episodeDescription ?? program.data?.description ?? null;
  const until = <span className="oc-mono">{clock(now.endsAt, { timeZone })}</span>;
  const lead = now.note ?? (now.carriedFrom ? `Carried from ${now.carriedFrom.callSign ?? ""}` : null);
  const acts = (
    <div className="vw-hero__acts">
      <Button variant="primary" onClick={() => tuneAndWatch(s)}>
        Tune in
      </Button>
      <Button variant="ghost" onClick={() => openStation(s)} aria-label={`Station: ${identText(s)}${s.name ? `, ${s.name}` : ""}`}>
        Station
      </Button>
    </div>
  );

  if (phone) {
    return (
      <section className="vw-hero vw-hero--phone" aria-label="Live in your market">
        <HeroPicture row={row} />
        <span className="vw-hero__line">
          {identText(s)}, until {until}
        </span>
        <h2 className="vw-hero__title">{now.title}</h2>
        {(description ?? now.note) && <p className="vw-hero__by">{description ?? now.note}</p>}
        {acts}
      </section>
    );
  }

  return (
    <>
      <HeroPicture row={row} />
      <div className="vw-hero__info">
        <div className="vw-hero__kick">
          {now.live && <Tag variant="live">Live</Tag>}
          <span>{kicker(pick)}</span>
        </div>
        <h2 className="vw-hero__title">{now.title}</h2>
        <p className="vw-hero__by">
          <b>{identText(s)}</b>
          {s.name ? `, ${s.name}.` : "."} {lead ? <>{lead} until {until}</> : <>Until {until}</>}
        </p>
        {description && <p className="vw-hero__desc">{description}</p>}
        {acts}
      </div>
    </>
  );
}
