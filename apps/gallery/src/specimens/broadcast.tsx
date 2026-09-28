import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  BandScale,
  BreakBar,
  BreakLegend,
  Bug,
  Button,
  ChannelPicker,
  channelOptions,
  CodeSelect,
  ColourBars,
  contrastRatio,
  Dial,
  DialRow,
  GuideGrid,
  Ident,
  LevelMeter,
  ListingRow,
  LiveText,
  LogCode,
  LogTimeline,
  LowerThird,
  NowLine,
  PictureFrame,
  PicturePlaceholder,
  PresetKeys,
  ProgramLog,
  ProgressBar,
  RadioPanel,
  ratioLabel,
  Rundown,
  ScheduleList,
  ScrubBar,
  Slate,
  StationBand,
  stationColourPasses,
  Tag,
  Tally,
  TitleCard,
  type GuideStation,
  type LogLine,
  type Preset,
  type RundownItem,
  type ScheduleItem,
  type SelectableCode,
  type TimelineBlock
} from "@opencast/ui";
import { specimens } from "../registry";
import { ScaledFrame } from "../Frame";

const STYLE = "brand/opencast-style.html";
const HOME = "viewer/opencast-home.html";
const PAGES = "viewer/opencast-station-pages.html";
const MC = "control/opencast-master-control.html";
const TV = "tv/opencast-tv.html";
const MARKET = "control/opencast-market.html";
const ORDERS = "business/opencast-production-orders.html";

/* ---------- Mock data: the Inland Empire, Saturday 8:42 pm ---------- */

const TZ = "America/Los_Angeles";
const DAY = Date.parse("2026-09-26T00:00:00-07:00");
/** A time on Saturday September 26 in the market's zone; hours past 24 run into Sunday. */
const at = (h: number, m = 0, s = 0) => new Date(DAY + ((h * 60 + m) * 60 + s) * 1000);
const NOW = at(20, 42, 12);
const MIN = 60_000;
const SEC = 1000;

const S = {
  CIVC: { channel: "7.1", callSign: "CIVC", name: "Inland Civic", colour: "#2E6B5A" },
  RDLS: { channel: "9.1", callSign: "RDLS", name: "Redlands Public Access", colour: "#4F5B2A" },
  BEAT: { channel: "12.1", callSign: "BEAT", name: "Inland Beat", colour: "#8C3B7A" },
  SAZN: { channel: "18.1", callSign: "SAZN", name: "Sazón", colour: "#A3402A" },
  REEL: { channel: "24.1", callSign: "REEL", name: "Saturday Reel", colour: "#9A5412" },
  PREP: { channel: "31.1", callSign: "PREP", name: "Inland Preps", colour: "#1F5E8C" },
  NITE: { channel: "88.3", callSign: "NITE", name: "Night Desk", colour: "#33507A" },
  HALL: { channel: "90.7", callSign: "HALL", name: "Study Hall", colour: "#56508A" },
  CRAT: { channel: "101.9", callSign: "CRAT", name: "Crate", colour: "#7E2F35" },
  VOZE: { channel: "104.3", callSign: "VOZE", name: "La Voz", colour: "#1D6A70" }
};

const LEVELS = [0.4, 0.7, 0.55, 0.92, 0.62, 0.34, 0.74, 0.48, 0.8, 0.38, 0.66, 0.52];
const GUIDE_LEVELS = [0.4, 0.75, 0.55, 0.95, 0.6, 0.3, 0.7, 0.45];

/** Draws its children at a fixed width, as the reference frame does. */
function W({ w, children }: { w: number; children: ReactNode }) {
  return <div style={{ width: w, maxWidth: "100%" }}>{children}</div>;
}

/**
 * Lays its children out at the reference frame's width and scales them to fit the panel, so the
 * compare measures the same layout the reference draws.
 */
