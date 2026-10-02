import { useState, type ReactNode } from "react";
import {
  BalanceBar,
  BalanceChip,
  Button,
  Checks,
  Funnel,
  KeyValueList,
  Lines,
  LineChart,
  Movements,
  PermissionsTable,
  PromiseList,
  Reach,
  Runway,
  SplitBar,
  StatRow,
  StepRail,
  Table,
  Tag,
  Timeline,
  checksSummary,
  clock,
  money,
  type Check,
  type Column
} from "@opencast/ui";
import { specimens } from "../registry";

const FUNDING = "business/opencast-biz-funding.html";
const RESULTS = "business/opencast-biz-results.html";
const SPOTS = "business/opencast-biz-spots.html";
const ORDERS = "business/opencast-production-orders.html";
const BIZ_SETTINGS = "business/opencast-biz-settings.html";
const EARNINGS = "control/opencast-earnings.html";
const RIGHTS = "control/opencast-rights.html";
const STATION_SETTINGS = "control/opencast-station-settings.html";
const MC = "control/opencast-master-control.html";
const DESK = "desk/opencast-network-desk.html";

/** The market's clock: the Inland Empire. */
const TZ = "America/Los_Angeles";
/** Saturday, September 26, 2026, `min` minutes after 6:00 pm, Inland Empire time. */
const sat = (min: number) => new Date(Date.parse("2026-09-26T18:00:00-07:00") + min * 60_000);
const $ = (dollars: number) => Math.round(dollars * 1_000_000);

/** Keeps a specimen at the width it has in its frame, so boxes compare like for like. */
function W({ w, children }: { w: number; children: ReactNode }) {
  return <div style={{ width: "100%", maxWidth: w }}>{children}</div>;
}

/** A station's colour square, as the results table draws it (.bs .sw). */
function Swatch({ colour }: { colour: string }) {
  return <span style={{ display: "block", width: 14, height: 14, borderRadius: 3, background: colour }} aria-hidden="true" />;
}

/* ---------- Audience data, from the earnings frame (tuned in, every few minutes) ---------- */
const TONIGHT: Array<[number, number]> = [
  [0, 120], [10, 150], [20, 170], [30, 176], [45, 190], [60, 200], [75, 210], [90, 205], [100, 212], [110, 226],
  [118, 241], [120, 228], [122, 236], [130, 262], [140, 284], [148, 301], [149, 270], [151, 290], [158, 300], [162, 312]
];
const LAST_SATURDAY: Array<[number, number]> = [
  [0, 110], [20, 150], [40, 168], [60, 190], [80, 200], [100, 220], [120, 250], [140, 290], [160, 310], [178, 330],
  [180, 300], [182, 360], [200, 395], [220, 410], [238, 402], [240, 370], [242, 395], [260, 330], [280, 280], [300, 240]
];
const BREAKS: Array<[number, number]> = [[118, 120], [148.5, 150.5], [178.5, 180.5], [238, 240], [268.5, 270.5]];
const points = (list: Array<[number, number]>) => list.map(([m, value]) => ({ at: sat(m), value }));
const breaks = BREAKS.map(([a, b]) => ({ start: sat(a), end: sat(b) }));

/* ---------- Tables ---------- */
interface StationRow {
  colour: string;
  ch: string;
  cs: string;
  kind: string;
  airings: number;
  avg: number;
  spent: number;
  customers: number;
  per: number;
}
const BY_STATION: StationRow[] = [
  { colour: "#8C3B7A", ch: "12.1", cs: "BEAT", kind: "Music", airings: 62, avg: 258, spent: $(127.97), customers: 21, per: $(6.09) },
  { colour: "#2E6B5A", ch: "7.1", cs: "CIVC", kind: "Public affairs", airings: 31, avg: 330, spent: $(81.84), customers: 9, per: $(9.09) },
  { colour: "#A3402A", ch: "18.1", cs: "SAZN", kind: "Food", airings: 25, avg: 195, spent: $(39.09), customers: 7, per: $(5.58) }
];
const BY_STATION_TOTAL: StationRow = { colour: "", ch: "", cs: "All stations", kind: "", airings: 118, avg: 264, spent: $(248.9), customers: 37, per: $(6.73) };
const stationColumns: Column<StationRow>[] = [
  { key: "colour", width: "14px", cell: (r) => (r.colour ? <Swatch colour={r.colour} /> : null) },
  { key: "ch", header: "Ch.", width: "52px", cell: (r) => <span className="oc-ch" style={{ fontWeight: 500 }}>{r.ch}</span> },
  { key: "cs", header: "Station", cell: (r) => <Lines title={r.cs} detail={r.kind || undefined} /> },
  { key: "airings", header: "Airings", width: "80px", kind: "amount", cell: (r) => r.airings },
  { key: "avg", header: "Avg tuned in", width: "100px", kind: "amount", cell: (r) => r.avg },
  { key: "spent", header: "Spent", width: "100px", kind: "amount" },
  { key: "customers", header: "Customers", width: "100px", kind: "amount", cell: (r) => r.customers },
  { key: "per", header: "Per customer", width: "130px", kind: "amount" }
];

