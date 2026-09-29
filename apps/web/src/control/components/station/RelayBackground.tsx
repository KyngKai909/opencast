// A radio station's relay background (contracts of 2026-09-29): the picture its translators air
// under its sound, since YouTube, Twitch and other services want video. Relays only: Opencast's
// own apps draw the radio screen themselves and never show it. On the Translators page and in
// Settings, Translators, below the relays, for radio stations only: a preview (the prepared loop,
// with the bug as the relay draws it; without one, the station's colour with its call sign and
// channel), Upload or Replace, and Remove. Owners and operators.

import { useRef, useState, type CSSProperties } from "react";
import { stationsApi, type RelayBackground as Background } from "@opencast/contracts";
import { Button, PictureFrame, useToast } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, call } from "../../../api/client";
import { useApi } from "../../../api/hooks";
import { useAuth } from "../../../auth/AuthProvider";
import { sendFile } from "../live/upload";
import { SecTop } from "../live/Studio";
import "./RelayBackground.css";

export const RELAY_BACKGROUND_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm";

/** The line under the preview: what the relays show. */
export function backgroundLine(bg: Background | null, callSign: string): string {
  if (!bg) return `None yet. Relays show ${callSign}'s colour with its call sign and channel.`;
  if (bg.status === "preparing") return `${bg.fileName ?? "Your file"} is being prepared. Relays keep showing what they show now until it's ready.`;
  if (bg.status === "failed") return bg.error ?? "That file couldn't be made into a loop. Try another.";
  const seconds = bg.durationMs ? Math.round(bg.durationMs / 100) / 10 : null;
  if (bg.kind === "image") return `${bg.fileName ?? "A picture"}, held still.`;
  return `${bg.fileName ?? (bg.kind === "gif" ? "A GIF" : "A video")}, looping every ${seconds ?? "few"} seconds.`;
}

export interface RelayBackgroundProps {
  stationId: string;
  /** "BEAT". */
  callSign: string;
  /** "88.3". */
  channel: string | null;
  /** The station's colour, for the picture relays use without a background. */
  colour: string | null;
  canEdit: boolean;
}

export function RelayBackground({ stationId, callSign, channel, colour, canEdit }: RelayBackgroundProps) {
  const params = { stationId };
  const q = useApi(stationsApi.getRelayBackground, { params }, { refetchInterval: (query) => (query.state.data?.background?.status === "preparing" ? 2_000 : false) });
  const qc = useQueryClient();
  const auth = useAuth();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["GET", stationsApi.getRelayBackground.path] });

  if (q.isLoading) return <div className="cc-rbg cc-rbg--loading" aria-busy="true" />;
  // Not there yet (an API without backgrounds): the section stays out of the way.
  if (q.isError && q.error instanceof ApiError && q.error.code === "not_available") return null;
  const bg = q.data?.background ?? null;

  const upload = async (f: File) => {
    setBusy(true);
    setError(null);
    try {
      await sendFile(stationsApi.setRelayBackground, { stationId }, f, {}, auth.getToken);
      await refresh();
      toast.show({ message: `${f.name} is being prepared. Relays show it once it's ready.` });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await call(stationsApi.removeRelayBackground, { params });
      await refresh();
      toast.show({ message: `Background removed. Relays show ${callSign}'s colour again.` });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const ident = [callSign, channel].filter(Boolean).join(" ");
  const ready = bg?.status === "ready";
  const picture = ready && bg.loopUrl ? (
    <video className="cc-rbg__media" src={bg.loopUrl} poster={bg.stillUrl ?? undefined} autoPlay loop muted playsInline aria-hidden="true" />
  ) : bg?.stillUrl ? (
    <img className="cc-rbg__media" src={bg.stillUrl} alt="" />
  ) : (
    // What relays use without one: the station's colour with its call sign and channel.
    <div className="cc-rbg__colour" style={{ "--cc-rbg-colour": colour ?? "#1A1A1A" } as CSSProperties} aria-hidden="true">
      <b>{ident}</b>
    </div>
  );

  return (
    <section className="cc-rbg" aria-labelledby="cc-rbg-h">
      <SecTop id="cc-rbg-h" title="Relay background" />
      <p className="cc-rbg__p">What YouTube, Twitch and other services show under {callSign}'s sound. Listeners on Opencast never see it.</p>
      <div className="cc-rbg__body">
        <PictureFrame className="cc-rbg__frame" label={ready ? `The relay background, ${bg.fileName ?? "your picture"}, with the bug` : `What relays show: ${ident} in ${callSign}'s colour`} bug={channel ? { callSign, channel } : undefined}>
          {picture}
        </PictureFrame>
        <div className="cc-rbg__side">
          <p className="cc-rbg__line" aria-live="polite">
            {backgroundLine(bg, callSign)}
          </p>
          <p className="cc-rbg__help">An image, a GIF, or a video up to 30 seconds. Its sound is left out. Spots' codes show over it for their last 10 seconds, as they do on TV.</p>
          {canEdit && (
            <div className="cc-rbg__actions">
              <Button size="sm" icon="upload" disabled={busy || bg?.status === "preparing"} onClick={() => file.current?.click()}>
                {bg ? "Replace" : "Upload"}
              </Button>
              {bg && (
                <Button size="sm" variant="text" disabled={busy} onClick={() => void remove()}>
                  Remove
                </Button>
              )}
            </div>
          )}
          {error && (
            <p className="cc-rbg__error" role="alert">
              {error}
            </p>
          )}
          <input
            ref={file}
            type="file"
            accept={RELAY_BACKGROUND_ACCEPT}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
    </section>
  );
}
