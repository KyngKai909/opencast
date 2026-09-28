// biz-results 02.1 every airing with its proof frame (/results/airings, /results/airings/:asRunId).
// Every airing from the as-run log, newest first: when, which station and program, how much of the
// spot aired (short airings in standby, with the reason), people tuned in and cost. Choosing one
// shows the frame captured as it aired and the log entry behind it. The month's airings come with
// the results (spots.getResults); `?spot=` lists one spot's airings of all time
// (spots.listSpotAirings); `?station=` narrows either to one station. Download CSV writes the rows
// shown (P15: no CSV endpoint yet).

import { useNavigate, useParams, useSearchParams } from "react-router";
import { spotsApi } from "@opencast/contracts";
import { Button, ControlTitle, Lines, Table, money, type Column } from "@opencast/ui";
import { SpotAiringsX, type ResultsAiringX } from "../../api/ext/results";
import { useApi } from "../../api/hooks";
import { useBusiness } from "../../business/BusinessContext";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { useNow } from "../../lib/clock";
import { airedWords, airingsCsv, andList, rowTime, saveText, slug } from "../../components/results/format";
import { ProofPanel } from "../../components/results/ProofPanel";
import { selectionFrom, useResults } from "../../components/results/useResults";
import { Quiet } from "../common";
import "./Airings.css";

export default function Airings() {
  const b = useBusiness();
  const phone = useIsPhone();
  const now = useNow(60_000);
  const navigate = useNavigate();
  const { asRunId } = useParams();
  const [params] = useSearchParams();
  const spotId = params.get("spot");
  const stationId = params.get("station");
  const sel = selectionFrom(params, now);
  useShellOptions({ title: "Airings" });

  const month = useResults(b.id, sel, !spotId);
  const bySpot = useApi(spotsApi.listSpotAirings, { params: { spotId: spotId ?? "" } }, { schema: SpotAiringsX, enabled: !!spotId });
  const q = spotId ? bySpot : month;
  const all: ResultsAiringX[] = (spotId ? bySpot.data?.aired : month.data?.airings) ?? [];
  const rows = stationId ? all.filter((a) => a.station.id === stationId) : all;
  const selected = rows.find((a) => a.asRunId === asRunId) ?? (phone ? undefined : rows[0]);
  const search = params.toString() ? `?${params}` : "";

  const titles = [...new Map(rows.map((a) => [a.spot.id, a.spot.title])).values()];
  const counts = new Map<string, number>();
  for (const a of rows) counts.set(a.spot.title, (counts.get(a.spot.title) ?? 0) + 1);
  titles.sort((x, y) => (counts.get(y) ?? 0) - (counts.get(x) ?? 0));
  const onStation = stationId && rows[0] ? ` on ${rows[0].station.callSign} ${rows[0].station.channel}` : "";
  const description = rows.length ? `${andList(titles)}${onStation}. Newest first.` : undefined;

  const download = () => {
    const what = spotId ? slug(titles[0] ?? "spot") : sel.period === "month" ? sel.month : sel.period;
    saveText(`${slug(b.business.name)}-airings-${what}.csv`, airingsCsv(rows.map((a) => ({ ...a, station: { callSign: a.station.callSign, channel: a.station.channel } }))));
  };

  const columns: Column<ResultsAiringX>[] = [
    { key: "at", header: "Aired", width: phone ? "86px" : "104px", cell: (a) => <span className="bz-air__t">{rowTime(a.startedAt, now)}</span> },
    ...(phone
      ? []
      : [
          {
            key: "st",
            header: "Station",
            width: "76px",
            cell: (a: ResultsAiringX) => (
              <span className="bz-air__st">
                <span className="bz-air__ch">{a.station.channel}</span> {a.station.callSign}
              </span>
            )
          } satisfies Column<ResultsAiringX>
        ]),
    {
      key: "in",
      header: "In",
      cell: (a) => (
        <Lines
          title={a.programContext ?? (phone ? `${a.station.callSign} ${a.station.channel}` : "In a break")}
          detail={[phone && a.programContext ? `${a.station.callSign}, ${a.spot.title}` : a.spot.title, a.shortReason].filter(Boolean).join(". ")}
        />
      )
    },
    {
      key: "aired",
      header: "Aired",
      width: "84px",
      kind: "amount",
      cell: (a) => <span className={a.inFull ? undefined : "oc-table__cell--short"}>{airedWords(a.airedMs, a.spot.lengthSec)}</span>
    },
    ...(phone ? [] : [{ key: "tuned", header: "Tuned in", width: "64px", kind: "amount", cell: (a: ResultsAiringX) => a.tunedIn.toLocaleString("en-US") } satisfies Column<ResultsAiringX>]),
    { key: "cost", header: "Cost", width: "60px", kind: "amount", cell: (a) => money(a.costMicros) }
  ];

  const empty = spotId ? "This spot hasn't aired yet." : "Nothing has aired yet.";

  return (
    <div className="bz-air">
      <ControlTitle
        title="Airings"
        description={description}
        end={
          rows.length ? (
            <Button size="sm" onClick={download}>
              Download CSV
            </Button>
          ) : undefined
        }
      />
      {q.isLoading ? (
        <Quiet />
      ) : q.error ? (
        <p className="bz-air__error" role="alert">
          {q.error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="bz-air__quiet">{empty}</p>
      ) : (
        <div className="bz-air__split">
          {phone && selected && <ProofPanel airing={selected} now={now} />}
          <Table<ResultsAiringX>
            label="Airings"
            className="bz-air__table"
            columns={columns}
            rows={rows}
            rowKey={(a) => a.asRunId}
            selectedKey={selected?.asRunId}
            onSelect={(a) => navigate(`${b.base}/results/airings/${a.asRunId}${search}`, { replace: !!asRunId })}
            rowPadding={10}
            gap={10}
          />
          {!phone && selected && <ProofPanel airing={selected} now={now} />}
        </div>
      )}
    </div>
  );
}
