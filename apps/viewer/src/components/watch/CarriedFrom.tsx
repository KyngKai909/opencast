// Carried from (home 07.1): `?modal=carried&program=<id>`. Answers "why is this here?": who makes
// the program, how many stations carry it, and where it airs in your market with times. The
// primary action is tuning to the station that makes it.

import { useNavigate } from "react-router";
import { libraryApi, type StationIdent } from "@opencast/contracts";
import { Button, clock } from "@opencast/ui";
import { ProgramPageX } from "../../api/ext/station";
import { useChannels, useDial, useMarketSlug } from "../../data/viewer";
import { MARKET_TZ } from "../../lib/clock";
import { useNowPlaying, useTune } from "../../player/PlayerRoot";
import { Dialog, useApiAs } from "./overlay";
import { PresetButton } from "./usePresetButton";
import { callSignOf, identText, stationSlug, zoned } from "./logic";

export interface MarketAiring {
  key: string;
  station: StationIdent;
  /** "Saturdays at 8:30 pm" (L3), when the API says. */
  slot: string | null;
  startsAt: string;
}

/**
 * Where it airs in the market, one row per station in channel order, with the airing on now or
 * next: from `whereToWatch` (L3), or from the contract's `upcoming` until that lands.
 */
export function marketAirings(p: Pick<ProgramPageX, "whereToWatch" | "upcoming">, marketSlug: string | null): MarketAiring[] {
  const out: MarketAiring[] = [];
  if (p.whereToWatch?.length) {
    for (const w of p.whereToWatch) {
      const a = w.now ?? w.next;
      if (a) out.push({ key: w.station.id, station: w.station, slot: w.slot, startsAt: a.startsAt });
    }
  } else {
    for (const u of [...p.upcoming].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
      if (marketSlug && u.station.marketSlug !== marketSlug) continue;
      if (!out.some((o) => o.station.id === u.station.id)) out.push({ key: u.logEntryId, station: u.station, slot: null, startsAt: u.startsAt });
    }
  }
  const order = (s: StationIdent) => {
    const [a, b] = (s.channel ?? "9999.9").split(".").map(Number);
    return (a ?? 0) * 100 + (b ?? 0);
  };
  return out.sort((x, y) => order(x.station) - order(y.station));
}

/** "8:30 pm" tonight, "Sun 9:00 am" on another day. */
export function whenText(startsAt: string, now: Date, timeZone: string): string {
  const a = zoned(new Date(startsAt), timeZone);
  const n = zoned(now, timeZone);
  const t = clock(startsAt, { timeZone });
  if (a.y === n.y && a.m === n.m && a.d === n.d) return t;
  return `${new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date(startsAt))} ${t}`;
}

export function CarriedFrom({ programId, onClose, now }: { programId: string; onClose: () => void; now: Date }) {
  const slug = useMarketSlug();
  const program = useApiAs("watch", libraryApi.getProgram, { params: { programId }, query: { market: slug } }, ProgramPageX);
  const np = useNowPlaying();
  const channels = useChannels();
  const tv = useDial("tv");
  const radio = useDial("radio");
  const tune = useTune();
  const navigate = useNavigate();
  const p = program.data;
  const maker = p?.station;
  const here = np.row?.station ?? null;
  // L2 when it lands; until then the dial's carried-widely count (S2).
  const carriers = p?.carriers?.total ?? [...(tv.data?.carriedWidely ?? []), ...(radio.data?.carriedWidely ?? [])].find((c) => c.program.id === programId)?.carriers;
  const rows = p ? marketAirings(p, slug) : [];
  const makerOnDial = maker ? channels.find((c) => c.station.id === maker.id) : undefined;

  const tuneToMaker = () => {
    if (!maker) return;
    onClose();
    if (makerOnDial) {
      void tune(maker.id);
      navigate(`/watch/${stationSlug(maker)}`);
    } else navigate(`/${maker.handle ?? stationSlug(maker)}`);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      width={440}
      eyebrow={here ? `You're watching it on ${identText(here)}` : undefined}
      title={p && maker ? `${p.title} is made by ${identText(maker)}` : undefined}
      label="Carried from"
      footer={
        maker ? (
          <>
            <Button variant="primary" onClick={tuneToMaker}>
              Tune in to {callSignOf(maker)}
            </Button>
            <PresetButton station={maker} addLabel={`Add ${callSignOf(maker)} to presets`} />
          </>
        ) : undefined
      }
    >
      {program.isLoading ? (
        <div className="vw-pm-quiet" aria-busy="true" aria-label="Loading">
          <div />
          <div />
          <div />
        </div>
      ) : program.isError ? (
        <p className="vw-pm-msg">{program.error.message}</p>
      ) : (
        <>
          <p className="vw-pm-lede">{carriers ? `${carriers} ${carriers === 1 ? "station carries" : "stations carry"} it. In your market:` : "In your market:"}</p>
          {rows.length ? (
            <div className="vw-carriers" role="list">
              {rows.map((u) => (
                <div key={u.key} className="vw-carriers__row" role="listitem">
                  <span className="vw-carriers__ch oc-ch">{u.station.channel}</span>
                  <div>
                    <span className="oc-cs vw-carriers__cs">{callSignOf(u.station)}</span>
                    <small>{u.station.id === here?.id ? "You're here" : u.slot ?? u.station.name}</small>
                  </div>
                  <span className="vw-carriers__at oc-mono">{whenText(u.startsAt, now, MARKET_TZ)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="vw-pm-msg">No station in your market has it on the schedule.</p>
          )}
        </>
      )}
    </Dialog>
  );
}
