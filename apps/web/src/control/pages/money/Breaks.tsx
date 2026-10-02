// C.1 Breaks tonight; C.3 filled (amber "Just added", the toast with Undo); biz-spots 05.1 the
// paused notice (handled by the backup rotation) and "It's back".
//
// The rows are tonight's breaks from the log (log.getLog); what fills each one comes from
// spots.getAvails (G1). Totals are computed from the rows (A28).

import { Navigate, useSearchParams } from "react-router";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { type BreakContent, type BreakSlot, logApi, type LogEntry, type MarketSpot } from "@opencast/contracts";
import { BreakBar, BreakLegend, Button, ControlTitle, Lines, Table, clock, duration, useToast, type BreakPartKind, type Column } from "@opencast/ui";
import { useApi } from "../../../api/hooks";
import { BreakDetails } from "../../components/spots/BreakDetails";
import { errorText, useAvails, useMarket, useRotations, useSetRotation } from "../../components/spots/data";
import { breakParts, breakSummary, openAcross, tonightWindow, type BreakView } from "../../components/spots/format";
import { justAdded, settle, subscribe } from "../../components/spots/justAdded";
import { MockPauseControls } from "../../components/spots/MockPauseControls";
import { PauseNotices } from "../../components/spots/PauseNotices";
import { ErrorLine } from "../../components/spots/parts";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { now, STATION_TZ } from "../../../lib/clock";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../common";
import "./Breaks.css";
import { stationLabel } from "../../station/slug";

interface Row extends BreakView {
  id: string;
  startsAt: string;
  context: string;
  detail: string;
  airing: boolean;
  barterOwner: string | null;
}

function detailOf(b: BreakSlot, aired: boolean, airing: boolean): string {
  if (airing) return "Airing now";
  if (aired) return "Aired";
  if (b.origin === "carried_barter") return "Carried, barter";
  if (b.origin === "cued_live") return "Live, cued by the host";
  return "";
}

function carrierAt(entries: LogEntry[], at: string): string | null {
  const e = entries.find((x) => x.startsAt <= at && at < x.endsAt && x.carriedFrom);
  return e?.carriedFrom?.callSign ? stationLabel(e.carriedFrom) : null;
}

export default function Breaks() {
  const s = useStation();
  // A studio has no breaks of its own: its spots are in its Spot rotation.
  const [params] = useSearchParams();
  if (s.studio) return <Navigate to={`${s.base}/spot-rotation`} replace />;
  // Settings, Breaks: "Edit" on the backup rotation opens its editor (the spot market's rotation tab).
  const rotation = params.get("rotation");
  if (rotation === "backup" || rotation === "main") return <Navigate to={`${s.base}/spot-market/rotation?show=${rotation}`} replace />;
  return <BreaksPage />;
}

