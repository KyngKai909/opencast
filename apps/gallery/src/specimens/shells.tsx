import { useState, type CSSProperties, type ReactNode } from "react";
import {
  BusinessSetupShell,
  BusinessShell,
  ControlFoot,
  ControlPhoneShell,
  ControlSetupShell,
  ControlShell,
  ControlTitle,
  DeskShell,
  MiniPlayer,
  PhoneBackBar,
  PlayerBar,
  SettingsLayout,
  ShellRail,
  ShellSteps,
  StudioShell,
  TvShell,
  ViewerPhoneShell,
  ViewerWebShell,
  Button,
  Tag,
  Tally,
  buildRail,
  money,
  CONTROL_RAIL,
  CONTROL_SETUP_STEPS,
  type ControlPage,
  type ShellItems
} from "@opencast/ui";
import { specimens } from "../registry";

const HOME = "viewer/opencast-home.html";
const YOU = "viewer/opencast-you.html";
const PAGES = "viewer/opencast-station-pages.html";
const MC = "control/opencast-master-control.html";
const LIVE = "control/opencast-live-listings.html";
const MARKET = "control/opencast-market.html";
const SET = "control/opencast-station-settings.html";
const FUND = "business/opencast-biz-funding.html";
const SPOTS = "business/opencast-biz-spots.html";
const BIZSET = "business/opencast-biz-settings.html";
const DESK = "desk/opencast-network-desk.html";
const TV = "tv/opencast-tv.html";
const TVU = "tv/opencast-tv-update.html";

// 8:42:12 pm, Saturday, in the Inland Empire.
const AT = "2026-09-27T03:42:12Z";
const TZ = "America/Los_Angeles";
const BEAT = { channel: "12.1", callSign: "BEAT", colour: "#8C3B7A" };
const CIVC = { channel: "7.1", callSign: "CIVC" };
const KAI = { initials: "KM", name: "Kai M.", href: "#you" };
const OSC = { name: "Orange Street Coffee", initials: "OSC", colour: "#6B4A2B" };
const MARKET_IE = { name: "Inland Empire" };
const go = (id: string) => `#${id}`;

/* ---------- Gallery-only helpers ---------- */

/** Draws a phone around a phone shell, for the gallery only: the status bar and home indicator are the phone's, not the app's. */
function DeviceFrame({ children, time = "8:42" }: { children: ReactNode; time?: string }) {
  const phone: CSSProperties = {
    width: 390,
    height: 844,
    margin: 8,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: 46,
    background: "var(--ground)",
    color: "var(--ink)",
    boxShadow: "0 0 0 1px var(--line), 0 0 0 7px var(--raised), 0 0 0 8px var(--line)"
  };
  return (
    <div style={phone}>
      <div style={{ height: 48, flex: "none", display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "0 30px 8px", font: "600 15px var(--font-text)" }} aria-hidden="true">
        <span>{time}</span>
        <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <i style={{ width: 17, height: 10, border: "1.5px solid currentColor", borderRadius: 3, display: "block" }} />
          <b style={{ width: 4, height: 10, background: "currentColor", borderRadius: 1, display: "block" }} />
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
      <div style={{ height: 22, flex: "none", display: "grid", placeItems: "center" }} aria-hidden="true">
        <i style={{ width: 134, height: 5, borderRadius: 3, background: "var(--ink)", opacity: 0.8 }} />
      </div>
    </div>
  );
}

/** Placeholder page content: a heading and ruled rows. */
function Filler({ title, rows = 5, lede }: { title?: string; rows?: number; lede?: string }) {
  return (
    <div>
      {title && <h2 style={{ margin: "0 0 4px", font: "700 20px/1.2 var(--font-display)", letterSpacing: "-.015em" }}>{title}</h2>}
      {lede && <p className="oc-muted" style={{ margin: "0 0 12px", fontSize: 14 }}>{lede}</p>}
      <div style={{ borderTop: "1px solid var(--line)" }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ padding: "12px 0", borderBottom: "1px solid var(--hair)", color: "var(--ink-50)", fontSize: 14 }}>
            Page content {i + 1}
          </div>
        ))}
      </div>
    </div>
  );
}

