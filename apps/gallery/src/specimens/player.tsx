import { useEffect, useMemo, useState } from "react";
import { Button, Segmented, money } from "@opencast/ui";
import {
  Banner,
  NumberPanel,
  PlayerProvider,
  PlayerSurface,
  keyboardInput,
  readEntry,
  usePlayer,
  type Channel,
  type EngineOptions,
  type InputAdapter,
  type TuneRecord,
  type WarmMode
} from "@opencast/player";
import { specimens } from "../registry";

void money;
const TV = "tv/opencast-tv.html";
const HOME = "viewer/opencast-home.html";

// ---------- Mock stations (packages/player/mock), with what's on around now ----------

function halfHour(offsetMin = 0): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0);
  return new Date(d.getTime() + offsetMin * 60_000);
}

function row(o: { id: string; callSign: string; channel: string; name: string; colour: string; band?: "tv" | "radio"; title: string; live?: boolean; carriedFrom?: Channel["station"]; next?: string; nextLive?: boolean }): Channel {
  const start = halfHour().toISOString();
  const end = halfHour(30).toISOString();
  const station = { id: o.id, kind: "station" as const, callSign: o.callSign, handle: o.callSign.toLowerCase(), name: o.name, colour: o.colour, band: o.band ?? ("tv" as const), channel: o.channel, marketSlug: "inland-empire", homeCity: "Redlands" };
  return {
    station,
    onAir: true,
    now: { logEntryId: null, title: o.title, episodeTitle: null, code: "PGM", kind: o.live ? "live" : "program", startsAt: start, endsAt: end, live: !!o.live, carriedFrom: o.carriedFrom ?? null, programId: null },
    next: o.next ? { logEntryId: null, title: o.next, episodeTitle: null, code: "PGM", kind: o.nextLive ? "live" : "program", startsAt: end, endsAt: halfHour(90).toISOString(), live: !!o.nextLive, carriedFrom: null, programId: null } : null,
    playback: { kind: "hls", url: `/mock-hls/${o.callSign.toLowerCase()}/master.m3u8` }
  };
}

const REEL = row({ id: "00000000-0000-4000-8000-000000000024", callSign: "REEL", channel: "24.1", name: "Saturday Reel", colour: "#9A5412", title: "Cartoons from 1928 to 1934", next: "Newsreel hour" });
const CIVC = row({ id: "00000000-0000-4000-8000-000000000007", callSign: "CIVC", channel: "7.1", name: "Inland Civic", colour: "#2E6B5A", title: "Town Hall: backyard homes and ADUs", live: true, next: "Planning Commission, Sept 24" });
const BEAT = row({ id: "00000000-0000-4000-8000-000000000012", callSign: "BEAT", channel: "12.1", name: "Inland Beat", colour: "#8C3B7A", title: "Saturday Reel", carriedFrom: REEL.station, next: "Beat Tape Live", nextLive: true });
const NITE = row({ id: "00000000-0000-4000-8000-000000000883", callSign: "NITE", channel: "88.4", name: "Night Desk", colour: "#33507A", band: "radio", title: "Radio dramas from the 1940s", next: "The Hollow Door, part 3" });

const TV_DIAL = [CIVC, BEAT, REEL];
const ALL_DIAL = [CIVC, BEAT, REEL, NITE];
const TZ = undefined; // the device's zone, so the mock schedule reads right wherever it's opened

// ---------- The live demo ----------

