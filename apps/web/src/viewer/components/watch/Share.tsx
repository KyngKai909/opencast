// Share (home 07.1): `?modal=share&station=<CALLSIGN>[&airing=<id>]`. Share a time, not a video:
// the station ("whatever is on"), or this airing, which tunes in if it's on and offers a reminder
// if it isn't yet. The link, Copy link, and More options through the Web Share API.

import { useState } from "react";
import { stationsApi } from "@opencast/contracts";
import { Button, ChoiceList, Icon, TitleCard, clock, useToast } from "@opencast/ui";
import { StationPageX, type AiringX } from "../../api/ext";
import { MARKET_TZ } from "../../../lib/clock";
import { Dialog, useApiAs } from "./overlay";
import { identText, stationSlug, zoned } from "./logic";

/** "tonight at 9:00 pm", "tomorrow at 9:00 am", "on now". */
export function airingWhen(a: Pick<AiringX, "startsAt" | "endsAt">, now: Date, timeZone: string): string {
  const t = now.getTime();
  if (Date.parse(a.startsAt) <= t && t < Date.parse(a.endsAt)) return "on now";
  const s = zoned(new Date(a.startsAt), timeZone);
  const n = zoned(now, timeZone);
  const days = Math.round((Date.UTC(s.y, s.m - 1, s.d) - Date.UTC(n.y, n.m - 1, n.d)) / 86_400_000);
  const at = clock(a.startsAt, { timeZone });
  if (days === 0) return `${s.h >= 17 ? "tonight" : "today"} at ${at}`;
  if (days === 1) return `tomorrow at ${at}`;
  return `${new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(new Date(a.startsAt))} at ${at}`;
}

/** The link: the station page, or the tuned-in page for one airing (which tunes in, or offers a reminder). */
export function shareUrl(origin: string, station: { id: string; callSign: string | null; handle: string | null }, airing?: Pick<AiringX, "logEntryId" | "listedAiringId"> | null): string {
  const slug = stationSlug(station);
  const id = airing?.logEntryId ?? airing?.listedAiringId;
  return id ? `${origin}/watch/${slug}?airing=${encodeURIComponent(id)}` : `${origin}/${station.handle ?? slug}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ShareModal({ stationRef, airingId, onClose, now }: { stationRef: string; airingId: string | null; onClose: () => void; now: Date }) {
  const page = useApiAs("watch", stationsApi.getStation, { params: { stationRef } }, StationPageX);
  const toast = useToast();
  const p = page.data;
  const st = p?.station;
  const airing = p ? (airingId ? [...(p.schedule ?? []), ...p.upNext, ...(p.now ? [p.now] : [])].find((a) => a.logEntryId === airingId || a.listedAiringId === airingId) : null) ?? (airingId ? null : p.now) : null;
  const over = airing ? Date.parse(airing.endsAt) <= now.getTime() : false;
  const [pick, setPick] = useState<"station" | "airing">(airingId ? "airing" : "station");
  const which = airing && !over ? pick : "station";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const ident = st ? identText(st) : "";
  const url = st ? shareUrl(window.location.origin, st, which === "airing" ? airing : null) : "";
  const shown = url.replace(/^https?:\/\//, "");
  const when = airing ? airingWhen(airing, now, MARKET_TZ) : "";
  const cardTitle = which === "airing" && airing ? airing.title : st?.name ?? "";
  const line = which === "airing" && airing ? (when === "on now" ? `On ${ident} now` : `${cap(when)} on ${ident}`) : [ident, st?.homeCity].filter(Boolean).join(", ");
  const live = which === "airing" && airing?.live;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.show({ message: "Link copied" });
    } catch {
      toast.show({ message: "Couldn't copy the link. Select it and copy it instead." });
    }
  };
  const more = () => void navigator.share?.({ title: cardTitle, text: `${cardTitle}, ${line}`, url }).catch(() => {});

  return (
    <Dialog
      open
      onClose={onClose}
      width={440}
      title="Share"
      footer={
        st ? (
          <>
            <Button variant="primary" onClick={() => void copy()}>
              Copy link
            </Button>
            {canShare && <Button onClick={more}>More options</Button>}
          </>
        ) : undefined
      }
    >
      {page.isError ? (
        <p className="vw-pm-msg">{page.error.message}</p>
      ) : !st ? (
        <div className="vw-pm-quiet" aria-busy="true" aria-label="Loading">
          <div />
          <div />
        </div>
      ) : (
        <>
          {airing && !over ? (
            <ChoiceList
              className="vw-share__opts"
              label="What to share"
              value={which}
              onChange={setPick}
              options={[
                { value: "station", title: "The station", helper: `Opens ${ident}, whatever is on` },
                { value: "airing", title: `${airing.title}, ${when}`, helper: "Shown in their own time zone" }
              ]}
            />
          ) : (
            airing && over && <p className="vw-pm-lede">{airing.title} has ended, so this shares the station.</p>
          )}
          <div className="vw-share__card">
            <TitleCard colour={st.colour ?? "#33507A"} title={cardTitle} bottom={ident} decorative />
            <div>
              <b>{cardTitle}</b>
              <small>{line}</small>
              <small>{live ? "Live on Opencast" : "On Opencast"}</small>
            </div>
          </div>
          <div className="vw-share__link">
            <Icon name="link" />
            <span className="oc-mono">{shown}</span>
          </div>
        </>
      )}
    </Dialog>
  );
}