const beatPlayer = (playing = true, extras = false) => (
  <PlayerBar
    title="Saturday Reel"
    station="BEAT 12.1, carried from REEL"
    colour={BEAT.colour}
    playing={playing}
    onChannelDown={() => {}}
    onChannelUp={() => {}}
    onTogglePlay={() => {}}
    {...(extras ? { onVolume: () => {}, onOpen: () => {} } : {})}
  />
);

const beatMini = (playing = true) => <MiniPlayer title="Saturday Reel" station="BEAT 12.1" colour={BEAT.colour} playing={playing} onTogglePlay={() => {}} />;

/** Toggles pause, to show the tally going out and coming back with its switch-on. */
function PlayerDemo({ mini }: { mini?: boolean }) {
  const [playing, setPlaying] = useState(true);
  const toggle = () => setPlaying((p) => !p);
  return mini ? (
    <div style={{ width: 390 }}>
      <MiniPlayer title="Saturday Reel" station="BEAT 12.1" colour={BEAT.colour} playing={playing} onTogglePlay={toggle} />
    </div>
  ) : (
    <PlayerBar title="Saturday Reel" station="BEAT 12.1, carried from REEL" colour={BEAT.colour} playing={playing} onTogglePlay={toggle} onChannelDown={() => {}} onChannelUp={() => {}} />
  );
}

const monitorItems: ShellItems<ControlPage> = {
  breaks: { count: "3:30", warn: true, countLabel: "of breaks unfilled" },
  library: { count: 7 },
  translators: { count: 1 }
};

const HOST_REASON = "Hosts see only their live blocks";
const hostItems: ShellItems<ControlPage> = Object.fromEntries(
  CONTROL_RAIL.flatMap((g) => g.items.map((i) => i.id))
    .filter((id) => id !== "live-sources")
    .map((id) => [id, { disabled: HOST_REASON }])
) as ShellItems<ControlPage>;

const STATION_SECTIONS = [
  { id: "identity", label: "Identity" },
  { id: "breaks", label: "Breaks" },
  { id: "sponsorship", label: "Sponsorship" },
  { id: "translators", label: "Translators" },
  { id: "team", label: "Team" },
  { id: "notifications", label: "Notifications" },
  { id: "account", label: "Station account" },
  { id: "ownership", label: "Ownership", danger: true }
].map((s) => ({ ...s, href: go(s.id) }));

const BIZ_SECTIONS = [
  { id: "business", label: "Business" },
  { id: "team", label: "Team" },
  { id: "money", label: "Money and receipts" },
  { id: "notifications", label: "Notifications" },
  { id: "connections", label: "Connections" },
  { id: "close", label: "Close account", danger: true }
].map((s) => ({ ...s, href: go(s.id) }));

const VIEWER_SECTIONS = [
  { id: "account", label: "Account" },
  { id: "market", label: "Market" },
  { id: "watching", label: "Watching" },
  { id: "notifications", label: "Notifications" },
  { id: "tvs", label: "TVs and casting" },
  { id: "appearance", label: "Appearance" },
  { id: "privacy", label: "Privacy" },
  { id: "data", label: "Your data" }
].map((s) => ({ ...s, href: go(s.id) }));

/** A stand-in picture for the TV canvas. */
function TvPicture() {
  return (
    <div style={{ position: "absolute", inset: 0, background: "var(--screen)", display: "grid", placeItems: "center", textAlign: "center" }}>
      <div>
        <b style={{ display: "block", font: "800 150px/1 var(--font-display)", fontStretch: "125%", letterSpacing: "-.03em", color: "var(--pic-ink)" }}>Saturday Reel</b>
        <span style={{ display: "block", font: "500 34px var(--font-mono)", color: "var(--pic-ink-70)", marginTop: ".6em" }}>Cartoons, 1928 to 1934</span>
      </div>
    </div>
  );
}

const WEB = { width: 1280, height: 820 };
const PHONE = { width: 406, height: 860 };