function Diagnostics({ history }: { history: TuneRecord[] }) {
  const [s] = usePlayer();
  const name = (id: string | null) => ALL_DIAL.find((c) => c.station.id === id)?.station.callSign ?? "none";
  return (
    <div className="gal-player-diag oc-mono">
      <div>
        On screen: <b>{name(s.currentId)}</b> {s.pendingId && <>, tuning to <b>{name(s.pendingId)}</b></>} · {s.status}
      </div>
      <div>
        Warm: {s.warm.length ? s.warm.map((w) => `${name(w.stationId)} (${w.state})`).join(", ") : "none"}
      </div>
      <ol>
        {history.map((t, i) => (
          <li key={i}>
            {name(t.stationId)}: {t.ms} ms {t.warm ? "from warm" : "cold"}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Controls({ warm, setWarm }: { warm: WarmMode | "none"; setWarm: (w: WarmMode | "none") => void }) {
  const [s, engine] = usePlayer();
  return (
    <div className="gal-col" style={{ gap: 10 }}>
      <div className="gal-row">
        <Button size="sm" icon="down" onClick={() => engine.handle({ type: "channel", dir: "down" })}>Channel down</Button>
        <Button size="sm" icon="up" onClick={() => engine.handle({ type: "channel", dir: "up" })}>Channel up</Button>
        <Button size="sm" onClick={() => engine.handle({ type: "info" })}>Info</Button>
        <Button size="sm" onClick={() => engine.handle({ type: "togglePlay" })}>{s.status === "paused" ? "Play" : "Pause"}</Button>
        <Button size="sm" onClick={() => engine.handle({ type: "last" })}>Last</Button>
        <Button size="sm" set={s.captions === "on"} onClick={() => engine.setCaptions(s.captions === "on" ? "off" : "on")}>Captions</Button>
        <Button size="sm" set={!s.muted} onClick={() => engine.setMuted(!s.muted)}>{s.muted ? "Sound on" : "Mute"}</Button>
      </div>
      <div className="gal-row">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d) => (
          <Button key={d} size="sm" variant="ghost" onClick={() => engine.handle({ type: "digit", digit: d })}>{d}</Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => engine.handle({ type: "dot" })}>.</Button>
        <Button size="sm" variant="primary" onClick={() => engine.handle({ type: "select" })}>OK</Button>
      </div>
      <div className="gal-row">
        <span className="oc-muted" style={{ fontSize: 13 }}>Warm the neighbours</span>
        <Segmented
          label="Warm the neighbours"
          value={warm}
          onChange={(v) => {
            setWarm(v as WarmMode | "none");
            engine.setOptions({ warm: v as WarmMode | "none" });
          }}
          options={[
            { value: "buffer", label: "Buffer near live" },
            { value: "play", label: "Play hidden" },
            { value: "none", label: "Off" }
          ]}
        />
      </div>
    </div>
  );
}

function Tuner({ dial, size, onTune }: { dial: Channel[]; size: "web" | "tv"; onTune: (t: TuneRecord) => void }) {
  const [s, engine] = usePlayer();
  useEffect(() => {
    engine.setChannels(dial);
    engine.setMuted(true);
    void engine.tune(dial[0].station.id);
  }, [engine, dial]);
  useEffect(() => {
    if (s.lastTune) onTune(s.lastTune);
  }, [s.lastTune, onTune]);
  return null;
}

function PlayerDemo({ size, dial }: { size: "web" | "tv"; dial: Channel[] }) {
  const [warm, setWarm] = useState<WarmMode | "none">("buffer");
  const [history, setHistory] = useState<TuneRecord[]>([]);
  const [focusTarget, setFocusTarget] = useState<HTMLElement | null>(null);
  const options = useMemo<EngineOptions>(() => ({ warm: "buffer", neighbours: { skipListed: true } }), []);
  const keys = useMemo(() => (focusTarget ? keyboardInput({ profile: size === "tv" ? "tv" : "web", target: focusTarget }) : null), [focusTarget, size]);
  const inputs = useMemo<InputAdapter[]>(() => (keys ? [keys] : []), [keys]);
  const onTune = useMemo(() => (t: TuneRecord) => setHistory((h) => [t, ...h].slice(0, 8)), []);
  return (
    <PlayerProvider options={options} inputs={inputs}>
      <Tuner dial={dial} size={size} onTune={onTune} />
      <div className={size === "tv" ? "gal-player gal-player--tv" : "gal-player"}>
        <div ref={setFocusTarget} tabIndex={0} className="gal-player__focus" aria-label="Player: press the arrow keys to change channel, digits to tune by number">
          <PlayerSurface size={size} timeZone={TZ} hints={keys?.hints?.()} />
        </div>
        {size === "web" && (
          <div className="gal-player__side">
            <Controls warm={warm} setWarm={setWarm} />
            <Diagnostics history={history} />
          </div>
        )}
      </div>
    </PlayerProvider>
  );
}

// ---------- Static pieces ----------

function StaticPicture({ children, colour }: { children: React.ReactNode; colour: string }) {
  return (
    <div className="oc-player oc-player--web" style={{ background: `linear-gradient(180deg, ${colour}, #0A1124)` }}>
      {children}
    </div>
  );
}

export const player = specimens([
  {
    id: "player",
    name: "Player",
    group: "Player",
    from: [
      { file: TV, anchor: "watching", frames: ["02.1", "02.2"] },
      { file: HOME, anchor: "watch-desk", frames: ["03.1"] }
    ],
    notes:
      "Live: three mock stations served as live HLS (npm run mock:streams -w @opencast/player), 250 ms a request. Tuning joins live, mid-program; the old picture stays until the new one has a frame; the neighbours are warm. Click the picture, then use the arrow keys, 1 to 6, or the buttons. Tune times are measured from the command to the new picture on screen.",
    grounds: ["dark"],
    stacked: true,
    states: [{ label: "Three stations, web", render: () => <PlayerDemo size="web" dial={ALL_DIAL} /> }]
  },
  {
    id: "player-tv",
    name: "Player, TV",
    group: "Player",
    from: [{ file: TV, anchor: "watching", frames: ["02.1", "02.2"] }, { file: TV, anchor: "states", frames: ["05.1"] }],
    notes:
      "The same player at ten feet, driven by the remote's keys (click it, then ▲ ▼, digits and OK; Back is the last channel). The banner is the TV reference's, to the pixel at 1920 by 1080. The radio band is its own dial: 88.4 has no picture, so its frequency and colour fill the screen.",
    grounds: ["tv"],
    frame: { width: 1920, height: 1080 },
    states: [
      { label: "TV band", render: () => <PlayerDemo size="tv" dial={TV_DIAL} /> },
      { label: "Radio band", render: () => <PlayerDemo size="tv" dial={[NITE]} /> }
    ]
  },
  {
    id: "banner",
    name: "Banner",
    group: "Player",
    from: [{ file: TV, anchor: "watching", frames: ["02.1"] }],
    notes: "On every channel change for five seconds (a setting on TV): the ident, what's on with how far in, what's next, the clock and the tally. A progress bar, never a scrub bar. The tally lights only when this screen is really showing the station on air.",
    grounds: ["dark"],
    stacked: true,
    states: [
      { label: "Carried, with a live program next", render: () => <StaticPicture colour="#8C3B7A"><Banner channel={BEAT} size="web" now={new Date()} onAirHere /></StaticPicture> },
      { label: "Live, still tuning (tally unlit)", render: () => <StaticPicture colour="#2E6B5A"><Banner channel={CIVC} size="web" now={new Date()} onAirHere={false} /></StaticPicture> }
    ]
  },
  {
    id: "number-entry",
    name: "Number entry",
    group: "Player",
    from: [{ file: TV, anchor: "watching", frames: ["02.2"] }],
    notes: "Typing 1 then 2 shows 12 with the .1 filled in and the station it will tune to; it tunes after two seconds, or at once on OK. A channel with no station says so and names the nearest two, then the channel stays.",
    grounds: ["dark"],
    stacked: true,
    states: [
      { label: "1, 2: BEAT 12.1", render: () => <StaticPicture colour="#2E6B5A"><NumberPanel entry={readEntry("12", ALL_DIAL)} size="web" /></StaticPicture> },
      { label: "1, 3: no station", render: () => <StaticPicture colour="#2E6B5A"><NumberPanel entry={readEntry("13", ALL_DIAL)} size="web" /></StaticPicture> },
      { label: "8, 8, 4: radio", render: () => <StaticPicture colour="#33507A"><NumberPanel entry={readEntry("884", ALL_DIAL)} size="web" /></StaticPicture> }
    ]
  }
]);
