import { useState, type ReactNode } from "react";
import {
  AmountPicker,
  Avatar,
  Button,
  Checkbox,
  Chip,
  ChipRow,
  ChoiceList,
  Field,
  Icon,
  IconButton,
  Kbd,
  Menu,
  Modal,
  Notice,
  Segmented,
  SelectField,
  Sheet,
  Drawer,
  Tabs,
  Tag,
  Tally,
  TextAreaField,
  Toast,
  ToastProvider,
  Toggle,
  ToggleLock,
  Tooltip,
  clock,
  clockRange,
  money,
  useToast,
  type AmountChoice,
  type Choice,
  type MenuItem
} from "@opencast/ui";
import { specimens } from "../registry";

const STYLE = "brand/opencast-style.html";
const MC = "control/opencast-master-control.html";
const HOME = "viewer/opencast-home.html";
const SCH = "control/opencast-schedule.html";

/** Lights the tally on demand, to show the switch-on. */
function TallyDemo({ size, on }: { size: "sm" | "md" | "lg"; on: "ground" | "picture" }) {
  const [lit, setLit] = useState(false);
  return (
    <div className="gal-row">
      <Tally state={lit ? "lit" : "unlit"} size={size} on={on} />
      <Button size="sm" onClick={() => setLit((v) => !v)}>
        {lit ? "Sign off" : "Sign on"}
      </Button>
    </div>
  );
}

// ---------- Mock data from the frames ----------
const SAT = (h: number, m = 0) => new Date(2026, 8, 26, h, m); // Saturday September 26, 8:42 pm is "now"
const $ = (dollars: number) => Math.round(dollars * 1_000_000);

const YOU = "viewer/opencast-you.html";
const STACK = { display: "grid", gap: 16, width: "100%" } as const;
const STN = "control/opencast-station-settings.html";
const OFFER = "control/opencast-offering.html";
const MARKET = "control/opencast-market.html";
const RIGHTS = "control/opencast-rights.html";
const LIVE = "control/opencast-live-listings.html";
const FUND = "business/opencast-biz-funding.html";
const SPOTS = "business/opencast-biz-spots.html";
const BSET = "business/opencast-biz-settings.html";
const ORDERS = "business/opencast-production-orders.html";
const SCHEDULE = "control/opencast-schedule.html";
const TV = "tv/opencast-tv.html";

const FILL_OPTIONS = [
  { value: "repeat", title: "Repeat from your library", helper: "Late Crate episodes 12 to 15, in order, with your break rule" },
  { value: "carry", title: "Carry from the syndication market", helper: "Night Desk and Slow Hours both fit this slot" },
  { value: "off", title: `Sign off at ${clock(SAT(23, 40))}`, helper: `Viewers see "Off air" and when you're back` }
];
const TERM_OPTIONS = [
  { value: "barter", title: "Barter", helper: "No fee. REEL fills 2:00 with its spots; you sell the other 2:00.", end: money(0) },
  { value: "cash", title: "Cash", helper: "You pay per airing and sell all 4:00 of breaks.", end: `${money($(2.5))} an airing` },
  { value: "both", title: "Cash plus barter", helper: "A lower fee. REEL fills 1:00; you sell 3:00.", end: `${money($(1.25))} an airing` }
];
const METHOD_OPTIONS = [
  { value: "clear", title: "Bank transfer, through Clear", helper: "From any US bank. Arrives in 1 to 2 business days", end: "No fee" },
  { value: "card", title: "Card", helper: "Arrives right away", end: money($(7.55)), endNote: "Stripe's fee, at cost" },
  { value: "account", title: "Your Clear business account", helper: "Instant, once connected. Connect it here", end: "No fee" }
];
const PRESET_OPTIONS = [
  { value: "3", title: "Replace key 3, NITE 88.4", helper: "NITE moves to More presets" },
  { value: "6", title: "Replace key 6, HALL 90.8", helper: "HALL moves to More presets" },
  { value: "none", title: "No key", helper: "Save it to More presets" }
];

/** A place for things that sit on a drawn screen (a backdrop, a toast): positioned, with a height. */
function Stage({ height, children, dim }: { height: number; children: ReactNode; dim?: boolean }) {
  return (
    <div style={{ position: "relative", height, width: "100%", overflow: "hidden", borderRadius: "var(--r-control)", boxShadow: dim ? undefined : "inset 0 0 0 1px var(--hair)" }}>
      {children}
    </div>
  );
}

/** A stand-in for the broadcast group's StationBand, drawn as the reference's .stn-band. */
function DemoBand({ colour, ch, cs, name, closeRoom }: { colour: string; ch: string; cs: string; name: ReactNode; closeRoom?: boolean }) {
  // With closeRoom the right padding is left to the Modal, which makes room for its close button.
  return (
    <div style={{ background: colour, color: "var(--on-station)", paddingTop: 18, paddingBottom: 18, paddingLeft: 22, paddingRight: closeRoom ? undefined : 22, display: "flex", alignItems: "flex-end", gap: 14 }}>
      <span className="oc-ch" style={{ fontSize: 30, fontWeight: 500, letterSpacing: "-.04em", lineHeight: 1 }}>{ch}</span>
      <span className="oc-cs" style={{ fontSize: 30, lineHeight: 1 }}>{cs}</span>
      <span style={{ fontSize: 14, opacity: 0.9, marginLeft: "auto", textAlign: "right", lineHeight: 1.3 }}>{name}</span>
    </div>
  );
}

function Row({ title, helper, children }: { title: string; helper?: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 16, alignItems: "center", padding: "11px 0", borderBottom: "1px solid var(--hair)", fontSize: 14, width: "100%" }}>
      <div>
        <b style={{ display: "block", fontWeight: 600 }}>{title}</b>
        {helper && <small style={{ display: "block", fontSize: 12.5, color: "var(--ink-70)" }}>{helper}</small>}
      </div>
      {children}
    </div>
  );
}

function ToggleDemo({ start, title, helper }: { start: boolean; title: string; helper?: string }) {
  const [on, setOn] = useState(start);
  return (
    <Row title={title} helper={helper}>
      <Toggle checked={on} onChange={setOn} label={title} />
    </Row>
  );
}

function SegDemo<V extends string>({ options, start, label, size, block }: { options: { value: V; label: string }[]; start: V; label: string; size?: "md" | "sm" | "compact"; block?: boolean }) {
  const [v, setV] = useState<V>(start);
  return <Segmented options={options} value={v} onChange={setV} label={label} size={size} block={block} />;
}