interface Airing {
  id: string;
  at: Date;
  day: string;
  ch: string;
  cs: string;
  where: string;
  spot: string;
  aired: string;
  short?: boolean;
  tunedIn: number;
  cost: number;
}
const AIRINGS: Airing[] = [
  { id: "a1", at: new Date("2026-09-26T20:28:30-07:00"), day: "Sat", ch: "12.1", cs: "BEAT", where: "Before Saturday Reel", spot: "Fall menu", aired: ":30 of :30", tunedIn: 262, cost: $(2.1) },
  { id: "a2", at: new Date("2026-09-26T19:58:30-07:00"), day: "Sat", ch: "12.1", cs: "BEAT", where: "During Crate Session 02", spot: "Fall menu", aired: ":30 of :30", tunedIn: 241, cost: $(1.93) },
  { id: "a3", at: new Date("2026-09-26T18:29:00-07:00"), day: "Sat", ch: "18.1", cs: "SAZN", where: "During Tamales for forty", spot: "Pumpkin latte", aired: ":15 of :15", tunedIn: 188, cost: $(0.94) },
  { id: "a4", at: new Date("2026-09-25T21:59:48-07:00"), day: "Fri", ch: "7.1", cs: "CIVC", where: "After the town hall", spot: "Fall menu. The town hall ran over", aired: ":12 of :30", short: true, tunedIn: 175, cost: $(0.56) },
  { id: "a5", at: new Date("2026-09-25T19:40:00-07:00"), day: "Fri", ch: "7.1", cs: "CIVC", where: "During the town hall", spot: "Fall menu", aired: ":30 of :30", tunedIn: 410, cost: $(3.28) }
];
const airingColumns: Column<Airing>[] = [
  { key: "at", header: "Aired", width: "104px", kind: "time", cell: (r) => <span style={{ fontSize: 12.5, lineHeight: 1.35 }}>{`${r.day} ${clock(r.at, { timeZone: TZ, seconds: true })}`}</span> },
  { key: "st", header: "Station", width: "76px", cell: (r) => <span style={{ fontSize: 13.5 }}><span className="oc-mono" style={{ color: "var(--ink-70)" }}>{r.ch}</span> {r.cs}</span> },
  { key: "where", header: "In", cell: (r) => <Lines title={r.where} detail={r.spot} /> },
  { key: "aired", header: "Aired", width: "84px", kind: "amount", cell: (r) => <span className={r.short ? "oc-table__cell--short" : undefined}>{r.aired}</span> },
  { key: "tunedIn", header: "Tuned in", width: "64px", kind: "amount", cell: (r) => r.tunedIn },
  { key: "cost", header: "Cost", width: "60px", kind: "amount" }
];

interface ProgramRow {
  id: string;
  at: Date;
  title: string;
  from: string;
  avg: number;
  peak: number;
  stayed: string;
  now?: boolean;
}
const BY_PROGRAM: ProgramRow[] = [
  { id: "p1", at: sat(0), title: "Crate Session 02", from: "From your library", avg: 184, peak: 241, stayed: "62%" },
  { id: "p2", at: sat(120), title: "Late Crate, ep. 14", from: "From your library", avg: 262, peak: 301, stayed: "81%" },
  { id: "p3", at: sat(150), title: "Saturday Reel", from: "Carried from REEL 24.1", avg: 305, peak: 318, stayed: "On now", now: true }
];
const programColumns: Column<ProgramRow>[] = [
  { key: "at", header: "Aired", width: "80px", kind: "time", cell: (r) => clock(r.at, { timeZone: TZ, suffix: r.id === "p1" }) },
  { key: "title", header: "Program", cell: (r) => <Lines title={r.title} detail={r.from} /> },
  { key: "avg", header: "Average", width: "110px", kind: "amount", cell: (r) => r.avg },
  { key: "peak", header: "Peak", width: "110px", kind: "amount", cell: (r) => r.peak },
  { key: "stayed", header: "Stayed to the end", width: "130px", kind: "amount", cell: (r) => (r.now ? <span style={{ color: "var(--ink-50)" }}>{r.stayed}</span> : r.stayed) }
];

interface ClaimRow {
  id: string;
  received: string;
  at?: string;
  item: string;
  imported: string;
  from: string;
  role: string;
  state: ReactNode;
  action: string;
}
const CLAIMS: ClaimRow[] = [
  { id: "c1", received: "Today", at: "2026-09-26T15:12:00-07:00", item: "Crate Session 03", imported: "Imported from a link. Claim: the recording is theirs", from: "Westside Tapes LLC", role: "Says they own the master recording", state: <Tag variant="standby">Off air, 9 days to answer</Tag>, action: "Open" },
  { id: "c2", received: "August 19", item: "Late Crate, ep. 12", imported: "A sample in the second segment", from: "R. Delgado", role: "Composer", state: <Tag>Answered, back on air</Tag>, action: "View" },
  { id: "c3", received: "July 2", item: "BEAT station ID, v1", imported: "Background track", from: "Loopdeck", role: "Sample library", state: <Tag>Removed by BEAT</Tag>, action: "View" }
];
const claimColumns: Column<ClaimRow>[] = [
  {
    key: "received",
    header: "Received",
    width: "100px",
    kind: "time",
    cell: (r) => (
      <span style={{ display: "block", lineHeight: 1.35 }}>
        {r.received}
        {r.at && (
          <>
            <br />
            {clock(r.at, { timeZone: TZ })}
          </>
        )}
      </span>
    )
  },
  { key: "item", header: "Item", cell: (r) => <Lines title={r.item} detail={r.imported} /> },
  { key: "from", header: "From", width: "180px", cell: (r) => <Lines title={<span style={{ fontWeight: 500 }}>{r.from}</span>} detail={r.role} /> },
  { key: "state", header: "State", width: "200px", cell: (r) => r.state },
  { key: "action", width: "90px", align: "end", cell: (r) => <Button size="sm">{r.action}</Button> }
];