export const shells = specimens([
  {
    id: "viewer-web-shell",
    name: "ViewerWebShell",
    group: "Shells",
    from: [
      { file: HOME, anchor: "home-desk", frames: ["01.1"] },
      { file: HOME, anchor: "watch-desk", frames: ["03.1"] },
      { file: HOME, anchor: "guide", frames: ["05.1"] },
      { file: YOU, anchor: "signin", frames: ["01.1"] },
      { file: YOU, anchor: "you", frames: ["02.1"] },
      { file: PAGES, anchor: "radio", frames: ["04.1"] }
    ],
    notes:
      "The viewer app on the web: lockup, Dial / Guide / Radio / Presets with the active underline, search with the / key, the market button, the avatar (ringed on You) or Sign in, the page, and the player bar. Only the player shows a lit tally. It fills its container.",
    frame: WEB,
    states: [
      {
        label: "Dial, signed in, playing",
        render: () => (
          <ViewerWebShell active="dial" linkTo={go} market={MARKET_IE} user={KAI} onSearch={() => {}} player={beatPlayer(true, true)}>
            <Filler title="On the dial" lede="Inland Empire, in channel order." rows={8} />
          </ViewerWebShell>
        )
      },
      {
        label: "Guide, paused",
        note: "Paused: the tally is out and Pause becomes Play.",
        render: () => (
          <ViewerWebShell active="guide" linkTo={go} market={MARKET_IE} user={KAI} onSearch={() => {}} player={beatPlayer(false)}>
            <Filler title="Tonight" rows={8} />
          </ViewerWebShell>
        )
      },
      {
        label: "You: avatar ringed, no nav item",
        render: () => (
          <ViewerWebShell active="you" linkTo={go} market={MARKET_IE} user={KAI} onSearch={() => {}} player={beatPlayer()}>
            <Filler title="Kai M." rows={6} />
          </ViewerWebShell>
        )
      },
      {
        label: "Signed out: Sign in",
        render: () => (
          <ViewerWebShell active="dial" linkTo={go} market={MARKET_IE} signIn={{ href: "#signin" }} onSearch={() => {}} player={beatPlayer()}>
            <Filler title="On the dial" rows={8} />
          </ViewerWebShell>
        )
      },
      {
        label: "Radio, a radio station playing",
        render: () => (
          <ViewerWebShell
            active="radio"
            linkTo={go}
            market={MARKET_IE}
            user={KAI}
            onSearch={() => {}}
            player={<PlayerBar title="Radio dramas from the 1940s" station="NITE 88.4, The Hollow Door, part 2" card="88.4" colour="#33507A" playing radio onTogglePlay={() => {}} />}
          >
            <Filler title="Radio" lede="Inland Empire, 4 stations" rows={4} />
          </ViewerWebShell>
        )
      }
    ]
  },
  {
    id: "player-bar",
    name: "PlayerBar",
    group: "Shells",
    from: [
      { file: HOME, anchor: "home-desk", frames: ["01.1"] },
      { file: HOME, anchor: "guide", frames: ["05.1"] },
      { file: PAGES, anchor: "radio", frames: ["04.1"] }
    ],
    notes:
      "The web player bar: title card in the station's colour, title, station line, channel down and up, pause, and the lit tally only while playing. Volume and Open player appear when the page offers them.",
    stacked: true,
    states: [
      { label: "Playing", render: () => beatPlayer() },
      { label: "Playing, with volume and open player", render: () => beatPlayer(true, true) },
      { label: "Paused", note: "Not drawn in the references: the tally goes out and Pause becomes Play.", render: () => beatPlayer(false) },
      {
        label: "Radio",
        render: () => (
          <PlayerBar title="Radio dramas from the 1940s" station="NITE 88.4, The Hollow Door, part 2" card="88.4" colour="#33507A" playing radio onTogglePlay={() => {}} />
        )
      },
      { label: "Pause and play (press it)", render: () => <PlayerDemo /> }
    ]
  },
  {
    id: "viewer-phone-shell",
    name: "ViewerPhoneShell",
    group: "Shells",
    from: [
      { file: HOME, anchor: "home-phone", frames: ["02.1"] },
      { file: YOU, anchor: "phone", frames: ["06.1", "06.2", "06.3"] },
      { file: PAGES, anchor: "phone", frames: ["05.2", "05.3"] }
    ],
    notes:
      "The viewer app on the phone: top bar (lockup, market, search), the scrolling page, the mini player and the four tabs. A back bar replaces the top bar on section screens, which hide the tabs. The status bar and home indicator are the phone's, drawn here by the gallery's DeviceFrame only.",
    frame: PHONE,
    states: [
      {
        label: "Dial tab, playing",
        render: () => (
          <DeviceFrame>
            <ViewerPhoneShell tab="dial" linkTo={go} market={MARKET_IE} onSearch={() => {}} player={beatMini()}>
              <Filler title="On the dial" rows={10} />
            </ViewerPhoneShell>
          </DeviceFrame>
        )
      },
      {
        label: "You tab, paused",
        render: () => (
          <DeviceFrame>
            <ViewerPhoneShell tab="you" linkTo={go} market={MARKET_IE} onSearch={() => {}} player={beatMini(false)}>
              <Filler title="Kai M." rows={6} />
            </ViewerPhoneShell>
          </DeviceFrame>
        )
      },
      {
        label: "Back bar: a settings section",
        render: () => (
          <DeviceFrame>
            <ViewerPhoneShell tabs={false} back={{ title: "Notifications", onBack: () => {} }}>
              <Filler rows={6} />
            </ViewerPhoneShell>
          </DeviceFrame>
        ),
        note: "A back bar in place of the top bar, and no tabs or mini player."
      },
      {
        label: "Search tab, nothing playing",
        render: () => (
          <DeviceFrame>
            <ViewerPhoneShell tab="search" linkTo={go} market={MARKET_IE}>
              <Filler title="Search" rows={6} />
            </ViewerPhoneShell>
          </DeviceFrame>
        )
      }
    ]
  },
  {
    id: "mini-player",
    name: "MiniPlayer",
    group: "Shells",
    from: [
      { file: HOME, anchor: "home-phone", frames: ["02.1"] },
      { file: YOU, anchor: "phone", frames: ["06.1", "06.2"] }
    ],
    notes: "The phone's mini player above the tabs: title card, title, station, the tally while playing, and pause. Tapping the card and title opens the full player.",
    states: [
      { label: "Playing", render: () => <div style={{ width: 390 }}>{beatMini()}</div> },
      { label: "Paused", note: "Not drawn: the tally goes out and Pause becomes Play.", render: () => <div style={{ width: 390 }}>{beatMini(false)}</div> },
      {
        label: "Opens the full player",
        render: () => (
          <div style={{ width: 390 }}>
            <MiniPlayer title="Saturday Reel" station="BEAT 12.1" colour={BEAT.colour} playing onTogglePlay={() => {}} onOpen={() => {}} />
          </div>
        )
      },
      { label: "Pause and play (press it)", render: () => <PlayerDemo mini /> }
    ]
  },
  {
    id: "phone-back-bar",
    name: "PhoneBackBar",
    group: "Shells",
    from: [
      { file: YOU, anchor: "phone", frames: ["06.3"] },
      { file: SET, anchor: "phone", frames: ["05.1"] },
      { file: BIZSET, anchor: "phone", frames: ["05.1"] }
    ],
    notes: "The phone's back bar: a back arrow and the screen's name, ruled underneath. Without an arrow it heads a top-level screen.",
    states: [
      { label: "With a back arrow", render: () => <div style={{ width: 390 }}><PhoneBackBar title="BEAT notifications" onBack={() => {}} /></div> },
      {
        label: "Top level, with an end",
        render: () => (
          <div style={{ width: 390 }}>
            <PhoneBackBar title="Orange Street Coffee" end={<span className="oc-quiet" style={{ fontSize: 13 }}>Redeem</span>} />
          </div>
        )
      }
    ]
  },
  {
    id: "control-shell",
    name: "ControlShell",
    group: "Shells",
    from: [
      { file: MC, anchor: "flow-a", frames: ["A.7"] },
      { file: MARKET, anchor: "catalog", frames: ["05.1"] },
      { file: LIVE, anchor: "sources", frames: ["01.1"] }
    ],
    notes:
      "Master control: the station switcher (colour, channel, call sign), the 12-hour clock with seconds, the tally and Sign off; the rail the same on every screen, with counts and amber warn counts. A host's rail is Open: here the pages they can't open are disabled, each saying why.",
    frame: WEB,
    states: [
      {
        label: "Monitor, on air",
        render: () => (
          <ControlShell station={BEAT} active="monitor" items={monitorItems} linkTo={go} now={AT} timeZone={TZ} onAir onSignOff={() => {}}>
            <ControlTitle title="Monitor" description="On air since 6:00 pm. Break in 1:48." end={<Button size="sm">Cue a break now</Button>} />
            <Filler rows={8} />
          </ControlShell>
        )
      },
      {
        label: "Syndication market, warn counts",
        render: () => (
          <ControlShell
            station={BEAT}
            active="market"
            items={{ breaks: { count: "3:30", warn: true }, library: { count: 31 }, listings: { count: 2, warn: true }, translators: { count: 1 }, rights: { count: 1, warn: true } }}
            linkTo={go}
            now={AT}
            timeZone={TZ}
            onAir
            onSignOff={() => {}}
          >
            <ControlTitle title="The Opencast catalog" />
            <Filler rows={8} />
          </ControlShell>
        )
      },
      {
        label: "Off air",
        note: "The tally is unlit and there's nothing to sign off.",
        render: () => (
          <ControlShell station={BEAT} active="program-log" linkTo={go} now={AT} timeZone={TZ} onAir={false}>
            <ControlTitle title="Program log" />
            <Filler rows={8} />
          </ControlShell>
        )
      },
      {
        label: "A host: other pages disabled",
        note: "Open (inventory 9): disabled items or a host-only rail. Hosts can't sign off, so there's no Sign off.",
        render: () => (
          <ControlShell station={{ ...BEAT, channel: "7.1", callSign: "CIVC", colour: "#2E6B5A" }} active="live-sources" items={hostItems} linkTo={go} now={AT} timeZone={TZ} onAir>
            <ControlTitle title="Live sources" />
            <Filler rows={6} />
          </ControlShell>
        )
      },
      {
        label: "Live clock",
        note: "With no time given, the clock ticks each second.",
        render: () => (
          <ControlShell station={BEAT} active="monitor" items={monitorItems} linkTo={go} onAir onSignOff={() => {}}>
            <ControlTitle title="Monitor" />
          </ControlShell>
        )
      }
    ]
  },
  {
    id: "control-title",
    name: "ControlTitle",
    group: "Shells",
    from: [{ file: MC, anchor: "flow-a", frames: ["A.1", "A.7"] }],
    notes: "The page title block of master control, business and desk pages: the page's name, one line under it, and buttons at the right.",
    states: [
      {
        label: "With a line and a button",
        render: () => <ControlTitle title="Monitor" description="On air since 6:00 pm. Break in 1:48." end={<Button size="sm">Cue a break now</Button>} />
      },
      { label: "Title only", render: () => <ControlTitle title="Breaks tonight" /> }
    ]
  },
  {
    id: "control-foot",
    name: "ControlFoot",
    group: "Shells",
    from: [{ file: MC, anchor: "flow-a", frames: ["A.1", "A.2", "A.4"] }],
    notes: "The footer under a page: a rule, a quiet note at the left, and the next step at the right.",
    states: [
      {
        label: "Note and one button",
        render: () => (
          <ControlFoot note="Saved as you go">
            <Button variant="primary">Continue to library</Button>
          </ControlFoot>
        )
      },
      {
        label: "Back and continue",
        render: () => (
          <ControlFoot note="A station needs at least one program and a station ID to sign on.">
            <Button>Back</Button>
            <Button variant="primary">Continue to program log</Button>
          </ControlFoot>
        )
      }
    ]
  },
  {
    id: "control-setup-shell",
    name: "ControlSetupShell",
    group: "Shells",
    from: [{ file: MC, anchor: "flow-a", frames: ["A.1", "A.2", "A.4", "A.5", "A.6"] }],
    notes: "Master control while a new station is set up: \"New station, step N of 5\", Save and finish later, and the step rail A1 to A5 (done, current, to come).",
    frame: WEB,
    states: [1, 2, 5].map((step) => ({
      label: `Step ${step} of 5`,
      render: () => (
        <ControlSetupShell step={step} onFinishLater={() => {}}>
          <ControlTitle title={CONTROL_SETUP_STEPS[step - 1]} />
          <Filler rows={6} />
          <ControlFoot note="Saved as you go">
            {step > 1 && <Button>Back</Button>}
            <Button variant={step === 5 ? "ink" : "primary"}>{step === 5 ? "Sign on" : "Continue"}</Button>
          </ControlFoot>
        </ControlSetupShell>
      )
    }))
  },
  {
    id: "shell-steps",
    name: "ShellSteps",
    group: "Shells",
    from: [
      { file: MC, anchor: "flow-a", frames: ["A.1", "A.2"] },
      { file: FUND, anchor: "fund", frames: ["02.1"] }
    ],
    notes: "The setup rail: numbered steps, done with a check, the current one ringed in signal, and a hint under a rule.",
    states: [
      {
        label: "Step 2 of 5",
        render: () => (
          <div style={{ width: 200, height: 360, display: "flex" }}>
            <ShellSteps steps={[...CONTROL_SETUP_STEPS]} current={2} hint="Each step saves as you go. Nothing is public until you sign on." />
          </div>
        )
      }
    ]
  },
  {
    id: "shell-rail",
    name: "ShellRail",
    group: "Shells",
    from: [
      { file: MC, anchor: "flow-a", frames: ["A.7"] },
      { file: DESK, anchor: "board", frames: ["01.1"] }
    ],
    notes: "The 200px rail: grouped pages, the active one raised, counts in mono, amber for attention, and disabled items with a lock and their reason.",
    states: [
      {
        label: "Master control",
        render: () => (
          <div style={{ width: 200, display: "flex" }}>
            <ShellRail groups={buildRail(CONTROL_RAIL, monitorItems, go)} active="monitor" />
          </div>
        )
      },
      {
        label: "A host",
        render: () => (
          <div style={{ width: 200, display: "flex" }}>
            <ShellRail groups={buildRail(CONTROL_RAIL, hostItems, go)} active="live-sources" />
          </div>
        )
      }
    ]
  },
  {
    id: "studio-shell",
    name: "StudioShell",
    group: "Shells",
    from: [{ file: MARKET, anchor: "studio", frames: ["04.1"] }],
    notes: "Master control for a studio, a station with no channel: the switcher says Studio, the header says \"Studios don't broadcast\", and there's no clock, tally, Sign off or on-air page.",
    frame: WEB,
    states: [
      {
        label: "Your programs",
        render: () => (
          <StudioShell studio={{ name: "Inland Sound Lab", colour: "#7E2F35" }} active="programs" items={{ library: { count: 18 } }} linkTo={go}>
            <ControlTitle title="Your programs" />
            <Filler rows={8} />
          </StudioShell>
        )
      }
    ]
  },
  {
    id: "control-phone-shell",
    name: "ControlPhoneShell",
    group: "Shells",
    from: [
      { file: MC, anchor: "flow-p", frames: ["P.1"] },
      { file: LIVE, anchor: "phone", frames: ["05.1", "05.2"] }
    ],
    notes: "Master control on the phone: channel, call sign, what the screen is, and the tally; the page; and the two ghost actions pinned at the foot (neither leans).",
    frame: PHONE,
    states: [
      {
        label: "On air",
        render: () => (
          <DeviceFrame>
            <ControlPhoneShell
              station={BEAT}
              tally="lit"
              actions={
                <>
                  <Button>Cue a break</Button>
                  <Button>Sign off</Button>
                </>
              }
            >
              <div style={{ padding: "14px 16px" }}>
                <Filler rows={8} />
              </div>
            </ControlPhoneShell>
          </DeviceFrame>
        )
      },
      {
        label: "Going live: stand by",
        render: () => (
          <DeviceFrame>
            <ControlPhoneShell station={CIVC} context="Go live" tally="standby">
              <div style={{ padding: "14px 16px" }}>
                <Filler rows={6} />
              </div>
            </ControlPhoneShell>
          </DeviceFrame>
        )
      },
      {
        label: "Live, 24:10 in",
        render: () => (
          <DeviceFrame>
            <ControlPhoneShell station={CIVC} context="24:10 in" tally="lit">
              <div style={{ padding: "14px 16px" }}>
                <Filler rows={6} />
              </div>
            </ControlPhoneShell>
          </DeviceFrame>
        )
      }
    ]
  },
  {
    id: "business-shell",
    name: "BusinessShell",
    group: "Shells",
    from: [
      { file: SPOTS, anchor: "list", frames: ["01.1"] },
      { file: FUND, anchor: "balance", frames: ["03.1"] }
    ],
    notes: "Opencast for business: a raised header with the business switcher, the available balance and the avatar; the rail; the page.",
    frame: WEB,
    states: [
      {
        label: "Spots",
        render: () => (
          <BusinessShell business={OSC} available={412_500_000} user={{ initials: "JL", name: "J. L." }} active="spots" items={{ spots: { count: 3 } }} linkTo={go}>
            <ControlTitle title="Spots" end={<Button variant="primary" size="sm">New spot</Button>} />
            <Filler rows={6} />
          </BusinessShell>
        )
      },
      {
        label: "Balance",
        render: () => (
          <BusinessShell business={OSC} available={412_500_000} user={{ initials: "JL", name: "J. L." }} active="balance" items={{ spots: { count: 3 } }} linkTo={go}>
            <ControlTitle title="Balance" />
            <Filler rows={6} />
          </BusinessShell>
        )
      }
    ]
  },
  {
    id: "business-setup-shell",
    name: "BusinessSetupShell",
    group: "Shells",
    from: [
      { file: FUND, anchor: "business", frames: ["01.1"] },
      { file: FUND, anchor: "fund", frames: ["02.1"] }
    ],
    notes: "Opencast for business while getting started: \"Getting started, step N of 3\", Finish later, and the step rail.",
    frame: WEB,
    states: [1, 2].map((step) => ({
      label: `Step ${step} of 3`,
      render: () => (
        <BusinessSetupShell step={step} onFinishLater={() => {}}>
          <ControlTitle title={step === 1 ? "Your business" : "Fund your balance"} />
          <Filler rows={6} />
        </BusinessSetupShell>
      )
    }))
  },
  {
    id: "desk-shell",
    name: "DeskShell",
    group: "Shells",
    from: [
      { file: DESK, anchor: "board", frames: ["01.1"] },
      { file: DESK, anchor: "held", frames: ["07.1"] }
    ],
    notes: "The Network desk: the amber Internal sign, \"Opencast team\" and the avatar; the rail with mono counts. Admin only.",
    frame: { width: 1280, height: 860 },
    states: (["market-board", "held-earnings"] as const).map((active) => ({
      label: active === "market-board" ? "Market board" : "Held earnings",
      render: () => (
        <DeskShell
          user={{ initials: "DA", name: "D. A." }}
          active={active}
          items={{
            "creator-pipeline": { count: 4 },
            "listed-sources": { count: 1 },
            "held-earnings": { count: money(227_000_000, { trimCents: true }) },
            "reserved-call-signs": { count: 26 }
          }}
          linkTo={go}
        >
          <ControlTitle title={active === "market-board" ? "Inland Empire" : "Held earnings"} />
          <Filler rows={8} />
        </DeskShell>
      )
    }))
  },
  {
    id: "settings-layout",
    name: "SettingsLayout",
    group: "Shells",
    from: [
      { file: SET, anchor: "identity", frames: ["01.1"] },
      { file: BIZSET, anchor: "profile", frames: ["01.1"] },
      { file: YOU, anchor: "settings", frames: ["05.1"] }
    ],
    notes:
      "Settings: a sub-rail of sections and one pane, inside master control's and the business app's main (flush), and as the viewer's settings page. A section that ends something is red.",
    frame: { width: 1280, height: 860 },
    states: [
      {
        label: "Station settings",
        render: () => (
          <ControlShell station={BEAT} active="settings" items={monitorItems} linkTo={go} now={AT} timeZone={TZ} onAir onSignOff={() => {}} flush>
            <SettingsLayout sections={STATION_SECTIONS} active="identity" description="How BEAT looks everywhere it appears.">
              <Filler rows={6} />
            </SettingsLayout>
          </ControlShell>
        )
      },
      {
        label: "Business settings",
        render: () => (
          <BusinessShell business={OSC} available={412_500_000} user={{ initials: "JL", name: "J. L." }} active="settings" items={{ spots: { count: 3 } }} linkTo={go} flush>
            <SettingsLayout sections={BIZ_SECTIONS} active="business" heading="Business profile">
              <Filler rows={6} />
            </SettingsLayout>
          </BusinessShell>
        )
      },
      {
        label: "Viewer settings",
        render: () => (
          <ViewerWebShell active="you" linkTo={go} market={MARKET_IE} user={KAI} onSearch={() => {}} padded={false}>
            <SettingsLayout variant="viewer" sections={VIEWER_SECTIONS} active="watching" description="These apply on this account's phones, computers and TVs.">
              <Filler rows={6} />
            </SettingsLayout>
          </ViewerWebShell>
        )
      }
    ]
  },
  {
    id: "settings-layout-phone",
    name: "SettingsLayout, phone",
    group: "Shells",
    from: [
      { file: YOU, anchor: "phone", frames: ["06.3"] },
      { file: SET, anchor: "phone", frames: ["05.1"] }
    ],
    notes: "On the phone, settings are a list of sections, and each section is a screen with a back arrow, never a modal. The list itself isn't drawn; its rows follow the settings rows.",
    frame: PHONE,
    states: [
      {
        label: "The list of sections",
        render: () => (
          <DeviceFrame>
            <SettingsLayout form="phone" sections={VIEWER_SECTIONS} active={null} />
          </DeviceFrame>
        )
      },
      {
        label: "A section",
        render: () => (
          <DeviceFrame>
            <SettingsLayout form="phone" sections={STATION_SECTIONS} active="notifications" heading="BEAT notifications" onBack={() => {}}>
              <div style={{ padding: "0 16px" }}>
                <Filler rows={6} />
              </div>
            </SettingsLayout>
          </DeviceFrame>
        )
      }
    ]
  },
  {
    id: "tv-shell",
    name: "TvShell",
    group: "Shells",
    from: [
      { file: TV, anchor: "watching", frames: ["02.1"] },
      { file: TVU, anchor: "mirror", frames: ["01.1"] }
    ],
    notes:
      "TV mode's ten-foot canvas: 1920×1080, always dark, the picture full bleed and everything else inside the 90% title-safe area, with a slot for the hint row. It scales to fit its container, keeping 16:9.",
    grounds: ["tv"],
    frame: { width: 1920, height: 1080 },
    states: [
      {
        label: "Picture and hint row",
        render: () => (
          <TvShell
            picture={<TvPicture />}
            hints={
              <>
                <span>Mirrored from Kai's iPhone</span>
                <span style={{ marginLeft: "auto" }}>Keep Opencast open on your iPhone</span>
              </>
            }
          >
            <div style={{ position: "absolute", right: 0, top: 0 }}>
              <Tally state="lit" size="tv" flicker={false} />
            </div>
          </TvShell>
        )
      },
      {
        label: "The title-safe area",
        note: "The dashed line is the gallery's: it marks where overlays may go.",
        render: () => (
          <TvShell picture={<TvPicture />}>
            <div style={{ position: "absolute", inset: 0, border: "2px dashed var(--signal)" }}>
              <span style={{ position: "absolute", left: 16, top: 12 }}>
                <Tag>Title safe, 90%</Tag>
              </span>
            </div>
          </TvShell>
        )
      },
      {
        label: "Scaled into a smaller box",
        note: "The same canvas in a 960×720 box: it keeps 16:9 and is letterboxed.",
        render: () => (
          <div style={{ width: 960, height: 720, margin: 40, outline: "1px dashed var(--line)" }}>
            <TvShell picture={<TvPicture />} hints={<span>Playing from Kai's phone</span>} />
          </div>
        )
      }
    ]
  }
]);