function ChipSingleDemo() {
  const [v, setV] = useState("all");
  return (
    <ChipRow
      label="Filter the dial"
      value={v}
      onChange={setV}
      options={["All", "Live now", "Public affairs", "Music", "Classic", "Food", "Sports"].map((l) => ({ value: l === "All" ? "all" : l, label: l }))}
    />
  );
}

function ChipMultiDemo({ strike, start, options, label }: { strike?: boolean; start: string[]; options: string[]; label: string }) {
  const [v, setV] = useState<string[]>(start);
  return <ChipRow multiple layout="wrap" strike={strike} label={label} value={v} onChange={setV} options={options.map((o) => ({ value: o, label: o }))} />;
}

function TabsDemo({ variant }: { variant: "underline" | "days" | "pill" }) {
  const [v, setV] = useState(variant === "days" ? "Sat" : variant === "pill" ? "log" : "offered");
  if (variant === "pill")
    return (
      <Tabs
        variant="pill"
        label="Schedule"
        value={v}
        onChange={setV}
        items={[
          { value: "log", label: "Log" },
          { value: "templates", label: "Templates" },
          { value: "blocks", label: "Blocks" },
          { value: "rules", label: "Break rules" }
        ]}
      />
    );
  if (variant === "days")
    return <Tabs variant="days" label="Day" value={v} onChange={setV} items={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => ({ value: d, label: d }))} />;
  return (
    <Tabs
      label="Syndication market"
      value={v}
      onChange={setV}
      items={[
        { value: "browse", label: "Browse" },
        { value: "offered", label: "Offered by BEAT", count: 1, countLabel: "1 request waiting" },
        { value: "carried", label: "Carried by BEAT" }
      ]}
    />
  );
}

function ChoiceDemo({ variant, options, start, label }: { variant: "option" | "term" | "method"; options: Choice[]; start: string | null; label: string }) {
  const [v, setV] = useState<string | null>(start);
  return <ChoiceList variant={variant} options={options} value={v} onChange={setV} label={label} />;
}

function CheckDemo(props: { start: boolean; label: string; children?: ReactNode; helper?: string; ruled?: boolean }) {
  const [on, setOn] = useState(props.start);
  return (
    <div style={{ width: "100%" }}>
      <Checkbox checked={on} onChange={setOn} label={props.label} helper={props.helper} ruled={props.ruled}>
        {props.children}
      </Checkbox>
    </div>
  );
}

function AmountDemo({ variant, amounts, start, other = true, label, otherText = "", error }: { variant: "text" | "mono"; amounts: number[]; start: AmountChoice | null; other?: boolean; label: string; otherText?: string; error?: string }) {
  const [v, setV] = useState<AmountChoice | null>(start);
  const [text, setText] = useState(otherText);
  return (
    <div style={{ width: "100%" }}>
      <AmountPicker variant={variant} amounts={amounts} value={v} onChange={setV} other={other} label={label} otherValue={text} onOtherChange={setText} otherError={error} />
    </div>
  );
}

function ToastLive() {
  const { show } = useToast();
  const [set, setSet] = useState<string>("No reminder yet.");
  return (
    <div className="gal-col">
      <Button
        variant="primary"
        icon="bell"
        onClick={() => {
          setSet(`Reminder set for ${clock(SAT(21))}.`);
          show({
            message: `Reminder set for Beat Tape Live, ${clock(SAT(21))}`,
            onUndo: () => setSet("Undone: no reminder."),
            onExpire: () => setSet(`Reminder set for ${clock(SAT(21))}. It stands.`)
          });
        }}
      >
        Remind me
      </Button>
      <span className="oc-quiet" style={{ fontSize: 13 }}>{set}</span>
    </div>
  );
}

function ModalLive() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState<string | null>("6");
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Add to presets
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width={520}
        eyebrow="All six keys are taken"
        title="Where should PREP 31.1 go?"
        footer={
          <Button variant="primary" onClick={() => setOpen(false)}>
            Save PREP 31.1
          </Button>
        }
      >
        <ChoiceList label="Where should PREP 31.1 go?" options={PRESET_OPTIONS} value={key} onChange={setKey} />
      </Modal>
    </>
  );
}

function SheetLive() {
  const [open, setOpen] = useState(false);
  const [fill, setFill] = useState<string | null>("repeat");
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Open the warning
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        placement="container"
        eyebrow="BEAT 12.1, on air"
        title="Dead air in 12 min"
        subtitle={`Nothing is scheduled after ${clock(SAT(23, 40))}.`}
        footer={
          <Button variant="primary" onClick={() => setOpen(false)}>
            Fill the gap
          </Button>
        }
      >
        <ChoiceList
          label="Fill the gap"
          value={fill}
          onChange={setFill}
          options={[
            { value: "repeat", title: "Repeat from your library", helper: `Late Crate 12 to 15, until ${clock(SAT(26))}` },
            { value: "carry", title: "Carry Slow Hours", helper: "From HALL 90.8, barter, runs all night" },
            { value: "off", title: `Sign off at ${clock(SAT(23, 40))}`, helper: `Back at ${clock(SAT(30))}` }
          ]}
        />
      </Sheet>
    </div>
  );
}