interface StatementLine {
  id: string;
  title: string;
  detail?: string;
  amount: number;
  notSetYet?: boolean;
}
const statementColumns: Column<StatementLine>[] = [
  { key: "what", header: "Line", cell: (r) => <Lines title={r.title} detail={r.detail} notSetYet={r.notSetYet} /> },
  {
    key: "amount",
    header: "Amount",
    width: "auto",
    kind: "amount",
    cell: (r) => <span style={{ fontSize: 14.5, color: r.amount <= 0 ? "var(--ink-70)" : undefined }}>{money(r.amount)}</span>
  }
];
const STATEMENT = [
  {
    title: "Carriage",
    rows: [
      { id: "s1", title: "Late Crate on HALL and SAZN", detail: "Your barter share, 8 airings", amount: $(8.1) },
      { id: "s2", title: "Beat Tape Live on CRAT", detail: "Cash, 1 airing", amount: $(3) }
    ]
  },
  {
    title: "Shared",
    rows: [
      { id: "s3", title: "Opencast's share", amount: 0, notSetYet: true },
      { id: "s4", title: "The pool", amount: 0, notSetYet: true }
    ]
  },
  {
    title: "Card fees",
    rows: [{ id: "s5", title: "Pledges paid by card", detail: "Stripe's fee, passed through at cost", amount: -$(12.66) }]
  }
];

/** Rows you can choose, with the keyboard or a click. */
function ChooseAiring() {
  const [sel, setSel] = useState("a1");
  return (
    <W w={676}>
      <Table<Airing>
        label="Airings"
        columns={airingColumns}
        rows={AIRINGS}
        rowKey={(r) => r.id}
        selectedKey={sel}
        onSelect={(_, k) => setSel(k)}
        inlineDetail
        rowPadding={10}
        gap={10}
      />
      <p className="oc-quiet" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
        Selected: {AIRINGS.find((a) => a.id === sel)?.where}. Tab to the rows, then ↑ ↓ and Enter.
      </p>
    </W>
  );
}

const SIGNON_CHECKS: Check[] = [
  { state: "fine", title: "The log covers the next 24 hours", detail: "Through 6:00 pm Sunday, with the 11:40 pm gap filled from your library" },
  { state: "fine", title: "A station ID airs at least once an hour", detail: "In every break, 48 times a day" },
  { state: "fine", title: "Rights confirmed for everything in the log", detail: "7 of 7 items" },
  { state: "fine", title: "Test signal received", detail: "720p at 3.2 Mbps, audio at −16 LUFS", action: <Button variant="text" style={{ fontSize: 13 }}>Watch it</Button> },
  { state: "attention", title: "Beat Tape Live has no source yet", detail: "It starts at 9:00 pm. Until a source connects, a slate will air in its place.", action: <Button size="sm">Set up source</Button> }
];
const UPLOAD_CHECKS: Check[] = [
  { state: "fine", title: "Length :30.0", detail: "Exactly a :30 spot" },
  { state: "fine", title: "Picture 1920 by 1080", detail: "Airs full screen on TV and web" },
  { state: "fine", title: "Captions", detail: "Generated from the voiceover. You can edit them" },
  { state: "fixed", title: "Loudness levelled", detail: "It was much louder than programs. We brought it to broadcast level so it won't jump out" },
  { state: "attention", title: "Phone number outside title safe", detail: "Some TVs will cut it off. Upload a new cut, or we can shrink the whole spot slightly to fit", action: <Button size="sm">Shrink to fit</Button> },
  { state: "fine", title: "Code ORANGE10 added", detail: "With a QR, bottom left, for the last :10", action: <Button size="sm">Change</Button> }
];

