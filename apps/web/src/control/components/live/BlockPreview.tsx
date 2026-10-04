// A246 (Phase 4, opencast-schedule 07, decision 16): a block's look as viewers see it, drawn with
// the player's own parts so it can't drift from them: the picture with the bug (`Overlays`), the
// banner on a channel change (`Banner`: "LATE CRATE NIGHTS · Beat Tape Live", ON AIR), and the
// guide's band (`GuideGrid`, one row: the block over its programs). It follows the page's draft
// (colour, logo, what the bug shows) as it's changed. The program is the block's next real airing;
// with none, a sample program, labelled as one. In the player the banner covers the bug while it's
// up, so here they're drawn apart: the picture, then the banner under it.

import type { StationIdent, StationSetup } from "@opencast/contracts";
import { Banner, Overlays, type Channel, type OnScreen } from "@opencast/player";
import { GuideGrid } from "@opencast/ui";
import { STATION_TZ } from "../../../lib/clock";
import { initials } from "./blockAirs";

const MIN = 60_000;
const HALF = 30 * MIN;
const t = (s: string) => Date.parse(s);
const iso = (n: number) => new Date(n).toISOString();

export interface PreviewProgram {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

export interface BlockPreviewProps {
  block: { id: string; name: string; colour: string | null; logoUrl: string | null; bug: "station" | "logo" | "off" };
  station: StationIdent;
  /** The station's own bug (its setup), for "BEAT's". */
  stationBug: Pick<StationSetup, "bug" | "logoUrl"> | null;
  /** The next airing's programs, in order; empty: a sample. */
  programs: PreviewProgram[];
  /** The block isn't on the log yet: the programs are a sample, and say so. */
  sample: boolean;
  /** Now, for the banner's progress: the program on now, else a third of the way into the first. */
  now: number;
}

/** What the bug shows during the block, as the player gets it (HlsBug): its logo, the station's, or nothing. */
export function previewBug(block: BlockPreviewProps["block"], station: StationIdent, stationBug: BlockPreviewProps["stationBug"]): OnScreen["bug"] {
  if (block.bug === "off") return null;
  // Where the station's bug sits, and how strong (its setup), whatever it shows.
  const position = (stationBug?.bug.position ?? "bottom_right") as NonNullable<OnScreen["bug"]>["position"];
  const base = { id: "preview", callSign: station.callSign ?? null, channel: station.channel ?? null, position, opacity: stationBug?.bug.opacity ?? 78, blockId: null };
  if (block.bug === "logo" && block.logoUrl) return { ...base, mode: "logo", logoUrl: block.logoUrl, blockId: block.id };
  if (!stationBug || stationBug.bug.mode === "off") return null;
  if (stationBug.bug.mode === "logo" && stationBug.logoUrl) return { ...base, mode: "logo", logoUrl: stationBug.logoUrl };
  return { ...base, mode: "call_sign_and_channel", logoUrl: null };
}

export function BlockPreview({ block, station, stationBug, programs, sample, now }: BlockPreviewProps) {
  // A sample: tonight at 9:00 pm for an hour, as the reference's block starts.
  const shown: PreviewProgram[] = programs.length
    ? programs
    : (() => {
        const start = Math.ceil(now / HALF) * HALF + 2 * HALF;
        return [{ id: "sample", title: "Your program", startsAt: iso(start), endsAt: iso(start + 60 * MIN) }];
      })();
  const on = shown.find((p) => t(p.startsAt) <= now && now < t(p.endsAt)) ?? shown[0];
  const at = t(on.startsAt) <= now && now < t(on.endsAt) ? now : t(on.startsAt) + (t(on.endsAt) - t(on.startsAt)) / 3;
  const colour = block.colour ?? "var(--ink-70)";
  const airing = { logEntryId: null, title: on.title, episodeTitle: null, code: "PGM" as const, kind: "program" as const, startsAt: on.startsAt, endsAt: on.endsAt, live: false, carriedFrom: null, programId: null, block: { id: block.id, name: block.name, colour: block.colour } };
  const channel: Channel = { station, onAir: true, now: airing, next: null, playback: null };
  const bug = previewBug(block, station, stationBug);
  const onScreen: OnScreen = { item: null, inBreak: null, live: null, bug, lowerThird: null, code: null, upNext: null };
  const from = Math.floor(t(shown[0].startsAt) / HALF) * HALF;
  const to = Math.max(from + 2 * HALF, Math.ceil(t(shown[shown.length - 1].endsAt) / HALF) * HALF);

  return (
    <figure className="cc-blkprev" aria-label={`How ${block.name} looks on air${sample ? ", with a sample program" : ""}`}>
      {sample && <p className="cc-blkprev__sample">A sample program: {block.name} isn't on the log yet.</p>}
      <div className="oc-player oc-player--web cc-blkprev__pic" style={{ "--cc-blk": colour } as never}>
        <span className="cc-blkprev__ttl" aria-hidden="true">
          {on.title}
        </span>
        <Overlays channel={channel} size="web" onScreen={onScreen} showing banner={false} timeZone={STATION_TZ} />
        {!bug && block.bug === "off" && <span className="oc-sr-only">No bug during the block.</span>}
      </div>
      <div className="oc-player oc-player--web cc-blkprev__banner">
        <Banner channel={channel} size="web" now={new Date(at)} timeZone={STATION_TZ} onAirHere />
      </div>
      <GuideGrid
        className="cc-blkprev__guide"
        label={`${block.name} in the guide`}
        rows={[{ id: station.id, channel: station.channel ?? "", callSign: station.callSign ?? initials(station.name), programs: shown.map((p) => ({ id: p.id, title: p.title, start: p.startsAt, end: p.endsAt })), blocks: [{ id: block.id, name: block.name, start: shown[0].startsAt, end: shown[shown.length - 1].endsAt, colour: block.colour }] }]}
        from={iso(from)}
        to={iso(to)}
        timeZone={STATION_TZ}
      />
    </figure>
  );
}