function Fit({ w, children }: { w: number; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      const k = Math.min(1, o.clientWidth / w);
      setScale(k);
      setHeight(i.offsetHeight * k);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, [w]);
  return (
    <div ref={outer} style={{ height, overflow: "hidden" }}>
      <div ref={inner} style={{ width: w, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
        {children}
      </div>
    </div>
  );
}

/** TV is always dark: draws its children on the TV ground whatever the panel's ground. */
function TvGround({ children }: { children: ReactNode }) {
  return (
    <div data-ground="tv" style={{ background: "var(--ground)", color: "var(--ink)", padding: 24, borderRadius: "var(--r-control)", width: "100%" }}>
      {children}
    </div>
  );
}

/** Says what the last click did, for the interactive states. */
function Said({ text }: { text: string }) {
  return (
    <p className="oc-quiet" style={{ fontSize: 13, margin: "8px 0 0" }} role="status">
      {text}
    </p>
  );
}

/** A dev-only warning for a station colour white can't be read on. */
function ContrastWarning({ colour }: { colour: string }) {
  if (stationColourPasses(colour)) return null;
  return (
    <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--standby)", fontWeight: 600 }} role="alert">
      Dev warning: white on {colour} reads at {ratioLabel(contrastRatio(colour, "#FFFFFF"))}. Station colours need 4.5:1, so this one can't be saved.
    </p>
  );
}

/* ---------- Interactive demos ---------- */

function DialDemo() {
  const [said, setSaid] = useState("Click a row to tune, or the channel and call sign to open the station preview.");
  return (
    <>
      <Dial header label="Inland Empire, TV band">
        <DialRow
          station={S.CIVC}
          now={{ title: "Town Hall: backyard homes and ADUs", live: true, until: at(21, 30) }}
          next={{ at: at(21, 30), title: "Planning Commission, Sept 24" }}
          at={NOW}
          timeZone={TZ}
          onTune={() => setSaid("Tuned to CIVC 7.1.")}
          onOpenStation={() => setSaid("Opened the CIVC 7.1 station preview.")}
        />
        <DialRow
          station={S.BEAT}
          now={{ title: "Saturday Reel", carriedFrom: "REEL", until: at(21) }}
          next={{ at: at(21), title: "Beat Tape Live", live: true }}
          at={NOW}
          timeZone={TZ}
          onTune={() => setSaid("Tuned to BEAT 12.1.")}
          onOpenStation={() => setSaid("Opened the BEAT 12.1 station preview.")}
        />
      </Dial>
      <Said text={said} />
    </>
  );
}

function BandDemo({ scroll }: { scroll?: boolean }) {
  const [tuned, setTuned] = useState(88.3);
  const stations = [
    { frequency: 88.3, callSign: "NITE", colour: S.NITE.colour },
    { frequency: 90.7, callSign: "HALL", colour: S.HALL.colour },
    { frequency: 101.9, callSign: "CRAT", colour: S.CRAT.colour },
    { frequency: 104.3, callSign: "VOZE", colour: S.VOZE.colour }
  ];
  return (
    <>
      <BandScale stations={stations} tuned={tuned} onTune={setTuned} scroll={scroll} />
      <div style={{ height: scroll ? 0 : 20 }} />
      <Said text={`Tuned to ${tuned.toFixed(1)}. Click a mark, or use the arrow keys on the band.`} />
    </>
  );
}

function PresetDemo({ variant }: { variant: "list" | "strip" }) {
  const [playing, setPlaying] = useState(1);
  return (
    <>
      <PresetKeys keys={PRESETS} playing={playing} variant={variant} onTune={setPlaying} onAdd={() => undefined} />
      <Said text={`Preset ${playing} is playing.`} />
    </>
  );
}

function ChannelDemo() {
  const [value, setValue] = useState("12");
  return (
    <>
      <ChannelPicker options={channelOptions(2, 41, [7, 9, 18, 24, 31, 44])} value={value} onChange={setValue} />
      <Said text={`You'll be ${value}.1.`} />
    </>
  );
}

function CodeDemo() {
  const [codes, setCodes] = useState<SelectableCode[]>(["PGM", "SPT", "UND", "BMP", "SID"]);
  return (
    <div className="gal-row">
      {codes.map((c, i) => (
        <CodeSelect key={i} value={c} onChange={(next) => setCodes((cs) => cs.map((x, j) => (j === i ? next : x)))} />
      ))}
    </div>
  );
}

function ScrubDemo({ kind }: { kind: "market" | "order" }) {
  const market = kind === "market";
  const length = market ? (2 * 3600 + 18 * 60 + 40) * SEC : 15 * SEC;
  const [position, setPosition] = useState(market ? (52 * 60 + 40) * SEC : 6 * SEC);
  const [playing, setPlaying] = useState(market);
  return (
    <ScrubBar
      position={position}
      length={length}
      playing={playing}
      onPlayPause={() => setPlaying((p) => !p)}
      onSeek={setPosition}
      knob={market}
      breaks={market ? [0.21, 0.43, 0.64, 0.86].map((f) => f * length) : []}
      pins={market ? [] : [{ at: 6 * SEC, label: "The logo is small here. Can it be bigger?" }, { at: 12 * SEC, label: "Brunch runs 8 to 1, not 8 to 2." }]}
      step={market ? 30 * SEC : SEC}
    />
  );
}

function GuideDemo({ variant }: { variant: "web" | "phone" }) {
  const [sel, setSel] = useState("beat-live");
  return (
    <GuideGrid
      rows={GUIDE}
      from={at(20)}
      to={at(23)}
      now={NOW}
      timeZone={TZ}
      variant={variant}
      selectedId={sel}
      onSelect={(p) => setSel(p.id)}
      scrollToNow={variant === "phone"}
      label="Tonight"
    />
  );
}

function TimelineDemo() {
  const [sel, setSel] = useState("dead");
  return <LogTimeline blocks={TIMELINE} from={at(18)} to={at(26)} timeZone={TZ} selectedId={sel} onSelect={(b) => setSel(b.id)} maxHeight={430} />;
}

/* ---------- Data for the lists ---------- */

const PRESETS: Array<Preset | null> = [
  { key: 1, ...S.BEAT, now: "Saturday Reel" },
  { key: 2, ...S.CIVC, now: "Town Hall", live: true },
  { key: 3, ...S.NITE, now: "Radio dramas" },
  { key: 4, ...S.REEL, now: "Cartoons, 1928 to 1934" },
  { key: 5, ...S.CRAT, now: "The Producers’ Hour", live: true },
  null
];

const GUIDE: GuideStation[] = [
  {
    id: "civc", ...S.CIVC,
    programs: [
      { id: "civc-th", title: "Town Hall: backyard homes and ADUs", start: at(20), end: at(21, 30), live: true },
      { id: "civc-pc", title: "Planning Commission, Sept 24", start: at(21, 30), end: at(23) }
    ]
  },
  {
    id: "rdls", ...S.RDLS,
    programs: [
      { id: "rdls-cc", title: "City Council, Sept 16", start: at(19), end: at(21, 15), listed: true },
      { id: "rdls-cal", title: "Community calendar", start: at(21, 15), end: at(21, 45) },
      { id: "rdls-cw", title: "Council Watch", start: at(21, 45), end: at(22, 45), carriedFrom: "CIVC" },
      { id: "rdls-sl", title: "Slide loop", start: at(22, 45), end: at(23), detail: "" }
    ]
  },
  {
    id: "beat", ...S.BEAT,
    programs: [
      { id: "beat-lc14", title: "Late Crate, ep. 14", start: at(20), end: at(20, 30) },
      { id: "beat-reel", title: "Saturday Reel", start: at(20, 30), end: at(21), carriedFrom: "REEL" },
      { id: "beat-live", title: "Beat Tape Live", start: at(21), end: at(22), live: true },
      { id: "beat-lc15", title: "Late Crate, ep. 15", start: at(22), end: at(23) }
    ]
  },
  {
    id: "sazn", ...S.SAZN,
    programs: [
      { id: "sazn-t", title: "Tamales for forty", start: at(20), end: at(21) },
      { id: "sazn-o", title: "Orange Street after hours", start: at(21), end: at(22) },
      { id: "sazn-a", title: "Sazón archive", start: at(22), end: at(23) }
    ]
  },
  {
    id: "reel", ...S.REEL,
    programs: [
      { id: "reel-c", title: "Cartoons from 1928 to 1934", start: at(20), end: at(21) },
      { id: "reel-n", title: "Newsreel hour", start: at(21), end: at(22) },
      { id: "reel-c35", title: "Cartoons from 1935", start: at(22), end: at(23) }
    ]
  },
  {
    id: "prep", ...S.PREP,
    programs: [
      { id: "prep-f", title: "Football: Redlands East Valley at Citrus Valley", start: at(19, 30), end: at(22) },
      { id: "prep-s", title: "Friday scoreboard", start: at(22), end: at(22, 30) },
      { id: "prep-h", title: "Highlights", start: at(22, 30), end: at(23) }
    ]
  }
];

const COMPACT_GUIDE: GuideStation[] = [
  {
    id: "civc", ...S.CIVC,
    programs: [
      { id: "c1", title: "Town Hall: backyard homes", start: at(20), end: at(21, 30), live: true, detail: "8:00 – 9:30" },
      { id: "c2", title: "Planning Commission", start: at(21, 30), end: at(22) }
    ]
  },
  {
    id: "beat", ...S.BEAT,
    programs: [
      { id: "b1", title: "Late Crate, ep. 14", start: at(20), end: at(20, 30) },
      { id: "b2", title: "Saturday Reel", start: at(20, 30), end: at(21), detail: "Carried from REEL" },
      { id: "b3", title: "Beat Tape Live", start: at(21), end: at(22), detail: "9:00 – 10:00" }
    ]
  },
  {
    id: "reel", ...S.REEL,
    programs: [
      { id: "r1", title: "Saturday Reel", start: at(20), end: at(21) },
      { id: "r2", title: "Newsreel hour", start: at(21), end: at(22), detail: "9:00 – 10:00" }
    ]
  },
  {
    id: "nite", ...S.NITE,
    programs: [{ id: "n1", title: "Night Desk: radio dramas from the 1940s", start: at(20), end: at(30), detail: "Radio band, until 6:00 am" }]
  }
];

const LOG: LogLine[] = [
  { id: "l1", at: at(20), code: "PGM", title: "Late Crate, ep. 14", source: "From your library", length: 28 * MIN + 30 * SEC },
  { id: "l2", at: at(20, 28, 30), code: "SPT", title: "Orange Street Coffee", source: "Spot market, per view", length: 30 * SEC },
  { id: "l3", at: at(20, 29), code: "SPT", title: "Inland Tire and Wheel", source: "Spot market, flat rate", length: 30 * SEC },
  { id: "l4", at: at(20, 29, 30), code: "UND", title: "Made possible by members of Inland Beat", source: "Underwriting", length: 15 * SEC },
  { id: "l5", at: at(20, 29, 45), code: "BMP", title: "Back to the reel", source: "Bumper", length: 10 * SEC },
  { id: "l6", at: at(20, 29, 55), code: "SID", title: "BEAT 12.1, Redlands", source: "Station ID", length: 5 * SEC },
  { id: "l7", at: at(20, 30), code: "PGM", title: "Saturday Reel", source: "Carried from REEL 24.1, barter terms", length: 30 * MIN }
];

const RUNDOWN: RundownItem[] = [
  { id: "r1", at: at(20, 30), code: "PGM", title: "Saturday Reel, part 1", source: "Carried from REEL 24.1", length: 14 * MIN },
  { id: "r2", at: at(20, 44), code: "SPT", title: "Mission Soda", source: "REEL’s break time, barter", length: 30 * SEC },
  { id: "r3", at: at(20, 44, 30), code: "SPT", title: "Old Town Cinema", source: "REEL’s break time, barter", length: 30 * SEC },
  { id: "r4", at: at(20, 45), code: "SID", title: "BEAT 12.1, Redlands", source: "Station ID", length: 5 * SEC },
  { id: "r5", at: at(20, 45, 5), code: "BMP", title: "Beat Tape Live, trailer", source: "Bumper", length: 10 * SEC },
  { id: "r6", at: at(20, 45, 15), code: "UND", title: "Made possible by members", source: "Underwriting", length: 15 * SEC },
  { id: "r7", at: at(20, 45, 30), code: "OPEN", title: "Open", source: "Holds on the station ID slate", length: 20 * SEC },
  { id: "r8", at: at(20, 45, 50), code: "BMP", title: "Back to the reel", source: "Bumper", length: 10 * SEC },
  { id: "r9", at: at(20, 46), code: "PGM", title: "Saturday Reel, part 2", source: "Carried from REEL 24.1", length: 13 * MIN }
];

const TIMELINE: TimelineBlock[] = [
  { id: "t1", kind: "pgm", start: at(18), end: at(20), title: "Crate Session 02", source: "From your library" },
  { id: "t2", kind: "pgm", start: at(20), end: at(20, 28, 30), title: "Late Crate, ep. 14", source: "From your library" },
  { id: "b1", kind: "brk", start: at(20, 28, 30), end: at(20, 30, 30) },
  { id: "t3", kind: "car", start: at(20, 30, 30), end: at(20, 58, 30), title: "Saturday Reel", source: "Carried from REEL 24.1" },
  { id: "b2", kind: "brk", start: at(20, 58, 30), end: at(21, 0, 30) },
  { id: "t4", kind: "pgm", start: at(21, 0, 30), end: at(21, 58), title: "Beat Tape Live", source: "Live source" },
  { id: "b3", kind: "brk", start: at(21, 58), end: at(22) },
  { id: "t5", kind: "pgm", start: at(22), end: at(22, 28, 30), title: "Late Crate, ep. 15", source: "From your library" },
  { id: "b4", kind: "brk", start: at(22, 28, 30), end: at(22, 30, 30) },
  { id: "t6", kind: "car", start: at(22, 30, 30), end: at(23, 40), title: "Slow Hours", source: "Carried from HALL 90.7" },
  { id: "dead", kind: "dead", start: at(23, 40), end: at(26) }
];

const TONIGHT: ScheduleItem[] = [
  { id: "s1", start: at(20), title: "Late Crate, ep. 14", subtitle: "Beat showcase" },
  { id: "s2", start: at(20, 30), title: "Saturday Reel", subtitle: "Carried from REEL 24.1" },
  { id: "s3", start: at(21), title: "Beat Tape Live", subtitle: <><LiveText />, from the Redlands studio</> },
  { id: "s4", start: at(22), title: "Late Crate, ep. 15", subtitle: "Beat showcase" },
  { id: "s5", start: at(23), end: at(24), title: "Slow Hours", subtitle: "Carried from HALL 90.7" }
];

const WEEK: ScheduleItem[] = [
  { id: "w1", start: at(18), end: at(20), title: "Crate Session 02", subtitle: "From the library" },
  { id: "w2", start: at(20), title: "Late Crate, ep. 14", subtitle: "Beat showcase" },
  { id: "w3", start: at(20, 30), title: "Saturday Reel", subtitle: "Carried from REEL 24.1" },
  { id: "w4", start: at(21), title: "Beat Tape Live", subtitle: <><LiveText /> from the Redlands studio</> },
  { id: "w5", start: at(22), title: "Late Crate, ep. 15", subtitle: "Beat showcase" },
  { id: "w6", start: at(23), title: "Slow Hours", subtitle: "Carried from HALL 90.7" },
  { id: "w7", start: at(24), end: at(26), title: "Late Crate, eps. 12 to 15", subtitle: "Overnight repeat" }
];

/* ---------- Specimens ---------- */

export const broadcast = specimens([
  {
    id: "ident",
    name: "Ident",
    group: "Broadcast",
    from: [
      { file: STYLE, anchor: "components" },
      { file: HOME, anchor: "watch-desk", frames: ["03.1"] },
      { file: HOME, anchor: "watch-phone", frames: ["04.1"] },
      { file: MC, anchor: "flow-p", frames: ["P.1"] },
      { file: MC, anchor: "flow-a", frames: ["A.7"] }
    ],
    notes:
      "Channel number, call sign and name, always in that order. The number is where it sits on the dial; the call sign is who it is. Radio channels are frequencies. The compact forms are the tuned-in rail, the phone player, master control on the phone and the station switcher.",
    states: [
      {
        label: "Style guide: TV and radio",
        render: () => (
          <div className="gal-row" style={{ gap: 40 }}>
            <Ident {...S.CIVC} />
            <Ident {...S.BEAT} />
            <Ident {...S.NITE} />
          </div>
        )
      },
      {
        label: "Block: the tuned-in rail",
        render: () => (
          <W w={295}>
            <Ident {...S.BEAT} name="Inland Beat, Redlands" variant="block" />
          </W>
        )
      },
      {
        label: "Block, small: the phone player",
        render: () => <Ident {...S.BEAT} variant="block-sm" />
      },
      {
        label: "Inline and switch: master control",
        render: () => (
          <div className="gal-row" style={{ gap: 32 }}>
            <Ident {...S.BEAT} variant="inline" />
            <Ident {...S.BEAT} variant="switch" />
            <Ident {...S.CRAT} variant="switch" />
          </div>
        )
      }
    ]
  },
  {
    id: "station-band",
    name: "Station band",
    group: "Broadcast",
    from: [
      { file: HOME, anchor: "m-station", frames: ["06.1", "06.2"] },
      { file: PAGES, anchor: "station", frames: ["01.1"] },
      { file: PAGES, anchor: "phone", frames: ["05.1"] },
      { file: MC, anchor: "flow-a", frames: ["A.1"] }
    ],
    notes:
      "The station's colour with its channel and call sign in white, the way a station's own ID card would look. Buttons on it are white and outline. A station colour must hold 4.5:1 with white; one that doesn't is marked and can't be saved.",
    stacked: true,
    states: [
      {
        label: "Modal: the station preview",
        render: () => (
          <W w={480}>
            <StationBand {...S.CIVC} place="Redlands, Inland Empire" onClose={() => undefined} />
          </W>
        )
      },
      {
        label: "Page: the station page header",
        render: () => (
          <Fit w={1280}>
          <StationBand
            {...S.BEAT}
            variant="page"
            name="Inland Beat. Music from producers around the Inland Empire, on air around the clock."
            actions={
              <>
                <Button variant="on-station">Tune in</Button>
                <Button variant="line-station" icon="check">Preset 1</Button>
                <Button variant="line-station">Pledge</Button>
                <Button variant="line-station" icon="share">Share</Button>
              </>
            }
          />
          </Fit>
        )
      },
      {
        label: "Phone: the station page",
        render: () => (
          <W w={390}>
            <StationBand {...S.BEAT} variant="phone" name="Inland Beat. Music from producers around the Inland Empire." />
          </W>
        )
      },
      {
        label: "Radio band, rounded: the setup preview",
        render: () => (
          <W w={330}>
            <StationBand {...S.NITE} place="Riverside" rounded />
          </W>
        )
      },
      {
        label: "A colour that fails 4.5:1",
        note: "Standby amber fails against white. The band still draws, marked data-contrast=\"fails\", and the specimen shows the dev warning.",
        render: () => (
          <W w={480}>
            <StationBand channel="12.1" callSign="BEAT" colour="#E9A93A" name="Inland Beat" place="Inland Empire" />
            <ContrastWarning colour="#E9A93A" />
          </W>
        )
      }
    ]
  },
  {
    id: "title-card",
    name: "Title card",
    group: "Broadcast",
    from: [
      { file: HOME, anchor: "home-desk", frames: ["01.1"] },
      { file: HOME, anchor: "home-phone", frames: ["02.1"] },
      { file: PAGES, anchor: "program", frames: ["02.1"] },
      { file: MC, anchor: "flow-a", frames: ["A.2"] }
    ],
    notes: "A card in the station's colour standing in for a picture: title at the top, source at the bottom. The small sizes are the ones rows use.",
    states: [
      {
        label: "Large: carried widely",
        render: () => (
          <div className="gal-row" style={{ alignItems: "flex-start" }}>
            <W w={291}>
              <TitleCard colour={S.REEL.colour} title="Saturday Reel" bottom="From REEL 24.1" size="lg" />
            </W>
            <W w={291}>
              <TitleCard colour={S.CRAT.colour} title="The Producers’ Hour" bottom="From CRAT 101.9" size="lg" />
            </W>
          </div>
        )
      },
      {
        label: "Base and dial row",
        render: () => (
          <div className="gal-row" style={{ alignItems: "flex-start" }}>
            <W w={160}>
              <TitleCard colour={S.BEAT.colour} title="Late Crate" bottom="BEAT 12.1" />
            </W>
            <W w={104}>
              <TitleCard colour={S.CIVC.colour} title="Town Hall: backyard homes and ADUs" size="dial" />
            </W>
          </div>
        )
      },
      {
        label: "Row sizes: player, phone row, mini player, library",
        render: () => (
          <div className="gal-row" style={{ alignItems: "flex-start" }}>
            <TitleCard colour={S.BEAT.colour} title="Saturday Reel" size="player" />
            <W w={72}>
              <TitleCard colour={S.CIVC.colour} title="CIVC" size="row" />
            </W>
            <W w={56}>
              <TitleCard colour={S.BEAT.colour} title="Saturday Reel" size="mini" />
            </W>
            <W w={88}>
              <TitleCard colour={S.BEAT.colour} title="Late Crate, ep. 14" size="library" />
            </W>
          </div>
        )
      }
    ]
  },
  {
    id: "picture-frame",
    name: "Picture frame",
    group: "Broadcast",
    from: [
      { file: HOME, anchor: "home-desk", frames: ["01.1"] },
      { file: HOME, anchor: "watch-phone", frames: ["04.1"] },
      { file: STYLE, anchor: "components" },
      { file: MC, anchor: "flow-a", frames: ["A.7"] },
      { file: TV, anchor: "watching", frames: ["02.1"] }
    ],
    notes:
      "The picture is the only box. It takes the picture as children (a video, an image or the drawn placeholder). The bug, bottom right, is whoever is airing it; the lower third names who is speaking. Both are sized in container units, so they scale with the frame. Tags on the picture sit top left.",
    stacked: true,
    states: [
      {
        label: "Home hero: muted preview, lower third, bug",
        note: "No tally: the hero isn't on your screen until you tune in.",
        render: () => (
          <W w={600}>
            <PictureFrame
              bug={{ callSign: "CIVC", channel: "7.1" }}
              lowerThird={{ name: "Dana Whitfield", title: "Chair, Planning Commission" }}
              corner={
                <>
                  <Tag variant="live" onPicture>Live</Tag>
                  <Tag onPicture>Preview, muted</Tag>
                </>
              }
            >
              <PicturePlaceholder />
            </PictureFrame>
          </W>
        )
      },
      {
        label: "Reel title card with the bug",
        render: () => (
          <W w={640}>
            <PictureFrame bug={{ callSign: "BEAT", channel: "12.1" }}>
              <PicturePlaceholder scene="reel" title="Saturday Reel" subtitle="Cartoons, 1928 to 1934" />
            </PictureFrame>
          </W>
        )
      },
      {
        label: "Master control monitor: tally top right",
        render: () => (
          <W w={600}>
            <PictureFrame bug={{ callSign: "BEAT", channel: "12.1" }} topRight={<Tally state="lit" on="picture" flicker={false} />}>
              <PicturePlaceholder scene="reel" title="Saturday Reel" subtitle="Cartoons, 1928 to 1934" />
            </PictureFrame>
          </W>
        )
      },
      {
        label: "Phone, edge to edge",
        render: () => (
          <W w={390}>
            <PictureFrame square bug={{ callSign: "CIVC", channel: "7.1" }} corner={<Tag variant="live" onPicture>Live</Tag>}>
              <PicturePlaceholder />
            </PictureFrame>
          </W>
        )
      },
      {
        label: "Bug and lower third on their own",
        note: "Both place themselves inside any PictureFrame.",
        render: () => (
          <W w={420}>
            <PictureFrame>
              <PicturePlaceholder />
              <LowerThird name="Dana Whitfield" title="Chair, Planning Commission" />
              <Bug callSign="CIVC" channel="7.1" />
            </PictureFrame>
          </W>
        )
      }
    ]
  },
  {
    id: "listing-row",
    name: "Listing row",
    group: "Broadcast",
    from: [
      { file: STYLE, anchor: "components" },
      { file: HOME, anchor: "m-station", frames: ["06.1", "06.2"] }
    ],
    notes:
      "One station: what's on now, how long it runs, and what's next. Carried programs name their source. No star rating or view count. The station preview's lines are now, next and one later, no more.",
    stacked: true,
    states: [
      {
        label: "Listing: live, carried",
        render: () => (
          <Fit w={852}>
            <ListingRow
              station={S.CIVC}
              tags={<Tag variant="live">Live</Tag>}
              title="Town Hall: backyard homes and ADUs"
              meta="Until 9:30 pm, with questions from the room"
              next={{ at: at(21, 30), title: "Planning Commission, regular meeting" }}
              timeZone={TZ}
            />
            <ListingRow
              station={S.REEL}
              title="Saturday Reel: cartoons from 1928 to 1934"
              meta="Carried from REEL by 12 stations"
              next={{ at: at(21), title: "Newsreel hour" }}
              timeZone={TZ}
            />
          </Fit>
        )
      },
      {
        label: "Lines: the station preview",
        render: () => (
          <W w={436}>
            <ListingRow
              variant="line"
              label="On now"
              title="Town Hall: backyard homes and ADUs"
              detail={
                <>
                  <LiveText />, until <span className="oc-mono">9:30 pm</span>
                </>
              }
            />
            <ListingRow variant="line" label="Next" at={at(21, 30)} timeZone={TZ} title="Planning Commission, Sept 24 meeting" detail="Full meeting, unedited" />
            <ListingRow variant="line" label="Later" at={at(23, 30)} timeZone={TZ} title="Council Watch" detail="This week's council meetings across the Inland Empire, in an hour" />
          </W>
        )
      }
    ]
  },
  {
    id: "dial-row",
    name: "Dial row",
    group: "Broadcast",
    from: [
      { file: HOME, anchor: "home-desk", frames: ["01.1"] },
      { file: HOME, anchor: "home-phone", frames: ["02.1", "08.2"] },
      { file: PAGES, anchor: "radio", frames: ["04.1"] },
      { file: PAGES, anchor: "phone", frames: ["05.3"] },
      { file: MC, anchor: "flow-a", frames: ["A.1"] }
    ],
    notes:
      "One row per station in channel order: what's on, when it ends and what's next. A click tunes in; the ident opens the station preview. Live, Listed (dashed), Off air and carried say so in words. On the radio band list, the station you're on carries the tally edge, not a lit sign.",
    stacked: true,
    states: [
      {
        label: "Web: live, listed, carried, off air",
        render: () => (
          <Fit w={1224}>
          <Dial header label="Inland Empire, TV band">
            <DialRow station={S.CIVC} now={{ title: "Town Hall: backyard homes and ADUs", live: true, until: at(21, 30) }} next={{ at: at(21, 30), title: "Planning Commission, Sept 24" }} at={NOW} timeZone={TZ} onTune={() => undefined} onOpenStation={() => undefined} />
            <DialRow station={S.RDLS} now={{ title: "City Council, Sept 16 meeting", listed: true, until: at(21, 15) }} next={{ at: at(21, 15), title: "Community calendar" }} at={NOW} timeZone={TZ} onTune={() => undefined} onOpenStation={() => undefined} />
            <DialRow station={S.BEAT} now={{ title: "Saturday Reel", carriedFrom: "REEL", until: at(21) }} next={{ at: at(21), title: "Beat Tape Live", live: true }} at={NOW} timeZone={TZ} onTune={() => undefined} onOpenStation={() => undefined} />
            <DialRow station={S.SAZN} now={{ title: "Off air", offAir: true, until: at(30) }} next={{ at: at(30), title: "Breakfast at Sazón" }} at={NOW} timeZone={TZ} onTune={() => undefined} onOpenStation={() => undefined} />
          </Dial>
          </Fit>
        )
      },
      {
        label: "Web: click to tune, ident to preview",
        render: () => (
          <Fit w={1224}>
            <DialDemo />
          </Fit>
        )
      },
      {
        label: "Phone rows",
        render: () => (
          <W w={354}>
            <DialRow variant="phone" station={S.CIVC} now={{ title: "Town Hall: backyard homes and ADUs", live: true, until: at(21, 30) }} timeZone={TZ} onTune={() => undefined} onOpenStation={() => undefined} />
            <DialRow variant="phone" station={S.RDLS} now={{ title: "City Council, Sept 16 meeting", listed: true, until: at(21, 15) }} timeZone={TZ} onTune={() => undefined} />
            <DialRow variant="phone" station={S.BEAT} now={{ title: "Saturday Reel", carriedFrom: "REEL", until: at(21) }} timeZone={TZ} onTune={() => undefined} />
            <DialRow variant="phone" station={{ channel: "96.1", callSign: "DUST", colour: "#7E2F35" }} now={{ title: "Desert country, all night", detail: "Radio band" }} timeZone={TZ} onTune={() => undefined} />
            <DialRow variant="phone" station={S.SAZN} now={{ title: "Off air", offAir: true, until: at(30) }} timeZone={TZ} onTune={() => undefined} />
          </W>
        )
      },
      {
        label: "Master control preview: on the dial",
        render: () => (
          <W w={331}>
            <DialRow variant="preview" station={S.BEAT} now={{ title: "Your first program", until: at(21) }} timeZone={TZ} />
          </W>
        )
      },
      {
        label: "Radio block: home",
        render: () => (
          <W w={572}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0 20px", borderTop: "1px solid var(--line)" }}>
              <DialRow variant="radio" station={S.NITE} now={{ title: "Radio dramas from the 1940s" }} onTune={() => undefined} onOpenStation={() => undefined} />
              <DialRow variant="radio" station={S.HALL} now={{ title: "Slow beats for late work" }} onTune={() => undefined} />
              <DialRow variant="radio" station={S.CRAT} now={{ title: "The Producers’ Hour", live: true }} onTune={() => undefined} />
              <DialRow variant="radio" station={S.VOZE} now={{ title: "Noche de oldies" }} onTune={() => undefined} />
            </div>
          </W>
        )
      },
      {
        label: "Radio band list: tally edge on the station you're on",
        note: "The reference lights an ON AIR sign in this row; the rules keep a lit tally to the player, so the row carries the tally edge and says \"You're here\".",
        render: () => (
          <Fit w={1224}>
          <div style={{ borderTop: "1px solid var(--line)" }}>
            <DialRow variant="band" station={S.NITE} now={{ title: "Radio dramas from the 1940s", detail: "Now: The Hollow Door, part 2" }} next={{ at: at(30), title: "Morning desk" }} at={NOW} timeZone={TZ} watching onTune={() => undefined} />
            <DialRow variant="band" station={S.HALL} now={{ title: "Slow beats for late work", detail: "All night" }} next={{ at: at(26), title: "Quiet hours" }} at={NOW} timeZone={TZ} onTune={() => undefined} />
            <DialRow variant="band" station={S.CRAT} now={{ title: "The Producers’ Hour", live: true, detail: <><LiveText /> from Riverside</> }} next={{ at: at(21), title: "Sample Sunday" }} at={NOW} timeZone={TZ} onTune={() => undefined} />
            <DialRow variant="band" station={S.VOZE} now={{ title: "Noche de oldies", detail: "Oldies en español" }} next={{ at: at(24), title: "Madrugada" }} at={NOW} timeZone={TZ} onTune={() => undefined} />
          </div>
          </Fit>
        )
      }
    ]
  },
  {
    id: "guide-grid",
    name: "Guide grid",
    group: "Broadcast",
    from: [
      { file: HOME, anchor: "guide", frames: ["05.1", "05.2"] },
      { file: STYLE, anchor: "components" }
    ],
    notes:
      "Stations down the side, half hours across the top, one line for the current time. Cells span their start and end times; a program that began before the window shows the leading marker. The program on air sits on the raised colour. Live programs say Live in red text; the tally never appears in the guide.",
    stacked: true,
    states: [
      {
        label: "Web: 8:00 to 11:00 pm, now at 8:42",
        note: "Beat Tape Live is selected (its listing is open). Click any cell to select it.",
        render: () => (
          <Fit w={1224}>
            <GuideDemo variant="web" />
          </Fit>
        )
      },
      {
        label: "Phone: narrow station column, opens scrolled to now",
        render: () => (
          <W w={390}>
            <GuideDemo variant="phone" />
          </W>
        )
      },
      {
        label: "Style guide: four half hours",
        render: () => (
          <Fit w={852}>
            <GuideGrid rows={COMPACT_GUIDE} from={at(20)} to={at(22)} now={NOW} timeZone={TZ} variant="compact" label="Guide" />
          </Fit>
        )
      }
    ]
  },
  {
    id: "now-line",
    name: "Now line",
    group: "Broadcast",
    from: [{ file: HOME, anchor: "guide", frames: ["05.1"] }],
    notes: "The line for the current time, placed after the station column at the time's share of the window. The guide draws it; it's here on its own to show the label.",
    states: [
      {
        label: "At 8:42 in an 8:00 to 11:00 window",
        render: () => (
          <div style={{ position: "relative", height: 80, width: "100%", ["--oc-guide-stc" as string]: "150px", borderLeft: "1px solid var(--hair)" }}>
            <NowLine at={NOW} from={at(20)} to={at(23)} timeZone={TZ} />
          </div>
        )
      }
    ]
  },
  {
    id: "log-code",
    name: "Log code",
    group: "Broadcast",
    from: [
      { file: STYLE, anchor: "components" },
      { file: MC, anchor: "flow-a", frames: ["A.2", "A.7"] }
    ],
    notes: "The way traffic logs always have: PGM program, SPT spot, UND underwriting, BMP bumper, SID station ID, and OPEN for unsold time. The code is the signal; colour only backs it up.",
    states: [
      {
        label: "Master control",
        render: () => (
          <div className="gal-row">
            <LogCode code="PGM" />
            <LogCode code="SPT" />
            <LogCode code="UND" />
            <LogCode code="BMP" />
            <LogCode code="SID" />
            <LogCode code="OPEN" />
          </div>
        )
      },
      {
        label: "Style guide size",
        render: () => (
          <div className="gal-row">
            <LogCode code="PGM" size="guide" />
            <LogCode code="SPT" size="guide" />
            <LogCode code="UND" size="guide" />
            <LogCode code="BMP" size="guide" />
            <LogCode code="SID" size="guide" />
          </div>
        )
      }
    ]
  },
  {
    id: "code-select",
    name: "Code select",
    group: "Broadcast",
    from: [{ file: MC, anchor: "flow-a", frames: ["A.2"] }],
    notes: "A library item's log code, picked from the five. It's a real select, drawn in the chosen code's style.",
    states: [{ label: "Each code (change one)", render: () => <CodeDemo /> }]
  },
  {
    id: "program-log",
    name: "Program log",
    group: "Broadcast",
    from: [{ file: STYLE, anchor: "components" }],
    notes: "Master control's running order, to the second. Times and lengths in mono, lengths right-aligned. The line on air carries a tally edge, the only red in master control apart from the sign itself.",
    stacked: true,
    states: [{ label: "The 8:28 break, on air", render: () => (
          <Fit w={852}>
            <ProgramLog lines={LOG} airingId="l2" timeZone={TZ} />
          </Fit>
        ) }]
  },
  {
    id: "log-timeline",
    name: "Log timeline",
    group: "Broadcast",
    from: [{ file: MC, anchor: "flow-a", frames: ["A.4"] }],
    notes:
      "A timeline, not a playlist: each program at its start time, breaks drawn where they'll fall, carried programs dashed, and a gap drawn as dead air, hatched in standby. 1.12px a minute, 6:00 pm to 2:00 am.",
    stacked: true,
    states: [
      {
        label: "Saturday evening, dead air selected",
        note: "Click a block to select it.",
        render: () => (
          <W w={616}>
            <TimelineDemo />
          </W>
        )
      }
    ]
  },
  {
    id: "rundown",
    name: "Rundown",
    group: "Broadcast",
    from: [
      { file: MC, anchor: "flow-a", frames: ["A.7"] },
      { file: MC, anchor: "flow-p", frames: ["P.1"] }
    ],
    notes: "The Monitor's list, to the second: code, item, source, length. The item on air has the tally edge. Unsold time reads OPEN and holds on the station ID slate.",
    stacked: true,
    states: [
      {
        label: "Monitor",
        render: () => (
          <W w={704}>
            <Rundown items={RUNDOWN} nowId="r1" timeZone={TZ} />
          </W>
        )
      },
      {
        label: "Phone",
        render: () => (
          <W w={358}>
            <Rundown items={RUNDOWN.slice(0, 5)} nowId="r1" variant="compact" timeZone={TZ} />
          </W>
        )
      }
    ]
  },
  {
    id: "break-bar",
    name: "Break bar",
    group: "Broadcast",
    from: [{ file: MC, anchor: "flow-c", frames: ["C.1", "C.3"] }],
    notes: "Each break drawn to length: filled, somebody else's under barter (hatched, can't be sold), and open. Newly added spots are amber, the same standby colour as spots in the log.",
    stacked: true,
    states: [
      {
        label: "Breaks tonight",
        render: () => (
          <>
          <W w={220}>
            <div className="gal-col" style={{ alignItems: "stretch" }}>
              <BreakBar parts={[{ kind: "filled", length: 90 * SEC }]} />
              <BreakBar barterOwner="REEL" parts={[{ kind: "barter", length: 60 * SEC }, { kind: "open", length: 60 * SEC }]} />
              <BreakBar parts={[{ kind: "filled", length: 30 * SEC }, { kind: "open", length: 90 * SEC }]} />
            </div>
          </W>
          <W w={1024}>
            <BreakLegend barterOwner="REEL" />
          </W>
          </>
        )
      },
      {
        label: "Filled, just added",
        render: () => (
          <>
          <W w={220}>
            <div className="gal-col" style={{ alignItems: "stretch" }}>
              <BreakBar barterOwner="REEL" parts={[{ kind: "barter", length: 60 * SEC }, { kind: "added", length: 60 * SEC }]} />
              <BreakBar parts={[{ kind: "filled", length: 30 * SEC }, { kind: "added", length: 60 * SEC }, { kind: "open", length: 30 * SEC }]} />
            </div>
          </W>
          <W w={1024}>
            <BreakLegend barterOwner="REEL" kinds={["filled", "added", "barter", "open"]} />
          </W>
          </>
        )
      }
    ]
  },
  {
    id: "schedule-list",
    name: "Schedule list",
    group: "Broadcast",
    from: [
      { file: HOME, anchor: "watch-desk", frames: ["03.1"] },
      { file: HOME, anchor: "watch-phone", frames: ["04.1"] },
      { file: PAGES, anchor: "station", frames: ["01.1"] },
      { file: PAGES, anchor: "phone", frames: ["05.1"] }
    ],
    notes: "A station's schedule. Past rows fade, the program on now has the tally edge, and on the station page later rows offer a reminder.",
    stacked: true,
    states: [
      {
        label: "Tonight: the tuned-in rail",
        render: () => (
          <W w={295}>
            <ScheduleList items={TONIGHT} now={NOW} heading="On BEAT tonight" timeZone={TZ} />
          </W>
        )
      },
      {
        label: "Week: the station page",
        render: () => (
          <W w={852}>
            <ScheduleList items={WEEK} now={NOW} variant="week" onRemind={() => undefined} timeZone={TZ} />
          </W>
        )
      },
      {
        label: "Week: the phone",
        render: () => (
          <W w={358}>
            <ScheduleList items={WEEK.slice(2)} now={NOW} variant="week-phone" timeZone={TZ} />
          </W>
        )
      }
    ]
  },
  {
    id: "progress-bar",
    name: "Progress bar",
    group: "Broadcast",
    from: [
      { file: TV, anchor: "watching", frames: ["02.1"] },
      { file: "tv/opencast-tv-update.html", anchor: "phone" },
      { file: PAGES, anchor: "station", frames: ["01.1"] }
    ],
    notes: "Start and end at each end and the time left. A broadcast has no seeking, so this is never a scrub bar.",
    stacked: true,
    states: [
      {
        label: "Small: the phone remote",
        note: "The remote draws the bar without the time left.",
        render: () => (
          <W w={273}>
            <ProgressBar start={at(20)} end={at(21, 30)} now={NOW} timeZone={TZ} showLeft={false} />
          </W>
        )
      },
      {
        label: "TV banner",
        note: "TV is always dark, so this draws on the TV ground in both panels.",
        render: () => (
          <TvGround>
            <W w={920}>
              <ProgressBar start={at(20, 30)} end={at(21)} now={NOW} timeZone={TZ} size="tv" />
            </W>
          </TvGround>
        )
      },
      {
        label: "Text: the station page",
        render: () => <ProgressBar start={at(20, 30)} end={at(21)} now={NOW} timeZone={TZ} size="text" />
      }
    ]
  },
  {
    id: "scrub-bar",
    name: "Scrub bar",
    group: "Broadcast",
    from: [
      { file: MARKET, anchor: "preview", frames: ["03.1"] },
      { file: ORDERS, anchor: "review", frames: ["05.1"] }
    ],
    notes: "Only for checking something, never for watching: the syndication market's episode preview (break marks in amber) and the production-order review (notes pinned to a moment). Drag, click, or use the arrow keys.",
    stacked: true,
    states: [
      {
        label: "Market preview: break marks",
        render: () => (
          <W w={736}>
            <ScrubDemo kind="market" />
          </W>
        )
      },
      {
        label: "Order review: pinned notes",
        render: () => (
          <W w={560}>
            <ScrubDemo kind="order" />
          </W>
        )
      }
    ]
  },
  {
    id: "band-scale",
    name: "Band scale",
    group: "Broadcast",
    from: [
      { file: PAGES, anchor: "radio", frames: ["04.1"] },
      { file: PAGES, anchor: "phone", frames: ["05.3"] }
    ],
    notes: "The radio band, 88 to 108, with each station's mark and the needle on the one you're tuned to. Clicking a mark tunes; the arrow keys move along the band. On the phone it scrolls sideways, keeping the needle in view.",
    stacked: true,
    states: [
      {
        label: "Web",
        render: () => (
          <Fit w={1224}>
            <BandDemo />
          </Fit>
        )
      },
      {
        label: "Phone: scrolls, needle in view",
        render: () => (
          <W w={390}>
            <BandDemo scroll />
          </W>
        )
      }
    ]
  },
  {
    id: "level-meter",
    name: "Level meter",
    group: "Broadcast",
    from: [
      { file: STYLE, anchor: "states" },
      { file: HOME, anchor: "watch-phone", frames: ["04.2"] },
      { file: TV, anchor: "states", frames: ["05.1"] }
    ],
    notes: "The meter moves with the sound; it's decorative, so screen readers skip it.",
    states: [
      {
        label: "On a screen",
        render: () => (
          <div className="gal-screen" style={{ width: "100%" }}>
            <LevelMeter levels={GUIDE_LEVELS} />
          </div>
        )
      },
      {
        label: "On a station colour",
        render: () => (
          <div style={{ background: S.NITE.colour, padding: 16, borderRadius: "var(--r-control)", width: 346 }}>
            <LevelMeter levels={LEVELS} size="md" on="station" />
          </div>
        )
      },
      {
        label: "TV",
        render: () => (
          <div className="gal-row" style={{ background: S.NITE.colour, padding: 16, borderRadius: "var(--r-control)", width: "100%" }}>
            <LevelMeter levels={LEVELS} size="tv" on="station" />
          </div>
        )
      }
    ]
  },
  {
    id: "preset-keys",
    name: "Preset keys",
    group: "Broadcast",
    from: [
      { file: HOME, anchor: "home-desk", frames: ["01.1"] },
      { file: HOME, anchor: "home-phone", frames: ["02.1"] },
      { file: HOME, anchor: "first", frames: ["08.2"] }
    ],
    notes:
      "Keys 1 to 6, like a car radio. The one playing is in ink. An empty key is dashed. A new viewer sees six dashed keys and \"Tune in to a station and press Add to presets.\"; the layout doesn't change when they fill.",
    states: [
      {
        label: "Web list",
        render: () => (
          <W w={272}>
            <PresetDemo variant="list" />
          </W>
        )
      },
      {
        label: "Web list, none saved",
        render: () => (
          <W w={272}>
            <PresetKeys keys={[]} />
          </W>
        )
      },
      {
        label: "Phone strip",
        render: () => (
          <W w={354}>
            <PresetDemo variant="strip" />
          </W>
        )
      },
      {
        label: "Phone strip, none saved",
        render: () => (
          <W w={354}>
            <PresetKeys keys={[]} variant="strip" onAdd={() => undefined} />
          </W>
        )
      }
    ]
  },
  {
    id: "radio-panel",
    name: "Radio panel",
    group: "Broadcast",
    from: [{ file: HOME, anchor: "watch-phone", frames: ["04.2"] }],
    notes: "The phone's full player on the radio band: the station colour fills, the frequency is the picture, the meter moves with the sound. This is the player, so its tally lights.",
    states: [
      {
        label: "NITE 88.3, playing",
        render: () => (
          <W w={354}>
            <RadioPanel {...S.NITE} frequency="88.3" name="Night Desk, Riverside" levels={LEVELS} />
          </W>
        )
      },
      {
        label: "Paused",
        render: () => (
          <W w={354}>
            <RadioPanel {...S.CRAT} frequency="101.9" name="Crate, Riverside" tally="unlit" levels={LEVELS.map(() => 0.08)} />
          </W>
        )
      }
    ]
  },
  {
    id: "slate",
    name: "Slate",
    group: "Broadcast",
    from: [
      { file: STYLE, anchor: "states" },
      { file: TV, anchor: "states", frames: ["05.2"] },
      { file: MC, anchor: "flow-p", frames: ["P.2"] }
    ],
    notes:
      "Screens without a picture. Stand by is a message, not an apology: say what's happening and when it will change. The colour bars are the only decoration any state gets. Dead air is master control only; the station is still on air, so the tally stays lit.",
    stacked: true,
    states: [
      {
        label: "Stand by",
        render: () => (
          <W w={564}>
            <Slate kind="standby">The signal from BEAT 12.1 dropped. Reconnecting, and we'll pick up where the program is now.</Slate>
          </W>
        )
      },
      {
        label: "Off air",
        render: () => (
          <W w={564}>
            <Slate kind="off-air">
              CIVC 7.1 signs on again at <span className="oc-mono">6:00 am</span>. In the meantime, REEL 24.1 is on.
            </Slate>
          </W>
        )
      },
      {
        label: "Dead air warning",
        render: () => (
          <W w={564}>
            <Slate kind="dead-air" deadAirAt={at(23, 40)} now={at(23, 28)}>
              Your log runs out at <span className="oc-mono">11:40 pm</span>. Add programs or carry something from the syndication market.
            </Slate>
          </W>
        )
      },
      {
        label: "Radio band",
        render: () => (
          <W w={564}>
            <Slate kind="radio" frequency="88.3" callSign="NITE" name="Night Desk" levels={GUIDE_LEVELS}>
              Radio dramas from the 1940s, until <span className="oc-mono">6:00 am</span>
            </Slate>
          </W>
        )
      },
      {
        label: "TV: off air, with a way out",
        note: "Drawn at 1920 by 1080 on the TV ground and scaled to fit.",
        render: () => (
          <ScaledFrame width={1920} height={1080}>
            <div data-ground="tv" style={{ position: "relative", width: 1920, height: 1080 }}>
            <Slate
              kind="off-air"
              size="tv"
              actions={
                <>
                  <Button variant="primary" size="lg">Tune to REEL 24.1</Button>
                  <Button size="lg">Open the guide</Button>
                </>
              }
            >
              CIVC 7.1 signs on again at <span className="oc-mono">6:00 am</span>. REEL 24.1 is on now.
            </Slate>
            </div>
          </ScaledFrame>
        )
      }
    ]
  },
  {
    id: "colour-bars",
    name: "Colour bars",
    group: "Broadcast",
    from: [{ file: STYLE, anchor: "states" }],
    notes: "Six bars from the --bar tokens. Stand by is the only state that gets them.",
    states: [
      {
        label: "Bars",
        render: () => (
          <div style={{ width: "100%", height: 40, display: "grid" }}>
            <ColourBars />
          </div>
        )
      }
    ]
  },
  {
    id: "channel-picker",
    name: "Channel picker",
    group: "Broadcast",
    from: [{ file: MC, anchor: "flow-a", frames: ["A.1"] }],
    notes: "The open channels in a market; taken ones are struck through and can't be chosen. A radio group: arrow keys move between free channels, skipping taken ones.",
    stacked: true,
    states: [
      {
        label: "Inland Empire, 2 to 41, 12 chosen",
        render: () => (
          <W w={636}>
            <ChannelDemo />
          </W>
        )
      }
    ]
  }
]);