export const data = specimens([
  /* ---------------------------------------------------------------- StatRow */
  {
    id: "stat-row",
    name: "StatRow",
    group: "Data",
    from: [
      { file: FUNDING, anchor: "balance", frames: ["03.1", "04.1", "06.1", "06.2"] },
      { file: EARNINGS, anchor: "audience", frames: ["01.1"] },
      { file: RESULTS, anchor: "overview", frames: ["01.1", "05.2"] },
      { file: RIGHTS, anchor: "rights", frames: ["01.1", "05.1"] },
      { file: DESK, anchor: "board", frames: ["01.1", "07.1"] },
      { file: MC, anchor: "flow-a", frames: ["A.2"] }
    ],
    notes:
      "The ruled number group: a 2px ink rule, mono numbers split by hairlines, a caption under each. Stations see only their own numbers, businesses only their own results. Undecided money stays visible, reading \"Not set yet\" at $0.00.",
    stacked: true,
    states: [
      {
        label: "Balance: available, held, spent (xl)",
        note: "The dots tie each number to its BalanceBar segment; held is standby amber.",
        render: () => (
          <W w={1024}>
            <StatRow
              stats={[
                { amount: $(412.5), dot: "ink", caption: "Available. Yours to spend or take out" },
                { amount: $(14.2), dot: "standby", caption: "Held for 41 airings stations have scheduled" },
                { amount: $(248.9), dot: "line", caption: "Spent in September, on 118 airings" }
              ]}
            />
          </W>
        )
      },
      {
        label: "Audience: tuned in now (lg)",
        note: "Only the station's own numbers. The live dot marks the one counted right now.",
        render: () => (
          <W w={1024}>
            <StatRow
              size="lg"
              stats={[
                { value: "312", live: true, caption: "Tuned in now" },
                { value: "318", caption: `Tonight's peak, at ${clock(sat(156), { timeZone: TZ })}` },
                { value: "596", caption: "Hours watched tonight" },
                { value: "142", caption: "Viewers with BEAT as a preset" }
              ]}
            />
          </W>
        )
      },
      {
        label: "Results: the month (md)",
        render: () => (
          <W w={1024}>
            <StatRow
              size="md"
              stats={[
                { value: "118", caption: "Airings on 3 stations" },
                { value: "31,101", caption: "People tuned in, added up across airings" },
                { amount: $(248.9), caption: "Spent" },
                { value: "37", caption: `Customers used the code. ${money($(6.73))} each` }
              ]}
            />
          </W>
        )
      },
      {
        label: "Rights standing (md)",
        render: () => (
          <StatRow
            size="md"
            stats={[
              { value: "1", caption: "Open claim" },
              { value: "0", caption: "Upheld in the last 12 months" },
              { value: "Good", caption: "Standing. 3 upheld claims in a year pause carriage offers" }
            ]}
          />
        )
      },
      {
        label: "Desk: the market board (sm)",
        render: () => (
          <W w={1024}>
            <StatRow
              size="sm"
              stats={[
                { value: "71%", caption: "Of tonight's station hours are local programming" },
                { value: "2", caption: "Claimable stations on air, waiting to be claimed" },
                { value: "4", caption: "Creators who said yes, not set up yet" },
                { value: "1", caption: "Station with dead air coming, HALL 90.8" }
              ]}
            />
          </W>
        )
      },
      {
        label: "Not set yet, at $0.00",
        note: "Undecided money lines stay visible, so the page doesn't change shape the day they're decided.",
        render: () => (
          <StatRow
            size="md"
            stats={[
              { amount: $(2112.9), caption: "September so far" },
              { notSetYet: true, caption: "Opencast's share" },
              { notSetYet: true, caption: "The pool" }
            ]}
          />
        )
      }
    ]
  },

  /* ---------------------------------------------------------------- KeyValueList */
  {
    id: "key-value-list",
    name: "KeyValueList",
    group: "Data",
    from: [
      { file: RESULTS, anchor: "airings", frames: ["02.1"] },
      { file: FUNDING, anchor: "withdraw", frames: ["04.1"] },
      { file: EARNINGS, anchor: "earnings", frames: ["02.1", "03.1"] },
      { file: FUNDING, anchor: "balance", frames: ["03.1"] },
      { file: RIGHTS, anchor: "claim", frames: ["02.1"] },
      { file: MC, anchor: "flow-a", frames: ["A.7"] }
    ],
    notes:
      "Ruled facts. Pairs: label left, value right. Rows: two lines left, an amount (mono, right), a value or actions right, with a total under a 2px ink rule. Health: master control's \"Right now\" lines. Undecided money reads \"Not set yet\" at $0.00.",
    stacked: true,
    states: [
      {
        label: "Pairs",
        render: () => (
          <W w={320}>
            <KeyValueList
              items={[
                { label: "Started", value: `${clock(new Date("2026-09-26T20:28:30-07:00"), { timeZone: TZ, suffix: false, seconds: true })}.0 pm` },
                { label: "Ended", value: "8:29:00.0 pm, in full" },
                { label: "Tuned in", value: "262, averaged over the spot" },
                { label: "Cost", value: `262 × ${money($(8))} ÷ 1,000 = ${money($(2.1))}` },
                { label: "Code scans in the next hour", value: "4" }
              ]}
            />
          </W>
        )
      },
      {
        label: "Rows: amounts, money out, Not set yet and a total",
        render: () => (
          <W w={636}>
            <KeyValueList
              variant="rows"
              items={[
                { title: "Spots", detail: "212 airings from 5 businesses, settled after each airing", amount: $(486.2) },
                { title: "Programs you carry", detail: "Newsreel hour from REEL, cash, 1 airing", amount: -$(2.5) },
                { title: "Opencast's share", detail: "Of spot revenue", notSetYet: true },
                { title: "The pool", detail: "Base share, watch-time share and the fund", notSetYet: true },
                { title: "September so far", amount: $(2112.9), total: true }
              ]}
            />
          </W>
        )
      },
      {
        label: "Rows: money in, values and actions",
        render: () => (
          <W w={320}>
            <KeyValueList
              variant="rows"
              items={[
                { title: "Added", detail: "Bank transfer through Clear, September 1", amount: $(500), sign: true },
                { title: "Phones", value: "44%" },
                { title: "On YouTube, through your translator", detail: "Counted by YouTube. Not part of tuned in, and not billed", value: "88", quiet: true },
                { title: "Warn me", detail: "At 3 days and 1 day of airings left", actions: <Button size="sm">Change</Button> },
                { title: "Statements", detail: "Monthly, with every airing", actions: <Button size="sm">View</Button> }
              ]}
            />
          </W>
        )
      },
      {
        label: "Health",
        render: () => (
          <W w={300}>
            <KeyValueList
              variant="health"
              items={[
                { label: "Tuned in", value: "312" },
                { label: "Signal", value: "3.2 Mbps", good: true },
                { label: "YouTube", value: "Relaying", good: true },
                { label: "Log runs until", value: `Sun ${clock(sat(162), { timeZone: TZ })}` },
                { label: "Slow Hours, from HALL", value: "Sat, 11:40 pm gap", textValue: true, attention: true }
              ]}
            />
          </W>
        )
      }
    ]
  },

  /* ---------------------------------------------------------------- Table */
  {
    id: "table",
    name: "Table",
    group: "Data",
    from: [
      { file: RESULTS, anchor: "overview", frames: ["01.1", "02.1"] },
      { file: EARNINGS, anchor: "audience", frames: ["01.1", "03.1"] },
      { file: RIGHTS, anchor: "rights", frames: ["01.1"] },
      { file: "control/opencast-market.html", anchor: "program", frames: ["B.1"] },
      { file: MC, anchor: "flow-c", frames: ["C.1", "C.2"] }
    ],
    notes:
      "A ruled table: a 12.5px ink-50 header over a line rule, rows ruled by hairlines, column widths from the frame. Amounts and times in mono, amounts right-aligned. The chosen row gets the signal edge, what's on now the tally edge, a claim waiting on you the standby edge. Groups sit under headings; a total closes under a 2px ink rule.",
    stacked: true,
    states: [
      {
        label: "Header, mono amounts, total row",
        render: () => (
          <W w={696}>
            <Table<StationRow>
              label="By station"
              columns={stationColumns}
              rows={BY_STATION}
              total={BY_STATION_TOTAL}
              inlineDetail
              rowKey={(r) => r.cs}
              rowPadding={11}
            />
          </W>
        )
      },
      {
        label: "Choosable rows, one selected",
        note: "Click a row, or Tab to the rows and use ↑ ↓ and Enter. A short airing reads in standby with its length in words.",
        render: () => <ChooseAiring />
      },
      {
        label: "On now: the tally edge",
        render: () => (
          <W w={656}>
            <Table<ProgramRow>
              label="By program"
              columns={programColumns}
              rows={BY_PROGRAM}
              rowKey={(r) => r.id}
              rowMark={(r) => (r.now ? "now" : undefined)}
              inlineDetail
            />
          </W>
        )
      },
      {
        label: "Waiting on you: the standby edge",
        render: () => (
          <W w={1024}>
            <Table<ClaimRow>
              label="Claims"
              columns={claimColumns}
              rows={CLAIMS}
              rowKey={(r) => r.id}
              rowMark={(r) => (r.id === "c1" ? "attention" : undefined)}
              rowPadding={12}
              gap={14}
            />
          </W>
        )
      },
      {
        label: "Groups (a statement) with Not set yet and a total",
        render: () => (
          <W w={498}>
            <Table<StatementLine>
              label="Week of September 14"
              header="hidden"
              columns={statementColumns}
              groups={STATEMENT}
              total={{ id: "total", title: "Paid out", amount: $(553.42) }}
              rowKey={(r) => r.id}
              rowPadding={10}
              gap={16}
            />
          </W>
        )
      }
    ]
  },

  /* ---------------------------------------------------------------- Movements */
  {
    id: "movements",
    name: "Movements",
    group: "Data",
    from: [{ file: FUNDING, anchor: "balance", frames: ["03.1"] }],
    notes:
      "Every movement on a business's balance, a Table preset: day and time in mono, what happened, and the amount. Held money reads in standby with \"held\" under it, money in gets a +, money out reads quieter with a minus.",
    stacked: true,
    states: [
      {
        label: "Every movement",
        render: () => (
          <W w={676}>
            <Movements
              timeZone={TZ}
              items={[
                { id: "m1", day: "Tonight", at: new Date("2026-09-26T20:28:00-07:00"), title: "Aired on BEAT 12.1", detail: `:30 spot, 262 tuned in, ${money($(8))} per 1,000`, amount: -$(2.1), kind: "out" },
                { id: "m2", day: "Tonight", at: new Date("2026-09-26T20:14:00-07:00"), title: "Held for 9 airings tonight", detail: "BEAT 12.1 and SAZN 18.1 scheduled your spot", amount: $(4.6), kind: "hold" },
                { id: "m3", day: "Friday", at: new Date("2026-09-25T21:59:00-07:00"), title: "Returned: airing cut short", detail: "CIVC 7.1, the town hall ran over. Aired :12 of :30", amount: $(0.84), kind: "in" },
                { id: "m4", day: "Friday", at: new Date("2026-09-25T19:40:00-07:00"), title: "Aired on CIVC 7.1", detail: ":30 spot, 410 tuned in", amount: -$(3.28), kind: "out" },
                { id: "m5", day: "Sept 1", title: "Added by bank transfer", detail: "Through Clear, from Chase ending 8810", amount: $(500), kind: "in" }
              ]}
            />
          </W>
        )
      }
    ]
  },

  /* ---------------------------------------------------------------- Timeline */
  {
    id: "timeline",
    name: "Timeline",
    group: "Data",
    from: [
      { file: SPOTS, anchor: "paused", frames: ["04.1"] },
      { file: RIGHTS, anchor: "claim", frames: ["02.1"] },
      { file: RIGHTS, anchor: "carried", frames: ["04.1"] }
    ],
    notes: "What happened, where it stands, what comes next. Done is an ink dot, current a standby dot, future rows read quieter. Times in mono. Screen readers hear \"Done\" and \"Not yet\", and the current step is marked.",
    stacked: true,
    states: [
      {
        label: "A paused spot: done, then waiting for you",
        render: () => (
          <W w={636}>
            <Timeline
              items={[
                { state: "done", when: `Oct 12, ${clock(new Date("2026-10-12T15:10:00-07:00"), { timeZone: TZ })}`, title: "Budget reached", detail: `The last ${money($(1.9))} was held for an airing on BEAT` },
                { state: "done", when: `Oct 12, ${clock(new Date("2026-10-12T15:10:00-07:00"), { timeZone: TZ })}`, title: "Out of the market, stations told", detail: "BEAT, CIVC and SAZN had it in rotation" },
                { state: "done", when: "Oct 12, evening", title: "6 airings already held still aired", detail: "They were paid for before the pause" },
                { state: "current", when: "Now", title: "Waiting for you", detail: "Raise the budget and it's back in the market, and the 3 stations are told" }
              ]}
            />
          </W>
        )
      },
      {
        label: "A claim: done, current, future",
        render: () => (
          <W w={380}>
            <Timeline
              whenWidth={130}
              items={[
                { state: "done", when: `Today, ${clock(new Date("2026-09-26T15:12:00-07:00"), { timeZone: TZ })}`, title: "Claim received, item off air", detail: "Everywhere it was scheduled" },
                { state: "current", when: "By October 5", title: "BEAT removes it or answers", detail: "9 days left" },
                { state: "future", when: "If answered", title: "Westside Tapes has 10 business days to take it further", detail: "If they don't, it can air again" },
                { state: "future", when: "If no answer", title: "Removed from the library on October 5", detail: "Counts as removed, not upheld" }
              ]}
            />
          </W>
        )
      },
      {
        label: "All done",
        render: () => (
          <W w={636}>
            <Timeline
              whenWidth={130}
              items={[
                { state: "done", when: "Aug 19", title: "Claim, pulled from 3 stations" },
                { state: "done", when: "Aug 20", title: "BEAT answered", detail: "We made it" },
                { state: "done", when: "Aug 30", title: "No further action from the claimant", detail: "Back on air on all 3 stations" }
              ]}
            />
          </W>
        )
      }
    ]
  },

  /* ---------------------------------------------------------------- StepRail */
  {
    id: "step-rail",
    name: "StepRail",
    group: "Data",
    from: [
      { file: MC, anchor: "flow-a", frames: ["A.1", "A.2", "A.3", "A.4", "A.5", "A.6"] },
      { file: FUNDING, anchor: "business", frames: ["01.1", "02.1"] },
      { file: ORDERS, anchor: "pay", frames: ["04.1", "05.1"] },
      { file: RIGHTS, anchor: "handover", frames: ["05.1"] }
    ],
    notes:
      "Where you are in a sequence. Vertical: the setup rail with its note (the shell draws the rail's rule). Row: an order's steps across the page. List: the claim page's numbered steps with an action. Done steps show a check; the current one is marked in signal (in ink on the row).",
    stacked: true,
    states: [
      {
        label: "Setup rail: step 1",
        render: () => (
          <W w={200}>
            <StepRail
              label="Setting up BEAT"
              steps={[
                { label: "Your station", state: "current" },
                { label: "Library", state: "todo" },
                { label: "Program log", state: "todo" },
                { label: "Translators", state: "todo" },
                { label: "Sign on", state: "todo" }
              ]}
              hint="Each step saves as you go. Nothing is public until you sign on."
            />
          </W>
        )
      },
      {
        label: "Setup rail: step 2, business",
        render: () => (
          <W w={200}>
            <StepRail
              label="Getting started"
              steps={[
                { label: "Your business", state: "done" },
                { label: "Fund your balance", state: "current" },
                { label: "Your first spot", state: "todo" }
              ]}
              hint="Nothing is spent until a station airs your spot."
            />
          </W>
        )
      },
      {
        label: "Order steps: quoted",
        render: () => (
          <W w={1024}>
            <StepRail
              variant="row"
              label="Fall menu order"
              steps={[
                { label: "Asked", state: "done" },
                { label: "Quoted", state: "current" },
                { label: "Paid, in the making", state: "todo" },
                { label: "Delivered", state: "todo" },
                { label: "Approved", state: "todo" }
              ]}
            />
          </W>
        )
      },
      {
        label: "Order steps: delivered",
        render: () => (
          <W w={1024}>
            <StepRail
              variant="row"
              label="Fall menu order"
              steps={[
                { label: "Asked", state: "done" },
                { label: "Quoted", state: "done" },
                { label: "Paid, in the making", state: "done" },
                { label: "Delivered", state: "current" },
                { label: "Approved", state: "todo" }
              ]}
            />
          </W>
        )
      },
      {
        label: "Claim steps (list)",
        render: () => (
          <W w={704}>
            <StepRail
              variant="list"
              label="Claiming CRAT 102.0"
              steps={[
                { label: "Sign in", detail: "As Marcus Reyes", state: "done" },
                { label: "Show it's you", detail: "Connect the SoundCloud account your mixes come from", state: "current", action: <Button variant="primary" size="sm">Connect SoundCloud</Button> },
                { label: "Take it over", detail: `You become CRAT's owner. The ${money($(214.6))} is paid from escrow to your wallet 72 hours after you're verified`, state: "todo" }
              ]}
            />
          </W>
        )
      }
    ]
  },

  /* ---------------------------------------------------------------- PermissionsTable */
  {
    id: "permissions-table",
    name: "PermissionsTable",
    group: "Data",
    from: [
      { file: STATION_SETTINGS, anchor: "team", frames: ["03.1"] },
      { file: BIZ_SETTINGS, anchor: "team", frames: ["02.1"] }
    ],
    notes: "What each role can do: roles as columns, abilities as rows, answered in words. \"Yes\" is bold; \"No\" and partial answers read quieter. Never colour alone.",
    stacked: true,
    states: [
      {
        label: "Station roles",
        render: () => (
          <W w={820}>
            <PermissionsTable
              caption="What each role can do"
              roles={["Owner", "Operator", "Host"]}
              abilities={[
                { label: "Go live on their assigned blocks, change lower thirds, cue breaks", can: [true, true, true] },
                { label: "Library, program log, listings, breaks, carriage", can: [true, true, false] },
                { label: "Spot market and rotations", can: [true, true, false] },
                { label: "Earnings, payouts and the station account", can: [true, "See only", false] },
                { label: "Team, identity, sign off", can: [true, false, false] }
              ]}
            />
          </W>
        )
      },
      {
        label: "Business roles",
        render: () => (
          <W w={820}>
            <PermissionsTable
              caption="What each role can do"
              columnWidth={110}
              roles={["Owner", "Manager", "Viewer"]}
              abilities={[
                { label: "See results, airings and statements", can: [true, true, true] },
                { label: "Spots, sponsorships, production orders, redeeming codes", can: [true, true, false] },
                { label: "Add money, approve orders", can: [true, true, false] },
                { label: "Take money out, connections, team, close account", can: [true, false, false] }
              ]}
            />
          </W>
        )
      }
    ]
  },

  /* ---------------------------------------------------------------- LineChart */
  {
    id: "line-chart",
    name: "LineChart",
    group: "Data",
    from: [
      { file: EARNINGS, anchor: "audience", frames: ["01.1"] },
      { file: EARNINGS, anchor: "phone", frames: ["04.1"] }
    ],
    notes:
      "The audience line: tonight in ink against last Saturday dashed, breaks shaded in standby, a tally line and \"312 now\" at the end. The time axis is in the 12-hour clock. It's sized by its container; screen readers get the summary and a table of the numbers. Stations see only their own audience.",
    stacked: true,
    states: [
      {
        label: "Tonight against last Saturday",
        render: () => (
          <W w={1024}>
            <LineChart
              label="Tuned in from 6 pm to now, tonight and last Saturday"
              from={sat(0)}
              to={sat(300)}
              series={points(TONIGHT)}
              comparison={points(LAST_SATURDAY)}
              breaks={breaks}
              timeZone={TZ}
            />
          </W>
        )
      },
      {
        label: "No comparison yet",
        note: "A station's first Saturday: no last-week line, and no word for it in the legend.",
        render: () => (
          <W w={1024}>
            <LineChart label="Tuned in from 6 pm to now, tonight" from={sat(0)} to={sat(300)} series={points(TONIGHT)} breaks={breaks} timeZone={TZ} />
          </W>
        )
      },
      {
        label: "Phone (compact)",
        render: () => (
          <W w={374}>
            <LineChart
              compact
              label="Tuned in from 6 pm to now, tonight and last Saturday"
              from={sat(0)}
              to={sat(300)}
              series={points(TONIGHT)}
              comparison={points(LAST_SATURDAY)}
              breaks={breaks}
              timeZone={TZ}
            />
          </W>
        )
      }
    ]
  },

  /* ---------------------------------------------------------------- BalanceBar */
  {
    id: "balance-bar",
    name: "BalanceBar",
    group: "Data",
    from: [{ file: FUNDING, anchor: "balance", frames: ["03.1"] }],
    notes:
      "The balance as one bar: available in ink, held in standby amber, spent in line. It's read out as words and amounts. Under a StatRow with matching dots it needs no legend; on its own it shows one.",
    stacked: true,
    states: [
      {
        label: "Under the balance numbers",
        render: () => (
          <W w={1024}>
            <StatRow
              stats={[
                { amount: $(412.5), dot: "ink", caption: "Available. Yours to spend or take out" },
                { amount: $(14.2), dot: "standby", caption: "Held for 41 airings stations have scheduled" },
                { amount: $(248.9), dot: "line", caption: "Spent in September, on 118 airings" }
              ]}
            />
            <div style={{ marginTop: 14 }} />
            <BalanceBar
              segments={[
                { tone: "available", label: "Available", amount: $(412.5) },
                { tone: "held", label: "Held", amount: $(14.2) },
                { tone: "spent", label: "Spent in September", amount: $(248.9) }
              ]}
            />
          </W>
        )
      },
      {
        label: "With its legend",
        render: () => (
          <W w={640}>
            <BalanceBar
              legend
              segments={[
                { tone: "available", label: "Available", amount: $(112.5) },
                { tone: "held", label: "Held", amount: $(14.2) },
                { tone: "spent", label: "Spent in September", amount: $(248.9) }
              ]}
            />
          </W>
        )
      }
    ]
  },

  /* ---------------------------------------------------------------- BalanceChip */
  {
    id: "balance-chip",
    name: "BalanceChip",
    group: "Data",
    from: [{ file: FUNDING, anchor: "balance", frames: ["03.1"] }],
    notes: "The business header's balance: the word, then the amount in mono. Stations never see it.",
    states: [
      { label: "In the header", render: () => <BalanceChip amount={$(412.5)} /> },
      { label: "Nothing available", render: () => <BalanceChip amount={0} /> }
    ]
  },

  /* ---------------------------------------------------------------- Checks */
  {
    id: "checks",
    name: "Checks",
    group: "Data",
    from: [
      { file: MC, anchor: "flow-a", frames: ["A.6"] },
      { file: SPOTS, anchor: "upload", frames: ["02.1"] },
      { file: ORDERS, anchor: "review", frames: ["05.1"] }
    ],
    notes:
      "Checks with a way forward. Sign-on: an ink check when it passes, a standby \"!\" with the fix on the right when it needs you. Upload: fine, fixed (Opencast did it and says what), and for you. Each mark says its state in words to screen readers.",
    stacked: true,
    states: [
      {
        label: "Sign-on checks",
        render: () => (
          <W w={596}>
            <Checks label="Before you sign on" items={SIGNON_CHECKS} />
          </W>
        )
      },
      {
        label: "Upload checks: fine, fixed, for you",
        note: `The summary beside the heading comes from checksSummary(): "${checksSummary(UPLOAD_CHECKS)}".`,
        render: () => (
          <W w={380}>
            <Checks variant="upload" label="Checks" items={UPLOAD_CHECKS} />
          </W>
        )
      }
    ]
  },

  /* ---------------------------------------------------------------- PromiseList */
  {
    id: "promise-list",
    name: "PromiseList",
    group: "Data",
    from: [
      { file: FUNDING, anchor: "fund", frames: ["02.1"] },
      { file: ORDERS, anchor: "pay", frames: ["04.1"] }
    ],
    notes: "The numbered four-line promise: what happens to the money, one ruled line per step, under a 2px ink rule. The first words are the promise; the rest explains it.",
    states: [
      {
        label: "What happens to your money",
        render: () => (
          <W w={380}>
            <PromiseList
              title="What happens to your money"
              lines={[
                { lead: "It sits in your balance.", rest: "Nothing is spent by adding it." },
                { lead: "A station schedules your spot,", rest: "and the price of that airing is held." },
                { lead: "It airs,", rest: "and the held amount is paid to the station. If an airing is cut short, the hold comes back." },
                { lead: "Anything not held is yours", rest: "to take out at any time." }
              ]}
            />
          </W>
        )
      },
      {
        label: "An order's payment (no heading)",
        render: () => (
          <W w={440}>
            <PromiseList
              label="What happens to the $140.00"
              lines={[
                { lead: "BEAT starts work", rest: "knowing it's paid for." },
                { lead: "You approve the finished spot,", rest: `and the ${money($(140))} goes to BEAT.` },
                { lead: "If you don't answer", rest: "within 7 days of delivery, it goes to BEAT too." },
                { lead: "If BEAT can't deliver", rest: "by October 9 and you cancel, it all comes back." }
              ]}
            />
          </W>
        )
      }
    ]
  },

  /* ---------------------------------------------------------------- Funnel */
  {
    id: "funnel",
    name: "FunnelRow",
    group: "Data",
    from: [{ file: RESULTS, anchor: "codes", frames: ["03.1"] }],
    notes: "Scans, saves and uses of a code: one row per step, each bar against the largest, from line to ink as the step counts more. Businesses see only their own results.",
    stacked: true,
    states: [
      {
        label: "Codes and customers",
        render: () => (
          <W w={636}>
            <Funnel
              steps={[
                { title: "Scanned the QR", detail: "From a TV or phone, during or after a spot", count: 214 },
                { title: "Saved the offer", detail: "Kept it on their phone for later", count: 61 },
                { title: "Used it when paying", detail: "Within 7 days of an airing", count: 31 }
              ]}
            />
          </W>
        )
      }
    ]
  },

  /* ---------------------------------------------------------------- SplitBar */
  {
    id: "split-bar",
    name: "SplitBar",
    group: "Data",
    from: [
      { file: RESULTS, anchor: "overview", frames: ["01.1"] },
      { file: EARNINGS, anchor: "audience", frames: ["01.1"] }
    ],
    notes: "How a whole divides. Rows: airings by time of day, each bar a share of the whole. Stacked: where people watch, one bar in ink, ink-70, ink-50 and line, with the numbers in the rows beside it.",
    states: [
      {
        label: "Airings by time of day (rows)",
        render: () => (
          <W w={300}>
            <SplitBar
              parts={[
                { label: "Afternoons", amount: 38 },
                { label: "Evenings", amount: 80 }
              ]}
            />
          </W>
        )
      },
      {
        label: "Watching on (stacked)",
        render: () => (
          <W w={340}>
            <SplitBar
              variant="stacked"
              label="Phones 44%, casting to a TV 24%, web 21%, TV app 11%"
              parts={[
                { label: "Phones", amount: 44 },
                { label: "Casting to a TV", amount: 24 },
                { label: "Web", amount: 21 },
                { label: "TV app", amount: 11 }
              ]}
            />
          </W>
        )
      }
    ]
  },

  /* ---------------------------------------------------------------- Runway */
  {
    id: "runway",
    name: "Runway",
    group: "Data",
    from: [{ file: FUNDING, anchor: "balance", frames: ["03.1"] }],
    notes: "The line under the balance: at this month's pace, how many days of airings what's available covers. Warnings are in days, not dollars.",
    stacked: true,
    states: [
      { label: "Auto top-up off", render: () => <W w={1024}><Runway perDay={$(9.2)} days={44} autoTopUp={false} /></W> },
      { label: "Auto top-up on, one day left", note: "\"Auto top-up is on.\" is new copy.", render: () => <Runway perDay={$(9.2)} days={1} autoTopUp /> }
    ]
  },

  /* ---------------------------------------------------------------- Reach */
  {
    id: "reach",
    name: "Reach",
    group: "Data",
    from: [{ file: FUNDING, anchor: "business", frames: ["01.1"] }],
    notes: "How many of the market's stations can carry this kind of business: a bar and the sentence with the numbers.",
    states: [
      {
        label: "Every station can carry",
        render: () => (
          <W w={360}>
            <Reach
              title="Every station can carry coffee and food"
              reached={8}
              total={8}
              detail="8 of 8 stations in the Inland Empire. Some stations don't carry categories like alcohol or gambling; yours isn't one of them."
            />
          </W>
        )
      }
    ]
  }
]);
