// Station preview (home 06.1 web, 06.2 phone): `?station=<CALLSIGN>` over any page. Who the
// station is before you tune in: its colour band, now, next and one later (three, no more), what
// it makes that others carry, Tune in and Add to presets. A Modal on the web; a Sheet on the phone,
// where dragging it up opens the station page.

import { useNavigate } from "react-router";
import { stationsApi, type StationIdent } from "@opencast/contracts";
import { Button, ListingRow, StationBand, clock } from "@opencast/ui";
import type { AiringX, DialX } from "../../api/ext";
import { StationPageFull } from "../../api/ext/station";
import { useDial, useMarkets } from "../../data/viewer";
import { useIsPhone } from "../../layout/shell";
import { MARKET_TZ } from "../../../lib/clock";
import { useTune } from "../../player/PlayerRoot";
import { Dialog, useApiAs, useOverlayParams } from "../watch/overlay";
import { PresetButton } from "../watch/usePresetButton";
import { withLive } from "../watch/lines";
import { callSignOf, isOffAir, stationSlug } from "../watch/logic";
import "./StationPreview.css";

/** Now, next and one later: the later one is the next airing of a program (not filler between them). */
export function previewListings(page: Pick<StationPageFull, "now" | "upNext">): { now: AiringX | null; next: AiringX | null; later: AiringX | null; backAt: string | null } {
  const [next = null, ...rest] = page.upNext;
  const later = rest.find((a) => a.programId !== null) ?? rest[0] ?? null;
  // Planned off air (G9) on now reads as off air, back at its sign-on.
  const off = isOffAir(page.now);
  return { now: off ? null : page.now, next, later, backAt: off ? (page.now!.backAt ?? page.now!.endsAt) : null };
}

/** Programs this station makes that other stations carry, with how many: `madeHere` (S7), or the dial's carried-widely list (S2) until it lands. */
export function carriedByOthers(stationId: string, madeHere: StationPageFull["madeHere"], dials: Array<DialX | undefined>): Array<{ programId: string; title: string; carriers: number }> {
  const out: Array<{ programId: string; title: string; carriers: number }> = [];
  for (const m of madeHere ?? []) if (m.carriers > 0) out.push({ programId: m.program.id, title: m.program.title, carriers: m.carriers });
  if (madeHere) return out;
  for (const d of dials)
    for (const c of d?.carriedWidely ?? []) if (c.maker.id === stationId && c.carriers > 0 && !out.some((o) => o.programId === c.program.id)) out.push({ programId: c.program.id, title: c.program.title, carriers: c.carriers });
  return out;
}

/** "Public affairs. On air 6:00 am to 1:00 am. Council Watch is carried by 6 stations." */
export function previewNote(category: string | undefined, hours: string | null | undefined, carried: { title: string; carriers: number } | undefined): string {
  const parts = [category ? `${category}.` : null, hours ? (hours.endsWith(".") ? hours : `${hours}.`) : null, carried ? `${carried.title} is carried by ${carried.carriers} ${carried.carriers === 1 ? "station" : "stations"}.` : null];
  return parts.filter(Boolean).join(" ");
}

function nowDetail(a: AiringX) {
  const until = (
    <>
      until <span className="oc-mono">{clock(a.endsAt, { timeZone: MARKET_TZ })}</span>
    </>
  );
  if (a.live)
    return (
      <>
        {withLive("", true)}, {until}
      </>
    );
  return (
    <>
      Until <span className="oc-mono">{clock(a.endsAt, { timeZone: MARKET_TZ })}</span>
    </>
  );
}

export default function StationPreview() {
  const { params, close } = useOverlayParams();
  const ref = params.get("station");
  // `?station=` is also the replace dialog's and the player modals' station: the preview is `?station=` alone.
  const open = !!ref && !params.get("modal");
  const phone = useIsPhone();
  const navigate = useNavigate();
  const tune = useTune();
  const page = useApiAs("watch", stationsApi.getStation, { params: { stationRef: ref ?? "" } }, StationPageFull, open);
  const markets = useMarkets();
  const tv = useDial("tv");
  const radio = useDial("radio");
  if (!open) return null;

  const onClose = () => close(["station"]);
  const p = page.data;
  const st = p?.station;
  const market = markets.data?.find((m) => m.slug === st?.marketSlug)?.name;
  const place = [st?.homeCity, phone ? null : market].filter(Boolean).join(", ");
  const { now, next, later, backAt } = p ? previewListings(p) : { now: null, next: null, later: null, backAt: null };
  const signOn = backAt ?? next?.startsAt ?? null;
  const carried = st ? carriedByOthers(st.id, p?.madeHere, [tv.data, radio.data]) : [];
  const describe = (a: AiringX) => a.note ?? p?.programs.find((x) => x.id === a.programId)?.description ?? null;
  const laterCarried = later ? carried.find((c) => c.programId === later.programId) : undefined;
  const note = st ? previewNote(st.category, p?.hours, carried[0]) : "";

  const tuneIn = () => {
    if (!st) return;
    void tune(st.id);
    navigate(`/watch/${stationSlug(st)}`);
  };
  const band = st ? (
    <StationBand variant="modal" channel={st.channel ?? ""} callSign={callSignOf(st)} colour={st.colour ?? "#33507A"} name={st.name} place={place || undefined} rounded={phone} onClose={phone ? undefined : onClose} />
  ) : undefined;

  return (
    <Dialog
      open
      onClose={onClose}
      onExpand={st ? () => navigate(`/${st.handle ?? stationSlug(st)}`) : undefined}
      label={st?.name ?? "Station"}
      showClose={!st}
      title={st ? undefined : page.isError ? "Station" : undefined}
      stationBand={band}
      className="vw-preview"
      footer={
        st ? (
          <>
            <Button variant="primary" onClick={tuneIn}>
              Tune in
            </Button>
            <PresetButton station={st as StationIdent} />
          </>
        ) : undefined
      }
    >
      {page.isLoading ? (
        <div className="vw-preview__quiet" aria-busy="true" aria-label="Loading">
          <div />
          <div />
          <div />
        </div>
      ) : page.isError ? (
        <p className="vw-preview__msg">{page.error.message}</p>
      ) : p ? (
        <>
          {now ? (
            <ListingRow variant="line" label="On now" title={now.title} detail={nowDetail(now)} timeZone={MARKET_TZ} />
          ) : (
            <ListingRow variant="line" label="On now" title="Off air" detail={signOn ? <>Signs on at <span className="oc-mono">{clock(signOn, { timeZone: MARKET_TZ })}</span></> : undefined} />
          )}
          {next && <ListingRow variant="line" label="Next" at={next.startsAt} title={next.title} detail={describe(next) ?? undefined} timeZone={MARKET_TZ} />}
          {later && (
            <ListingRow
              variant="line"
              label="Later"
              at={later.startsAt}
              title={later.title}
              detail={(phone && laterCarried ? `Carried by ${laterCarried.carriers} ${laterCarried.carriers === 1 ? "station" : "stations"}` : describe(later)) ?? undefined}
              timeZone={MARKET_TZ}
            />
          )}
          {!phone && note && <p className="vw-preview__note">{note}</p>}
        </>
      ) : null}
    </Dialog>
  );
}
