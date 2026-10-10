// Programming Phase 6, a network licence (no frame draws it): who licenses it, what it covers, where
// it can air, where in the world, its dates and the deal, with Edit for rights reviewers and admins.
// Under it, the licensor's minutes for a month (?month=2026-10, this month by default): minutes aired
// and viewer hours by station and by outlet, from the as-run log, with a CSV download.
import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { licencesApi, OUTLET_WORDS, type LicensorMinutes } from "@opencast/contracts";
import { Button, ControlTitle, KeyValueList, Notice, StatRow, Table, Tag, useToast, type Column } from "@opencast/ui";
import { call } from "../../api/client";
import { useApi } from "../../api/hooks";
import { now } from "../../lib/clock";
import { download } from "../components/analytics/span";
import { amountWords, coversLine, datesLine, dealLine, endingNotice, minutesStats, monthWords, outletsLine, shiftMonth, stateTag, territoryLine } from "../components/licences/licences";
import { LicenceForm } from "../components/licences/LicenceForm";
import { Crumb, ErrorLine, errorText, NotFound, Quiet, SecTop } from "./common";
import { deskPath } from "../../areas";
import "./Licences.css";

type Row = LicensorMinutes["rows"][number];
type StationRow = LicensorMinutes["stations"][number];
const stationName = (s: StationRow["station"]) => [s.callSign ?? s.name, s.channel].filter(Boolean).join(" ");

export default function Licence() {
  const { licenceId = "" } = useParams();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const month = /^\d{4}-\d{2}$/.test(params.get("month") ?? "") ? params.get("month")! : now().toISOString().slice(0, 7);
  const licence = useApi(licencesApi.getLicence, { params: { licenceId } });
  const minutes = useApi(licencesApi.licenceMinutes, { params: { licenceId }, query: { month } });
  if (licence.isLoading) return <Quiet />;
  if (licence.error && (licence.error as { status?: number }).status === 404) return <NotFound />;
  if (licence.error || !licence.data) return <ErrorLine error={licence.error} />;
  const l = licence.data;
  const tag = stateTag(l);
  const ending = endingNotice(l);
  const go = (m: string) => setParams((p) => (p.set("month", m), p), { replace: true });

  const csv = async () => {
    try {
      const file = await call(licencesApi.licenceMinutesCsv, { params: { licenceId }, query: { month } });
      download(file.filename, file.csv);
    } catch (e) {
      toast.show({ message: errorText(e) });
    }
  };

  const stationColumns: Column<StationRow>[] = [
    { key: "station", header: "Station", cell: (s) => <b>{stationName(s.station)}</b> },
    { key: "airings", header: "Airings", width: "100px", align: "end", cell: (s) => <span className="nd-lic__m">{s.airings}</span> },
    { key: "minutes", header: "Minutes aired", width: "140px", align: "end", cell: (s) => <span className="nd-lic__m">{amountWords(s.minutesAired)}</span> },
    { key: "hours", header: "Viewer hours", width: "140px", align: "end", cell: (s) => <span className="nd-lic__m">{amountWords(s.viewerHours)}</span> }
  ];
  const rowColumns: Column<Row>[] = [
    { key: "station", header: "Station", cell: (r) => <span>{stationName(r.station)}</span> },
    { key: "outlet", header: "Outlet", width: "160px", cell: (r) => <span>{OUTLET_WORDS[r.outlet].label}</span> },
    { key: "minutes", header: "Minutes aired", width: "140px", align: "end", cell: (r) => <span className="nd-lic__m">{amountWords(r.minutesAired)}</span> },
    { key: "hours", header: "Viewer hours", width: "140px", align: "end", cell: (r) => <span className="nd-lic__m">{amountWords(r.viewerHours)}</span> }
  ];
  const report = minutes.data;
  return (
    <>
      <Crumb href={deskPath("/licences")} label="Network licences" here={l.licensor} />
      <ControlTitle
        title={l.licensor}
        description={[l.name, coversLine(l)].filter(Boolean).join(". ")}
        end={
          <>
            <Tag variant={tag.variant}>{tag.text}</Tag>
            <Button size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </>
        }
      />
      {ending && <Notice className="nd-lic__notice" title={ending} />}
      <KeyValueList
        items={[
          { label: "Covers", value: l.covers.length ? l.covers.map((c) => c.title).join(", ") : "Nothing yet" },
          { label: "Where it can air", value: outletsLine(l.outlets) },
          { label: "Territory", value: territoryLine(l) },
          { label: "Dates", value: datesLine(l) },
          { label: "Deal", value: dealLine(l.deal) },
          ...(l.notes ? [{ label: "Notes", value: l.notes }] : [])
        ]}
      />

      <SecTop
        title="Minutes aired"
        sub="From the as-run log, for the licensor"
        end={
          <div className="nd-lic__month">
            <Button size="sm" variant="text" aria-label={`Back to ${monthWords(shiftMonth(month, -1))}`} onClick={() => go(shiftMonth(month, -1))}>
              Earlier
            </Button>
            <b aria-live="polite">{monthWords(month)}</b>
            <Button size="sm" variant="text" iconAfter="chev" aria-label={`On to ${monthWords(shiftMonth(month, 1))}`} onClick={() => go(shiftMonth(month, 1))}>
              Later
            </Button>
            <Button size="sm" onClick={csv} disabled={!report}>
              Download CSV
            </Button>
          </div>
        }
      />
      {minutes.isLoading ? (
        <Quiet />
      ) : minutes.error || !report ? (
        <ErrorLine error={minutes.error} />
      ) : report.stations.length ? (
        <>
          <StatRow size="sm" className="nd-cov" stats={minutesStats(report)} />
          <Table label={`Minutes aired in ${monthWords(month)}, by station`} columns={stationColumns} rows={report.stations} rowKey={(s) => s.station.id} rowPadding={9} className="nd-lic" />
          <SecTop title="By outlet" sub={report.outlets.map((o) => `${OUTLET_WORDS[o.outlet].label} ${amountWords(o.minutesAired)} min`).join(", ")} />
          <Table label={`Minutes aired in ${monthWords(month)}, by station and outlet`} columns={rowColumns} rows={report.rows} rowKey={(r) => `${r.station.id}:${r.outlet}`} rowPadding={9} className="nd-lic" />
        </>
      ) : (
        <p className="nd-lic__empty">Nothing it covers aired in {monthWords(month)}.</p>
      )}
      <p className="nd-lic__note">Opencast's own viewers come from its players; relay viewers from the platforms that report them; other apps' from their sessions (runs of playlist polls).</p>
      {editing && <LicenceForm licence={l} onClose={() => setEditing(false)} />}
    </>
  );
}