/** A still drawing of the guide's listing, on its backdrop. */
function ListingModal({ manage = false }: { manage?: boolean }) {
  const [switchOver, setSwitchOver] = useState(true);
  return (
    <Modal
      open
      onClose={() => {}}
      placement="container"
      manageFocus={manage}
      width={360}
      eyebrow={
        <>
          <span className="oc-mono">{clockRange(SAT(21), SAT(22), { separator: "–" })}</span>, BEAT 12.1
        </>
      }
      title="Beat Tape Live"
      subtitle={
        <>
          <span style={{ color: "var(--live)", fontWeight: 600 }}>Live</span> from the Redlands studio. Producers play unreleased tapes and talk through how they were made.
        </>
      }
      footer={
        <>
          <Button variant="primary" icon="bell">Remind me</Button>
          <Button variant="ghost">Tune in to BEAT</Button>
        </>
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <b style={{ display: "block", fontWeight: 600, fontSize: 15 }}>Switch me over at {clock(SAT(21), { suffix: false })}</b>
          <small style={{ fontSize: 13, color: "var(--ink-70)" }}>If I'm watching something else on Opencast</small>
        </div>
        <Toggle checked={switchOver} onChange={setSwitchOver} label={`Switch me over at ${clock(SAT(21), { suffix: false })}`} />
      </div>
    </Modal>
  );
}

function CivcBody({ carried, phone }: { carried: string; phone?: boolean }) {
  const lst = (lbl: ReactNode, title: string, sub: ReactNode) => (
    <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--hair)" }}>
      <span style={{ fontSize: 12.5, color: "var(--ink-50)", fontWeight: 600, lineHeight: 1.3 }}>{lbl}</span>
      <div>
        <b style={{ display: "block", font: "700 16px/1.25 var(--font-display)", letterSpacing: "-.01em" }}>{title}</b>
        <small style={{ fontSize: 13, color: "var(--ink-70)" }}>{sub}</small>
      </div>
    </div>
  );
  return (
    <>
      {lst("On now", "Town Hall: backyard homes and ADUs", <><span style={{ color: "var(--live)", fontWeight: 600 }}>Live</span>, until <span className="oc-mono">{clock(SAT(21, 30))}</span></>)}
      {lst(<>Next<span className="oc-mono" style={{ display: "block", fontWeight: 500, color: "var(--ink-70)" }}>{clock(SAT(21, 30), { suffix: false })}</span></>, phone ? "Planning Commission, Sept 24" : "Planning Commission, Sept 24 meeting", "Full meeting, unedited")}
      {lst(<>Later<span className="oc-mono" style={{ display: "block", fontWeight: 500, color: "var(--ink-70)" }}>{clock(SAT(23, 30), { suffix: false })}</span></>, "Council Watch", carried)}
      {!phone && (
        <p style={{ fontSize: 13, color: "var(--ink-70)", margin: "12px 0 0" }}>
          Public affairs. On air {clock(SAT(6))} to {clock(SAT(25))}. Council Watch is carried by 6 stations.
        </p>
      )}
    </>
  );
}

function MenuDemo({ open, items, label }: { open?: boolean; items: MenuItem[]; label?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", width: "100%", minHeight: open ? 150 : undefined, alignItems: "flex-start" }}>
      <Menu items={items} defaultOpen={open} label={label} />
    </div>
  );
}

