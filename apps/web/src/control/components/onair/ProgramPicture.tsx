// The program monitor: the station's output as viewers get it (playout's playback URL), muted,
// with the bug. Until the picture arrives, or when the output can't be played here, the title
// of what's on stands in for it.

import { useEffect, useMemo, type ReactNode } from "react";
import type { DialRow, StationIdent } from "@opencast/contracts";
import { PictureFrame, PicturePlaceholder } from "@opencast/ui";
import { PlayerProvider, PlayerSurface, usePlayer, type EngineOptions } from "@opencast/player";
import { now, STATION_TZ } from "../../../lib/clock";
import "./ProgramPicture.css";

// One picture, no neighbours to warm and no channel banner: a monitor, not a tuner.
const OPTIONS: EngineOptions = { warm: "none", bannerMs: 0 };

export interface ProgramPictureProps {
  station: StationIdent;
  /** playout.getStatus().output.playbackUrl; null shows the title card. */
  url: string | null;
  title?: string | null;
  subtitle?: string | null;
  /** On the tally's words: the monitor's own tally sits top right. */
  topRight?: ReactNode;
  /** Edge to edge, on the phone. */
  square?: boolean;
  className?: string;
}

export function ProgramPicture({ station, url, title, subtitle, topRight, square, className }: ProgramPictureProps) {
  const bug = station.callSign && station.channel ? { callSign: station.callSign, channel: station.channel } : undefined;
  const radio = station.band === "radio";
  return (
    <PictureFrame className={`cc-program ${className ?? ""}`} square={square} bug={radio ? undefined : bug} topRight={topRight}>
      {url ? (
        <PlayerProvider options={OPTIONS}>
          <Picture station={station} url={url} title={title} subtitle={subtitle} />
        </PlayerProvider>
      ) : (
        <Card station={station} title={title} subtitle={subtitle} />
      )}
    </PictureFrame>
  );
}

function Card({ station, title, subtitle }: Pick<ProgramPictureProps, "station" | "title" | "subtitle">) {
  if (station.band === "radio") {
    return (
      <div className="cc-program__radio" style={{ background: station.colour ?? undefined }}>
        <span className="oc-mono">{station.channel}</span>
      </div>
    );
  }
  return <PicturePlaceholder scene="reel" title={title ?? undefined} subtitle={subtitle ?? undefined} />;
}

function Picture({ station, url, title, subtitle }: Pick<ProgramPictureProps, "station" | "title" | "subtitle"> & { url: string }) {
  const [s, engine] = usePlayer();
  const channel = useMemo<DialRow>(() => ({ station, onAir: true, now: null, next: null, playback: { kind: "hls", url } }), [station, url]);
  useEffect(() => {
    engine.setMuted(true);
    engine.setChannels([channel]);
    void engine.tune(station.id);
  }, [engine, channel, station.id]);
  // Radio has no picture: its colour and frequency stand in, as the frame draws it (the monitor's
  // own tally is beside it, so the player's radio screen, with a tally of its own, stays hidden).
  const showing = s.status === "playing" && s.currentId === station.id && station.band !== "radio";
  return (
    <>
      <PlayerSurface timeZone={STATION_TZ} clock={now} className="cc-program__player" />
      {!showing && (
        <div className="cc-program__cover">
          <Card station={station} title={title} subtitle={subtitle} />
        </div>
      )}
    </>
  );
}