function BreaksPage() {
  const s = useStation();
  const phone = useIsPhone();
  const toast = useToast();
  useShellOptions({ context: "Breaks" });
  const win = useMemo(() => tonightWindow(now(), STATION_TZ), []);
  const log = useApi(logApi.getLog, { params: { stationId: s.id }, query: win });
  const avails = useAvails(s.id);
  const rotations = useRotations(s.id);
  const market = useMarket(s.id);
  const setRotation = useSetRotation();
  const [details, setDetails] = useState<string | null>(null);
  const run = useSyncExternalStore(subscribe, () => JSON.stringify(justAdded(s.id)));
  const added = useMemo(() => (run === "null" ? null : justAdded(s.id)), [run, s.id]);

  const t = now().toISOString();
  const rows: Row[] = useMemo(() => {
    const byId = new Map((avails.data?.breaks ?? []).map((a) => [a.breakId, a]));
    return [...(log.data?.breaks ?? [])]
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map((b, i) => {
        const end = new Date(Date.parse(b.startsAt) + b.lengthMs).toISOString();
        const aired = end <= t;
        const airing = !aired && b.startsAt <= t;
        const a = b.id ? byId.get(b.id) : undefined;
        return {
          id: b.id ?? `b${i}`,
          startsAt: b.startsAt,
          context: b.context,
          detail: detailOf(b, aired, airing),
          aired: aired || airing,
          airing,
          lengthMs: b.lengthMs,
          producerShareMs: b.producerShareMs,
          openMs: b.openMs,
          contents: a?.contents ?? null,
          barterOwner: b.origin === "carried_barter" ? carrierAt(log.data?.entries ?? [], b.startsAt) : null
        };
      });
    // `t` moves every second; the rows only need it when the data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.data, avails.data]);

  const isNew = useMemo(() => {
    if (!added) return () => false;
    const before = new Set(added.before);
    return (c: BreakContent) => c.kind === "spot" && !before.has(c.id);
  }, [added]);

  // C.3: the toast for what was just added, once per run; Undo puts the rotation back.
  const toasted = useRef<string | null>(null);
  useEffect(() => {
    if (!added || !added.added.length || !avails.data || !market.data || toasted.current === run) return;
    toasted.current = run;
    const first = rows.find((r) => !r.aired && r.contents?.some(isNew));
    const names = added.added.map((id) => market.data.find((m) => m.spot.id === id)?.business.name ?? "The spot");
    const n = added.added.length;
    const when = first ? clock(first.startsAt, { timeZone: STATION_TZ }) : null;
    const message =
      n === 1
        ? when
          ? `${names[0]} added. It starts in the ${when} break.`
          : `${names[0]} added. It airs when there's open time.`
        : when
          ? `${n} spots added. They start in the ${when} break.`
          : `${n} spots added. They air when there's open time.`;
    const previous = added.previousMain;
    toast.show({
      message,
      timeout: 8000,
      onUndo: () => {
        setRotation.mutate({ params: { stationId: s.id, kind: "main" }, body: { spotIds: previous } }, { onSettled: () => settle(s.id) });
      },
      onExpire: () => settle(s.id)
    });
  }, [added, run, rows, avails.data, market.data, isNew, s.id, setRotation, toast]);

  if (log.isLoading) return <Quiet />;
  if (log.error) return <ErrorLine>{errorText(log.error)}</ErrorLine>;

  const main = rotations.data?.main.spots ?? [];
  const upcoming = rows.filter((r) => !r.aired);
  const openMs = upcoming.reduce((a, r) => a + r.openMs, 0);
  const lede = openAcross(openMs, rows.length);
  const barterOwner = rows.find((r) => r.barterOwner)?.barterOwner ?? undefined;
  const anyAdded = rows.some((r) => r.contents?.some(isNew));
  const legend: BreakPartKind[] = ["filled", ...(anyAdded ? (["added"] as const) : []), ...(rows.some((r) => r.producerShareMs > 0) ? (["barter"] as const) : []), "open"];
  const canAct = s.can("spots");
  const open = rows.find((r) => r.id === details);

  const addBack = (m: MarketSpot) => {
    const before = main.map((x) => x.spotId);
    setRotation.mutate(
      { params: { stationId: s.id, kind: "main" }, body: { spotIds: [...before, m.spot.id] } },
      {
        onSuccess: () =>
          toast.show({
            message: `${m.spot.title} is back in your rotation.`,
            onUndo: () => setRotation.mutate({ params: { stationId: s.id, kind: "main" }, body: { spotIds: before } })
          }),
        onError: (e) => toast.show({ message: errorText(e) })
      }
    );
  };

  const bar = (r: Row) => (
    <div className="cc-brk__bar">
      <BreakBar parts={breakParts(r, isNew)} barterOwner={r.barterOwner ?? undefined} />
      <small>{breakSummary(r, { rotationSize: main.length, barterOwner: r.barterOwner })}</small>
    </div>
  );
  const openCell = (r: Row) =>
    r.aired || r.openMs === 0 ? (
      <span className="cc-sp-quiet">None</span>
    ) : (
      <span>
        <span className="cc-sp-mono">{duration(r.openMs)}</span> open
      </span>
    );
  const endCell = (r: Row) =>
    r.aired ? (
      <span className="cc-brk__aired">{r.airing ? "Airing" : "Aired"}</span>
    ) : (
      <Button size="sm" onClick={() => setDetails(r.id)} aria-label={`Details of the ${clock(r.startsAt, { timeZone: STATION_TZ })} break`}>
        Details
      </Button>
    );

  const columns: Column<Row>[] = phone
    ? [
        { key: "airs", header: "Airs", width: "64px", kind: "mono", cell: (r) => clock(r.startsAt, { timeZone: STATION_TZ, seconds: true, suffix: false }) },
        {
          key: "break",
          header: "Break",
          cell: (r) => (
            <div className="cc-brk__phone">
              <Lines title={r.context} detail={r.detail || undefined} />
              {bar(r)}
            </div>
          )
        },
        { key: "open", header: "Open", width: "72px", align: "end", cell: openCell }
      ]
    : [
        { key: "airs", header: "Airs", width: "78px", kind: "mono", cell: (r) => clock(r.startsAt, { timeZone: STATION_TZ, seconds: true, suffix: false }) },
        { key: "around", header: "Around", cell: (r) => <Lines title={r.context} detail={r.detail || " "} /> },
        { key: "break", header: "Break", width: "220px", cell: bar },
        { key: "open", header: "Open", width: "110px", className: "cc-brk__open", cell: openCell },
        { key: "end", header: <span className="oc-sr-only">Details</span>, width: "120px", align: "end", cell: endCell }
      ];

  return (
    <div className="cc-brk">
      <ControlTitle
        title="Breaks tonight"
        description={
          <>
            <b className="cc-brk__lede">{lede.open}</b>
            {lede.rest} {main.length ? `Rotation: ${main.length} ${main.length === 1 ? "spot" : "spots"}.` : "Open time with nothing in it airs your station ID and bumpers."}
          </>
        }
        end={
          canAct && !phone ? (
            main.length ? (
              <Button href={`${s.base}/spot-market/rotation`}>Edit rotation</Button>
            ) : (
              <Button variant="primary" href={`${s.base}/spot-market`}>
                Fill from the spot market
              </Button>
            )
          ) : undefined
        }
      />
      {market.data && <PauseNotices spots={market.data} rotationHref={`${s.base}/spot-market/rotation`} onAddBack={canAct ? addBack : undefined} busy={setRotation.isPending} />}
      {avails.error && <ErrorLine>{errorText(avails.error)}</ErrorLine>}
      {rows.length ? (
        <Table<Row>
          label="Breaks tonight"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          rowPadding={12}
          gap={14}
          onSelect={phone ? (r) => !r.aired && setDetails(r.id) : undefined}
        />
      ) : (
        <p className="cc-sp-quiet cc-brk__empty">No breaks tonight. Breaks come from your break rule in Settings.</p>
      )}
      {rows.length > 0 && <BreakLegend className="cc-brk__legend" kinds={legend} barterOwner={barterOwner} />}
      {phone && canAct && (
        <div className="cc-brk__phone-act">
          {main.length ? <Button href={`${s.base}/spot-market/rotation`}>Edit rotation</Button> : <Button variant="primary" href={`${s.base}/spot-market`}>Fill from the spot market</Button>}
        </div>
      )}
      {canAct && market.data && <MockPauseControls spots={market.data} />}
      {open && (
        <BreakDetails
          open
          onClose={() => setDetails(null)}
          startsAt={open.startsAt}
          lengthMs={open.lengthMs}
          context={open.context}
          contents={open.contents}
          isNew={isNew}
        />
      )}
    </div>
  );
}