export const primitives = specimens([
  {
    id: "tally",
    name: "Tally",
    group: "Primitives",
    from: [
      { file: STYLE, anchor: "tally" },
      { file: MC, anchor: "flow-a", frames: ["A.6", "A.7"] },
      { file: HOME, anchor: "watch-desk", frames: ["03.1"] }
    ],
    notes:
      "Lit only when something is really going out or really on your screen. It switches on once with a single flicker (1.6 s) and holds: never blinks, never pulses. Reduced motion: it just appears lit. On viewer screens only the player shows it.",
    states: [
      {
        label: "On the ground: unlit, lit, stand by, off air",
        render: () => (
          <div className="gal-row">
            <Tally state="unlit" />
            <Tally state="lit" flicker={false} />
            <Tally state="standby" />
            <Tally state="unlit">OFF AIR</Tally>
          </div>
        )
      },
      {
        label: "On a picture",
        render: () => (
          <div className="gal-screen" style={{ width: "100%" }}>
            <div className="gal-row">
              <Tally state="unlit" on="picture" />
              <Tally state="lit" on="picture" flicker={false} />
              <Tally state="standby" on="picture" />
            </div>
          </div>
        )
      },
      {
        label: "Sizes: sm (app headers, players), md (the style guide's sign), lg (master control's sign-on)",
        render: () => (
          <div className="gal-row">
            <Tally state="lit" size="sm" flicker={false} />
            <Tally state="lit" size="md" flicker={false} />
            <Tally state="lit" size="lg" flicker={false} />
          </div>
        )
      },
      {
        label: "Switching on (press Sign on to watch the flicker)",
        render: () => <TallyDemo size="lg" on="ground" />
      }
    ]
  },
  {
    id: "button",
    name: "Button",
    group: "Primitives",
    from: [
      { file: STYLE, anchor: "components" },
      { file: MC, anchor: "flow-a", frames: ["A.6"] },
      { file: "viewer/opencast-station-pages.html", anchor: "station", frames: ["01.1"] }
    ],
    notes:
      "Primary (signal fill, one per view), ghost, text, and ink (Sign on: anything that changes what goes out to viewers). On a station's colour: white filled or white outline. Verb first, sentence case.",
    states: [
      {
        label: "Variants",
        render: () => (
          <div className="gal-row">
            <Button variant="primary">Tune in</Button>
            <Button variant="ghost">Add to presets</Button>
            <Button variant="text">Full guide</Button>
            <Button variant="ink">Sign on</Button>
          </div>
        )
      },
      {
        label: "Sizes and block",
        render: () => (
          <div className="gal-col" style={{ width: "100%" }}>
            <div className="gal-row">
              <Button variant="ghost" size="sm">Full guide</Button>
              <Button variant="primary" size="sm">Remind me</Button>
              <Button variant="ink" size="lg">Sign on</Button>
            </div>
            <Button variant="primary" block>Save CIVC 7.1 and go back</Button>
          </div>
        )
      },
      {
        label: "With icons, set, disabled",
        note: "Disabled isn't drawn in the references: the button keeps its shape and fades.",
        render: () => (
          <div className="gal-row">
            <Button variant="ghost" icon="share">Share</Button>
            <Button variant="ghost" set>Preset 1</Button>
            <Button variant="primary" disabled>Sign on</Button>
            <IconButton icon="down" label="Channel down" />
            <IconButton icon="up" label="Channel up" />
            <IconButton icon="pause" label="Pause" />
            <IconButton icon="x" label="Close" bare />
          </div>
        )
      },
      {
        label: "On a station's colour",
        render: () => (
          <div className="gal-row" style={{ background: "#8C3B7A", padding: 16, borderRadius: "var(--r-control)", width: "100%" }}>
            <Button variant="on-station">Tune in</Button>
            <Button variant="line-station">Preset 1</Button>
            <Button variant="line-station">Pledge</Button>
          </div>
        )
      }
    ]
  },
  {
    id: "tag",
    name: "Tag",
    group: "Primitives",
    from: [
      { file: STYLE, anchor: "components" },
      { file: HOME, anchor: "home-desk", frames: ["01.1"] }
    ],
    notes: "Live is red text with a dot: the only red that isn't the tally. External is dashed. Words carry the meaning, never colour alone.",
    states: [
      {
        label: "On the ground",
        render: () => (
          <div className="gal-row">
            <Tag variant="live">Live</Tag>
            <Tag variant="next">Next at 9:30</Tag>
            <Tag variant="listed">External</Tag>
            <Tag variant="off">Off air</Tag>
            <Tag>Radio band</Tag>
            <Tag variant="standby">Needs a description</Tag>
            <Tag variant="solid">Yours</Tag>
          </div>
        )
      },
      {
        label: "On a picture",
        render: () => (
          <div className="gal-screen" style={{ width: "100%" }}>
            <div className="gal-row">
              <Tag variant="live" onPicture>Live</Tag>
              <Tag onPicture>Preview, muted</Tag>
            </div>
          </div>
        )
      }
    ]
  }  ,
  {
    id: "field",
    name: "Field",
    group: "Primitives",
    from: [
      { file: MC, anchor: "flow-a", frames: ["A.1"] },
      { file: FUND, anchor: "business", frames: ["01.1"] },
      { file: SPOTS, anchor: "rate", frames: ["03.1"] },
      { file: ORDERS, anchor: "brief", frames: ["02.1"] },
      { file: BSET, anchor: "profile", frames: ["01.1"] },
      { file: RIGHTS, anchor: "counter", frames: ["03.1"] },
      { file: HOME, anchor: "first", frames: ["08.1"] },
      { file: YOU, anchor: "signin", frames: ["01.1"] }
    ],
    notes:
      "A real input in the raised box, with its label above and one line under it: help (quiet), ok (signal, with a check) or a problem (standby amber, with the warning sign; not drawn in the references). Amounts and codes are mono. The select is a real select drawn like the others.",
    states: [
      {
        label: "Label, value, ok line",
        render: () => (
          <div style={STACK}>
            <Field label="Station name" defaultValue="Inland Beat" />
            <Field label="Call sign" defaultValue="BEAT" ok="BEAT is free" />
          </div>
        )
      },
      {
        label: "Help line, placeholder, aside on the label",
        render: () => (
          <div style={STACK}>
            <Field label="Name" labelAside="Everyone sees this" defaultValue="Orange Street Coffee" />
            <Field label="ZIP code" inputMode="numeric" placeholder="92373" help="Or use your location." />
          </div>
        )
      },
      {
        label: "A problem",
        note: "Not drawn in the references: the problem reads in standby amber with the warning sign, and the words say what's wrong.",
        render: () => (
          <div style={{ width: "100%" }}>
            <Field label="Call sign" defaultValue="CIVC" error="CIVC is taken in the Inland Empire." />
          </div>
        )
      },
      {
        label: "Mono amounts",
        render: () => (
          <div style={{ display: "grid", gridTemplateColumns: "200px 1fr 1fr", gap: 14, width: "100%" }}>
            <div>
              <Field label="Rate" mono defaultValue={money($(8))} />
            </div>
            <Field label="In total" mono defaultValue={money($(300))} />
            <Field label="Most per day" mono defaultValue={money($(12))} />
          </div>
        )
      },
      {
        label: "Leading icon, end button, small",
        render: () => (
          <div style={STACK}>
            <Field label="Attach the permission" icon="link" defaultValue="westside-licence-2023.pdf" />
            <Field label="Market" readOnly defaultValue="Inland Empire" end={<Button variant="text" style={{ fontSize: 13 }}>Change</Button>} />
            <Field aria-label="Search programs" size="sm" icon="search" placeholder="Search programs" />
          </div>
        )
      },
      {
        label: "Textarea",
        render: () => (
          <div style={{ width: "100%" }}>
            <TextAreaField label="What it's about" defaultValue="Gift cards for the holidays. Warm, a little funny. Our regulars, the big mugs, the window on Orange Street in the evening." />
          </div>
        )
      },
      {
        label: "Select",
        render: () => (
          <div style={{ width: "100%" }}>
            <SelectField label="Category" labelAside="Stations see this" defaultValue="food">
              <option value="food">Coffee and food</option>
              <option value="music">Music</option>
              <option value="public">Public affairs</option>
            </SelectField>
          </div>
        )
      },
      {
        label: "Disabled",
        note: "Not drawn in the references: the field keeps its shape and fades, as a disabled button does.",
        render: () => (
          <div style={{ width: "100%" }}>
            <Field label="Email" defaultValue="kai@example.com" disabled />
          </div>
        )
      }
    ]
  },
  {
    id: "toggle",
    name: "Toggle",
    group: "Primitives",
    from: [
      { file: HOME, anchor: "guide", frames: ["05.1"] },
      { file: YOU, anchor: "settings", frames: ["05.1"] },
      { file: YOU, anchor: "pledges", frames: ["04.1"] },
      { file: FUND, anchor: "fund", frames: ["02.1"] },
      { file: STN, anchor: "phone", frames: ["05.1"] },
      { file: BSET, anchor: "notify", frames: ["04.1"] }
    ],
    notes:
      "A real switch (role=\"switch\"): signal when on, line grey when off. Alerts that protect what's on air can't be turned off, so they show a lock instead of a toggle, and the row says \"Always on\".",
    states: [
      {
        label: "On and off",
        render: () => (
          <div style={{ width: "100%" }}>
            <ToggleDemo start title="Show muted previews" helper="On the dial and the guide" />
            <ToggleDemo start={false} title="Top up automatically" helper={`Add ${money($(250), { trimCents: true })} whenever what's available drops below 3 days of airings`} />
          </div>
        )
      },
      {
        label: "Locked: always on",
        render: () => (
          <div style={{ width: "100%" }}>
            <Row title="Dead air coming" helper="30 and 12 minutes before a gap. Always on">
              <ToggleLock />
            </Row>
            <Row title="Signal lost" helper="A live source drops for more than a minute">
              <Toggle checked label="Signal lost" />
            </Row>
            <Row title="Spots about to pause" helper="At 3 days and 1 day of airings left. Always on">
              <ToggleLock />
            </Row>
          </div>
        )
      },
      {
        label: "Locked with words",
        render: () => (
          <div style={{ width: "100%" }}>
            <Row title="Take money out" helper="Back to the bank it came from">
              <ToggleLock>Owner only</ToggleLock>
            </Row>
          </div>
        )
      },
      {
        label: "Disabled",
        note: "Not drawn in the references: fades like a disabled button.",
        render: () => <Toggle checked={false} disabled label="Keep playing in the background" />
      }
    ]
  },
  {
    id: "segmented",
    name: "Segmented",
    group: "Primitives",
    from: [
      { file: HOME, anchor: "home-desk", frames: ["01.1", "02.1"] },
      { file: HOME, anchor: "m-more", frames: ["07.1"] },
      { file: YOU, anchor: "settings", frames: ["05.1"] },
      { file: MC, anchor: "flow-a", frames: ["A.1", "A.4", "A.5"] }
    ],
    notes: "One choice of two to four, the chosen one in ink. A radio group: the arrow keys move the choice. Smaller in settings rows and inside table rows.",
    states: [
      {
        label: "Two and three choices",
        render: () => (
          <div className="gal-col">
            <SegDemo label="Band" start="tv" options={[{ value: "tv", label: "TV band" }, { value: "radio", label: "Radio band" }]} />
            <SegDemo label="Breaks" start="30" options={[{ value: "after", label: "After every program" }, { value: "30", label: "Every 30 min" }, { value: "none", label: "None" }]} />
          </div>
        )
      },
      {
        label: "Small, in a settings row",
        render: () => (
          <div style={{ width: "100%" }}>
            <Row title="Show captions" helper="When a station provides them">
              <SegDemo size="sm" label="Show captions" start="on" options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }, { value: "muted", label: "Muted only" }]} />
            </Row>
          </div>
        )
      },
      {
        label: "Compact, in a table row",
        render: () => <SegDemo size="compact" label="Breaks on this translator" start="spots" options={[{ value: "spots", label: "Air spots" }, { value: "slate", label: "Station ID slate" }]} />
      },
      {
        label: "Full width",
        render: () => (
          <div style={{ width: "100%" }}>
            <SegDemo block label="How often" start="monthly" options={[{ value: "monthly", label: "Monthly" }, { value: "once", label: "Once" }]} />
          </div>
        )
      }
    ]
  },
  {
    id: "chip",
    name: "Chip and ChipRow",
    group: "Primitives",
    from: [
      { file: HOME, anchor: "home-desk", frames: ["01.1"] },
      { file: MC, anchor: "flow-b", frames: ["B.1"] },
      { file: SPOTS, anchor: "rate", frames: ["03.1"] },
      { file: LIVE, anchor: "listings", frames: ["03.1"] },
      { file: STN, anchor: "breaks", frames: ["02.1"] }
    ],
    notes:
      "Filters and picks. A row that scrolls sideways for filters (one choice: a radio group), or a set that wraps for picks (several: toggles). A chosen chip is outlined in ink; in a list of what's kept out, chosen chips are struck through.",
    states: [
      {
        label: "One choice, scrolling row",
        render: () => (
          <div style={{ width: "100%", maxWidth: 420 }}>
            <ChipSingleDemo />
          </div>
        )
      },
      {
        label: "Several choices, wrapping",
        render: () => <ChipMultiDemo label="Times of day" start={["Afternoons", "Evenings, 6 to 11 pm"]} options={["Mornings", "Afternoons", "Evenings, 6 to 11 pm", "Late night"]} />
      },
      {
        label: "Kept out: chosen chips struck through",
        render: () => <ChipMultiDemo strike label="Categories BEAT won't air" start={["Alcohol", "Gambling", "Political"]} options={["Alcohol", "Gambling", "Cannabis", "Political", "Payday loans", "Vaping"]} />
      },
      {
        label: "On its own",
        render: () => (
          <div className="gal-row">
            <Chip on>Any terms</Chip>
            <Chip>Barter</Chip>
            <Chip disabled>Cash</Chip>
          </div>
        )
      }
    ]
  },
  {
    id: "tabs",
    name: "Tabs",
    group: "Primitives",
    from: [
      { file: MARKET, anchor: "browse", frames: ["01.1"] },
      { file: OFFER, anchor: "offered", frames: ["01.1"] },
      { file: ORDERS, anchor: "quote", frames: ["03.1"] },
      { file: MC, anchor: "flow-a", frames: ["A.4"] },
      { file: SCHEDULE, anchor: "day", frames: ["01"] }
    ],
    notes: "A tablist. Underlined for a page's views, with a mono standby count of what's waiting; bordered buttons for the program log's days; pills for the Schedule's tabs (A246). Arrow keys, Home and End move and show.",
    states: [
      { label: "Underlined, with a count", render: () => <TabsDemo variant="underline" /> },
      { label: "Days", render: () => <TabsDemo variant="days" /> },
      { label: "Pills (the Schedule)", render: () => <TabsDemo variant="pill" /> }
    ]
  },
  {
    id: "tooltip",
    name: "Tooltip",
    group: "Primitives",
    from: [{ file: STYLE, anchor: "components" }],
    notes:
      "New: not drawn in the references. Made from the tokens: raised ground, ink text, the control corner, 13px. It shows on hover (after a moment) and on keyboard focus, hides on Escape, and describes its control; it never holds anything to press.",
    states: [
      {
        label: "Above and below",
        render: () => (
          <div className="gal-row" style={{ padding: "40px 0" }}>
            <Tooltip content="Channel up" open>
              <IconButton icon="up" label="Channel up" />
            </Tooltip>
            <Tooltip content="On air only" placement="bottom" open>
              <Button variant="ghost" size="sm" aria-disabled="true">Cue a break</Button>
            </Tooltip>
          </div>
        )
      },
      {
        label: "On hover and focus",
        render: () => (
          <div className="gal-row" style={{ padding: "40px 0 8px" }}>
            <Tooltip content="Arrow keys change channel">
              <Button variant="ghost" size="sm">Channel</Button>
            </Tooltip>
          </div>
        )
      }
    ]
  },
  {
    id: "toast",
    name: "Toast",
    group: "Primitives",
    from: [
      { file: HOME, anchor: "m-more", frames: ["07.1"] },
      { file: MC, anchor: "flow-b", frames: ["B.3"] },
      { file: MC, anchor: "flow-c", frames: ["C.3"] },
      { file: OFFER, anchor: "phone", frames: ["05.2"] },
      { file: FUND, anchor: "phone", frames: ["06.2"] }
    ],
    notes:
      "In place of a confirmation step, where the pane already showed every fact: one line, in ink, with Undo. One at a time; it goes after 5 seconds, and hover or focus holds it. role=\"status\".",
    states: [
      {
        label: "With Undo",
        render: () => (
          <div className="gal-col">
            <Toast message={`Reminder set for Beat Tape Live, ${clock(SAT(21))}`} onUndo={() => {}} />
            <Toast message={`Newsreel hour is in your log from tomorrow at ${clock(SAT(20))}`} onUndo={() => {}} />
            <Toast message={`3 spots added. They start in the ${clock(SAT(20, 44))} break.`} onUndo={() => {}} />
            <Toast message={`${money($(250), { trimCents: true })} is on its way`} onUndo={() => {}} />
          </div>
        )
      },
      {
        label: "Live: shown by useToast, over a screen",
        note: "Press Remind me. The toast sits 90px up (clear of the web player bar), goes after 5 s, and Undo takes the reminder back.",
        render: () => (
          <Stage height={200}>
            <ToastProvider placement="container">
              <div style={{ padding: 16 }}>
                <ToastLive />
              </div>
            </ToastProvider>
          </Stage>
        )
      }
    ]
  },
  {
    id: "modal",
    name: "Modal",
    group: "Primitives",
    stacked: true,
    from: [
      { file: YOU, anchor: "presets", frames: ["03.1"] },
      { file: HOME, anchor: "guide", frames: ["05.1"] },
      { file: HOME, anchor: "m-station", frames: ["06.1"] },
      { file: HOME, anchor: "m-more", frames: ["07.1"] },
      { file: YOU, anchor: "pledges", frames: ["04.1"] },
      { file: OFFER, anchor: "approve", frames: ["03.1"] },
      { file: RIGHTS, anchor: "counter", frames: ["03.1"] }
    ],
    notes:
      "On the web: a panel on the scrim with a head (title, subtitle, close), a body and a foot of equal buttons. role=\"dialog\", aria-modal; focus moves in and is trapped, Escape and the scrim close it, and focus returns to what opened it. A station's modal opens with its colour band. On the phone the same content is a Sheet.",
    states: [
      {
        label: "Head, body, foot",
        render: () => (
          <Stage height={420}>
            <Modal
              open
              onClose={() => {}}
              placement="container"
              manageFocus={false}
              width={520}
              eyebrow="All six keys are taken"
              title="Where should PREP 31.1 go?"
              footer={<Button variant="primary">Save PREP 31.1</Button>}
            >
              <ChoiceDemo variant="option" options={PRESET_OPTIONS} start="6" label="Where should PREP 31.1 go?" />
            </Modal>
          </Stage>
        )
      },
      {
        label: "Narrow, with a subtitle and two buttons",
        render: () => (
          <Stage height={380}>
            <ListingModal />
          </Stage>
        )
      },
      {
        label: "With a station band",
        note: "The band here is a stand-in; apps pass the broadcast group's StationBand. The close button sits at the band's bottom right, in white.",
        render: () => (
          <Stage height={500}>
            <Modal
              open
              onClose={() => {}}
              placement="container"
              manageFocus={false}
              label="Inland Civic"
              stationBand={<DemoBand colour="#2E6B5A" ch="7.1" cs="CIVC" name={<>Inland Civic<br />Redlands, Inland Empire</>} closeRoom />}
              footer={
                <>
                  <Button variant="primary">Tune in</Button>
                  <Button variant="ghost">Add to presets</Button>
                </>
              }
            >
              <CivcBody carried="This week's council meetings across the Inland Empire, in an hour" />
            </Modal>
          </Stage>
        )
      },
      {
        label: "Stacked foot",
        render: () => (
          <Stage height={330}>
            <Modal
              open
              onClose={() => {}}
              placement="container"
              manageFocus={false}
              width={440}
              title="Pledge to Inland Beat"
              subtitle="BEAT 12.1 is run by listeners and local underwriters."
              footStacked
              footer={
                <>
                  <Button variant="primary">Save changes</Button>
                  <Button variant="ghost">Stop pledging</Button>
                </>
              }
            >
              <SegDemo block label="How often" start="monthly" options={[{ value: "monthly", label: "Monthly" }, { value: "once", label: "Once" }]} />
            </Modal>
          </Stage>
        )
      },
      {
        label: "Open it for real",
        note: "Opens over the whole window: Tab stays inside, Escape or the scrim closes, and focus comes back to the button.",
        render: () => <ModalLive />
      }
    ]
  },
  {
    id: "drawer",
    name: "Drawer",
    group: "Primitives",
    frame: { width: 1024, height: 560 },
    from: [{ file: SCH, anchor: "edit", frames: ["04"] }],
    notes: "A246: the modal's head and body along the right edge, over what it's for (the Schedule's Add drawer). role=\"dialog\", aria-modal; focus moves in and is trapped, Escape and the scrim close it, and focus returns to what opened it. The whole width on the phone.",
    states: [
      {
        label: "Add at a time",
        render: () => (
          <Drawer open onClose={() => {}} placement="container" manageFocus={false} title="Add at 11:40 pm" subtitle="20 min free, until Late Crate, ep. 13 at 12:00 am">
            <p style={{ margin: "16px 0 0" }}>What can go in the space.</p>
          </Drawer>
        )
      }
    ]
  },
  {
    id: "sheet",
    name: "Sheet",
    group: "Primitives",
    frame: { width: 390, height: 844 },
    from: [
      { file: HOME, anchor: "m-station", frames: ["06.2"] },
      { file: MC, anchor: "flow-p", frames: ["P.2"] },
      { file: OFFER, anchor: "phone", frames: ["05.1"] },
      { file: BSET, anchor: "phone", frames: ["05.2"] }
    ],
    notes:
      "On the phone: the modal's content and buttons rising from the bottom edge, with a grab handle. Dragging the handle down closes it; dragging up can open the full page (the station preview). role=\"dialog\", aria-modal, focus trapped, Escape closes.",
    states: [
      {
        label: "With a station band",
        render: () => (
          <Sheet
            open
            onClose={() => {}}
            placement="container"
            manageFocus={false}
            label="Inland Civic"
            stationBand={<DemoBand colour="#2E6B5A" ch="7.1" cs="CIVC" name={<>Inland Civic<br />Redlands</>} />}
            footer={
              <>
                <Button variant="primary">Tune in</Button>
                <Button variant="ghost">Add to presets</Button>
              </>
            }
          >
            <CivcBody phone carried="Carried by 6 stations" />
          </Sheet>
        )
      },
      {
        label: "Head, choices, one button",
        render: () => (
          <Sheet
            open
            onClose={() => {}}
            placement="container"
            manageFocus={false}
            eyebrow="BEAT 12.1, on air"
            title="Dead air in 12 min"
            subtitle={`Nothing is scheduled after ${clock(SAT(23, 40))}.`}
            footer={<Button variant="primary">Fill the gap</Button>}
          >
            <ChoiceDemo
              variant="option"
              label="Fill the gap"
              start="repeat"
              options={[
                { value: "repeat", title: "Repeat from your library", helper: `Late Crate 12 to 15, until ${clock(SAT(26))}` },
                { value: "carry", title: "Carry Slow Hours", helper: "From HALL 90.8, barter, runs all night" },
                { value: "off", title: `Sign off at ${clock(SAT(23, 40))}`, helper: `Back at ${clock(SAT(30))}` }
              ]}
            />
          </Sheet>
        )
      },
      {
        label: "Open it: drag the handle",
        render: () => <SheetLive />
      }
    ]
  },
  {
    id: "notice",
    name: "Notice",
    group: "Primitives",
    from: [
      { file: MC, anchor: "flow-a", frames: ["A.2", "A.4", "A.6"] },
      { file: SPOTS, anchor: "mirror", frames: ["05.1"] },
      { file: SPOTS, anchor: "paused", frames: ["04.1"] },
      { file: OFFER, anchor: "offered", frames: ["01.1"] }
    ],
    notes:
      "Standby amber means committed-not-on-air or needs attention; plain is for information. A bar with a sign and one action, a notice with a swatch and a second line, a request with its channel, or a larger banner. The words carry the meaning, and a standby notice also says \"Needs attention\" to screen readers.",
    states: [
      {
        label: "Standby bar with an action",
        render: () => (
          <div style={{ width: "100%" }}>
            <Notice title={`Dead air from ${clockRange(SAT(23, 40), SAT(26))}.`} action={<Button size="sm">Fill it</Button>}>
              2 hr 20 min with nothing scheduled.
            </Notice>
          </div>
        )
      },
      {
        label: "Plain bar",
        render: () => (
          <div style={{ width: "100%" }}>
            <Notice tone="plain">A station needs at least one program and a station ID to sign on.</Notice>
          </div>
        )
      },
      {
        label: "With a swatch and a second line",
        render: () => (
          <div className="gal-col" style={{ width: "100%", alignItems: "stretch" }}>
            <Notice
              swatch="#6B4A2B"
              title="Orange Street Coffee paused Fall menu. Its budget is spent."
              detail="It had 1:30 in tonight's breaks. Filled from your backup rotation: Redlands Hardware"
              action={<Button size="sm">Change</Button>}
            />
            <Notice
              tone="plain"
              swatch="#6B4A2B"
              title="Fall menu is back. Orange Street raised its budget."
              detail="It isn't in your rotation now. About 17 days of budget"
              action={<Button size="sm">Add it back</Button>}
            />
          </div>
        )
      },
      {
        label: "A request, with its channel",
        render: () => (
          <div style={{ width: "100%" }}>
            <Notice
              swatch="#33507A"
              channel="88.4"
              title="NITE wants to carry Late Crate"
              detail={`Weeknights at ${clock(SAT(25))}, on barter terms. Asked 2 hours ago`}
              action={<Button size="sm">Review</Button>}
            />
          </div>
        )
      },
      {
        label: "Banner",
        render: () => (
          <div style={{ width: "100%" }}>
            <Notice layout="banner" tag={<Tag variant="standby">Paused, budget spent</Tag>} title={`All ${money($(300), { trimCents: true })} of Fall menu's budget has been spent.`}>
              It's out of the spot market and stations can't schedule it. Your balance still has {money($(236.1))} available.
            </Notice>
          </div>
        )
      }
    ]
  },
  {
    id: "menu",
    name: "Menu",
    group: "Primitives",
    from: [
      { file: MC, anchor: "flow-a", frames: ["A.2"] },
      { file: STN, anchor: "team", frames: ["03.1"] },
      { file: YOU, anchor: "presets", frames: ["03.1"] },
      { file: LIVE, anchor: "listings", frames: ["04.1"] }
    ],
    notes:
      "The \"···\" row menu: a small button named More (name the row when a page has many), opening a list of actions drawn like the station switcher's popover. Arrow keys, Home and End move; Enter chooses; Escape and Tab close it and focus goes back to the button. Taking something away is in the live red, as settings' danger links are.",
    states: [
      {
        label: "Closed",
        render: () => (
          <div style={{ width: "100%" }}>
            <Row title="Late Crate, ep. 15" helper="Ready for air">
              <Menu label="More for Late Crate, ep. 15" items={[{ label: "Export to IPFS", onSelect: () => {} }]} />
            </Row>
          </div>
        )
      },
      {
        label: "Open",
        render: () => (
          <MenuDemo
            open
            label="More for PREP 31.1"
            items={[
              { label: "Give it a key", onSelect: () => {} },
              { label: "Remove", onSelect: () => {}, danger: true }
            ]}
          />
        )
      }
    ]
  },
  {
    id: "choice-list",
    name: "ChoiceList",
    group: "Primitives",
    from: [
      { file: MC, anchor: "flow-a", frames: ["A.4"] },
      { file: MC, anchor: "flow-b", frames: ["B.2"] },
      { file: MARKET, anchor: "program", frames: ["02.1"] },
      { file: FUND, anchor: "fund", frames: ["02.1"] },
      { file: YOU, anchor: "presets", frames: ["03.1"] },
      { file: RIGHTS, anchor: "counter", frames: ["03.1"] }
    ],
    notes:
      "Radio rows with a title and a helper line (a radiogroup; arrow keys move the choice). Terms carry a mono price at the end; funding methods are bordered boxes with the fee, the chosen one raised and outlined in signal.",
    states: [
      { label: "Options", render: () => <div style={{ width: "100%" }}><ChoiceDemo variant="option" options={FILL_OPTIONS} start="repeat" label={`Fill ${clockRange(SAT(23, 40), SAT(26))}`} /></div> },
      { label: "Nothing chosen yet", render: () => <div style={{ width: "100%" }}><ChoiceDemo variant="option" options={[{ value: "made", title: "We made it", helper: "BEAT owns the recording outright" }, { value: "permission", title: "The owner gave permission", helper: "Attach the permission or licence" }, { value: "public", title: "It's in the public domain", helper: "Say where it came from" }]} start={null} label="Why can BEAT air it?" /></div> },
      { label: "Terms with a price", render: () => <div style={{ width: "100%" }}><ChoiceDemo variant="term" options={TERM_OPTIONS} start="cash" label="Terms" /></div> },
      { label: "Funding methods with a fee", render: () => <div style={{ width: "100%" }}><ChoiceDemo variant="method" options={METHOD_OPTIONS} start="clear" label="How to add money" /></div> },
      {
        label: "A choice that can't be made",
        note: "Not drawn in the references: it fades and the arrow keys pass over it.",
        render: () => <div style={{ width: "100%" }}><ChoiceDemo variant="option" options={[PRESET_OPTIONS[0]!, { ...PRESET_OPTIONS[1]!, disabled: true }, PRESET_OPTIONS[2]!]} start="3" label="Where should PREP 31.1 go?" /></div>
      }
    ]
  },
  {
    id: "checkbox",
    name: "Checkbox",
    group: "Primitives",
    from: [
      { file: HOME, anchor: "m-more", frames: ["07.1"] },
      { file: RIGHTS, anchor: "counter", frames: ["03.1"] },
      { file: OFFER, anchor: "offer", frames: ["02.1"] }
    ],
    notes: "A real checkbox with its words: the bold label, words that run on after it, or a helper line. Checked is the signal fill with a check.",
    states: [
      {
        label: "Checked, words run on",
        render: () => (
          <CheckDemo start label="Credit me on air">
            as "Kai M." in BEAT's monthly thank-you to members
          </CheckDemo>
        )
      },
      {
        label: "Checked, a statement",
        render: () => (
          <CheckDemo start label="I understand this answer goes to Westside Tapes with BEAT's legal name and contact,">
            and that a false answer has legal consequences.
          </CheckDemo>
        )
      },
      {
        label: "Unchecked, with a helper line",
        render: () => <CheckDemo start={false} label="Cash plus barter" helper="A lower fee, and you fill part of each hour's breaks." />
      },
      {
        label: "Disabled",
        note: "Not drawn in the references: fades like a disabled button.",
        render: () => (
          <div style={{ width: "100%" }}>
            <Checkbox checked disabled label="Credit me on air" />
          </div>
        )
      }
    ]
  },
  {
    id: "amount-picker",
    name: "AmountPicker",
    group: "Primitives",
    from: [
      { file: HOME, anchor: "m-more", frames: ["07.1"] },
      { file: YOU, anchor: "pledges", frames: ["04.1"] },
      { file: FUND, anchor: "fund", frames: ["02.1", "06.1"] },
      { file: SPOTS, anchor: "paused", frames: ["04.1", "06.2"] }
    ],
    notes:
      "Equal buttons, the chosen one in ink (a radiogroup; arrow keys move). The pledge uses the text face; business amounts are mono. Other opens a mono field underneath. Amounts come from money().",
    states: [
      { label: "Pledge amounts", render: () => <AmountDemo variant="text" label="How much a month" amounts={[$(5), $(10), $(20)]} start={$(10)} /> },
      { label: "Business amounts, mono", render: () => <AmountDemo variant="mono" label="How much" amounts={[$(100), $(250), $(500)]} start={$(250)} /> },
      { label: "Three, no Other", render: () => <AmountDemo variant="mono" label="Raise the budget by" other={false} amounts={[$(100), $(200), $(300)]} start={$(200)} /> },
      { label: "Other, typed", render: () => <AmountDemo variant="text" label="How much a month" amounts={[$(5), $(10), $(20)]} start="other" otherText="12.50" /> },
      {
        label: "Other, below the minimum",
        note: "The words are new copy (the pledge's minimum is $1.00).",
        render: () => <AmountDemo variant="text" label="How much a month" amounts={[$(5), $(10), $(20)]} start="other" otherText="0.50" error={`Pledges start at ${money($(1))}.`} />
      }
    ]
  },
  {
    id: "avatar",
    name: "Avatar",
    group: "Primitives",
    from: [
      { file: HOME, anchor: "home-desk", frames: ["01.1"] },
      { file: YOU, anchor: "you", frames: ["02.1"] },
      { file: STN, anchor: "team", frames: ["03.1"] },
      { file: YOU, anchor: "phone", frames: ["06.2"] }
    ],
    notes: "A person as their initials in a circle, named by their name. 34px in headers, 40 in team rows, 46 on the phone's You, 56 on the You page; a ring marks the page you're on.",
    states: [
      {
        label: "Sizes",
        render: () => (
          <div className="gal-row">
            <Avatar name="Kai M." />
            <Avatar name="Marcus Reyes" size={40} />
            <Avatar name="Jen Park" size={46} />
            <Avatar name="Kai M." size={56} />
          </div>
        )
      },
      { label: "You're on your page", render: () => <Avatar name="Kai M." current /> }
    ]
  },
  {
    id: "kbd",
    name: "Kbd",
    group: "Primitives",
    from: [
      { file: HOME, anchor: "home-desk", frames: ["01.1"] },
      { file: TV, anchor: "watching", frames: ["02.1"] }
    ],
    notes: "A key, as a small outlined sign: the / that opens search on the web, and the TV's hint keys at ten feet.",
    states: [
      {
        label: "In the search box",
        render: () => (
          <div style={{ display: "flex", alignItems: "center", gap: 8, width: 300, height: 38, padding: "0 12px", background: "var(--raised)", border: "1px solid var(--hair)", borderRadius: "var(--r-control)", color: "var(--ink-50)", fontSize: 14 }}>
            <Icon name="search" />
            Search stations and programs
            <span style={{ marginLeft: "auto", display: "inline-flex" }}>
              <Kbd>/</Kbd>
            </span>
          </div>
        )
      },
      {
        label: "TV hint keys",
        render: () => (
          <div className="gal-row" style={{ fontSize: 24, color: "var(--ink-70)" }}>
            {[["▲▼", "Channels"], ["OK", "Guide"], ["◀", "Presets"], ["Back", "Last channel, CIVC 7.1"]].map(([k, w]) => (
              <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                <Kbd size="tv">{k}</Kbd>
                {w}
              </span>
            ))}
          </div>
        )
      }
    ]
  }
]);
