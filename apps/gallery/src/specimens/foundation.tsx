import { ICONS, Icon, Lockup, Mark, contrastRatio, ratioLabel, type IconName } from "@opencast/ui";
import { specimens } from "../registry";

const STYLE = "brand/opencast-style.html";

const COLOURS: Array<[string, string]> = [
  ["--ground", "The page"],
  ["--raised", "Fields, the player bar, the row that's playing"],
  ["--screen", "Behind any picture; dark on both grounds"],
  ["--ink", "Text and drawn lines"],
  ["--ink-70", "Secondary text"],
  ["--ink-50", "The lightest text allowed: times, channel numbers"],
  ["--line", "Control borders, never text"],
  ["--hair", "Rules between rows"],
  ["--tally", "On air, once per view"],
  ["--live", "Live, as text"],
  ["--standby", "Up next, spots in the log, needs attention"],
  ["--standby-fill", "The Next tag's fill"],
  ["--signal", "Links, focus"],
  ["--signal-fill", "The primary button"]
];

const STATIONS: Array<[string, string, string]> = [
  ["CIVC", "7.1", "#2E6B5A"],
  ["BEAT", "12.1", "#8C3B7A"],
  ["REEL", "24.1", "#9A5412"],
  ["NITE", "88.4", "#33507A"]
];

const TYPE: Array<[string, string, string]> = [
  ["oc-t-ident", "Ident", "BEAT 12.1"],
  ["oc-t-heading", "Heading", "Home is a dial, not a feed."],
  ["oc-t-page", "Page title (apps)", "Program log"],
  ["oc-t-title", "Program title", "Saturday Reel"],
  ["oc-t-section", "Section", "Inland Empire"],
  ["oc-t-lede", "Lede", "Tuning in lands mid-program, like a real station."],
  ["oc-t-body", "Body", "Next on 7.1 at 9:30: Planning Commission."],
  ["oc-t-small", "Small", "Carried from REEL 24.1"],
  ["oc-t-clock", "Clock", "8:42:12 pm"]
];

export const foundation = specimens([
  {
    id: "colour",
    name: "Colour",
    group: "Foundation",
    from: [{ file: STYLE, anchor: "colour" }],
    notes: "Ground and ink, the four signals, and station colours (4.5:1 against white, carrying white text). Every value is a token in packages/ui/src/tokens.css.",
    states: [
      {
        label: "Ground, ink and signals",
        render: () => (
          <div className="gal-col" style={{ gap: 0, width: "100%" }}>
            {COLOURS.map(([token, role]) => (
              <div key={token} style={{ display: "grid", gridTemplateColumns: "56px 130px 1fr", gap: 12, alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--hair)", width: "100%" }}>
                <i style={{ display: "block", height: 28, borderRadius: "var(--r-control)", background: `var(${token})`, boxShadow: "0 0 0 1px var(--hair)" }} />
                <span className="oc-mono" style={{ fontSize: 13 }}>{token}</span>
                <span className="oc-muted" style={{ fontSize: 13 }}>{role}</span>
              </div>
            ))}
          </div>
        )
      },
      {
        label: "Station colours",
        note: "Ratios against white, computed by stationColourPasses().",
        render: () => (
          <div className="gal-row">
            {STATIONS.map(([cs, ch, colour]) => (
              <div key={cs} style={{ width: 150 }}>
                <div style={{ aspectRatio: "16/9", borderRadius: "var(--r-screen)", background: colour, color: "#fff", padding: 12, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  <span className="oc-cs" style={{ fontSize: 22 }}>{cs}</span>
                  <span className="oc-mono" style={{ fontSize: 13, opacity: 0.92 }}>{ch}</span>
                </div>
                <p className="oc-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
                  <span className="oc-mono">{colour}</span> {ratioLabel(contrastRatio(colour, "#FFFFFF"))}
                </p>
              </div>
            ))}
          </div>
        )
      }
    ]
  },
  {
    id: "type",
    name: "Type",
    group: "Foundation",
    from: [{ file: STYLE, anchor: "type" }],
    notes: "Archivo (wide for the ident, plain for the rest), Public Sans for text and buttons, IBM Plex Mono only for the clock, channel numbers, amounts and log codes. Self-hosted.",
    stacked: true,
    states: [
      {
        label: "The scale",
        render: () => (
          <div className="gal-col" style={{ gap: 0, width: "100%" }}>
            {TYPE.map(([cls, name, sample]) => (
              <div key={cls} style={{ display: "grid", gridTemplateColumns: "170px 1fr", gap: 16, alignItems: "baseline", padding: "12px 0", borderBottom: "1px solid var(--hair)", width: "100%" }}>
                <span className="oc-muted" style={{ fontSize: 14 }}>
                  {name}
                  <small className="oc-mono oc-quiet" style={{ display: "block", fontSize: 12 }}>.{cls}</small>
                </span>
                <span className={cls}>{sample}</span>
              </div>
            ))}
          </div>
        )
      }
    ]
  },
  {
    id: "space-shape",
    name: "Space and shape",
    group: "Foundation",
    from: [{ file: STYLE, anchor: "space" }],
    notes: "Seven steps of space, three corners. The picture is the only box: everything else is separated by rules.",
    states: [
      {
        label: "Space",
        render: () => (
          <div className="gal-col" style={{ gap: 6, width: "100%" }}>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <div key={n} style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 12, alignItems: "center", fontSize: 13 }}>
                <span className="oc-mono">--s{n}</span>
                <i style={{ display: "block", height: 12, width: `var(--s${n})`, background: "var(--ink)", borderRadius: 1 }} />
              </div>
            ))}
          </div>
        )
      },
      {
        label: "Corners",
        render: () => (
          <div className="gal-row">
            {[["--r-sign", "3px: tally, tags, log codes"], ["--r-control", "6px: buttons, fields"], ["--r-screen", "14px: pictures, title cards"]].map(([t, use]) => (
              <div key={t} style={{ width: 140 }}>
                <i style={{ display: "block", height: 60, borderRadius: `var(${t})`, border: "1.5px solid var(--ink)" }} />
                <p className="oc-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
                  <span className="oc-mono">{t}</span> {use}
                </p>
              </div>
            ))}
          </div>
        )
      }
    ]
  },
  {
    id: "icons",
    name: "Icons and the mark",
    group: "Foundation",
    from: [{ file: STYLE, anchor: "mark" }, { file: "viewer/opencast-home.html" }],
    notes: "The 31 icons and the mark, generated from the reference files' SVG symbols. Icons are decorative unless given a label.",
    states: [
      {
        label: "Icons",
        render: () => (
          <div className="gal-row" style={{ gap: 18 }}>
            {(Object.keys(ICONS) as IconName[]).map((n) => (
              <span key={n} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4, width: 56 }}>
                <Icon name={n} size={20} />
                <span className="oc-mono oc-quiet" style={{ fontSize: 11 }}>{n}</span>
              </span>
            ))}
          </div>
        )
      },
      {
        label: "Mark and lockup",
        render: () => (
          <div className="gal-row" style={{ gap: 24 }}>
            <Mark variant="outline" size={62} />
            <Mark variant="outline-mono" size={62} />
            <Mark variant="solid" size={32} />
            <Lockup size="app" />
            <Lockup size="hero" />
          </div>
        )
      }
    ]
  }
]);
