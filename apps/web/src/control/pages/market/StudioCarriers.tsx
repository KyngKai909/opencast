// A studio's Carriers (/:handle/carriers): every station carrying its programs, grouped by program,
// with when each airs it and what it paid this month. No frame draws it; it's the carriers page
// (offering 04.1) for all of the studio's programs at once.

import { type Agreement } from "@opencast/contracts";
import { Navigate } from "react-router";
import { Button, ControlTitle, money, Table, type Column } from "@opencast/ui";
import { useAgreements } from "../../components/market/api";
import { Quietly } from "../../components/market/parts";
import { localDate, monthDay, monthName } from "../../components/market/time";
import { slotText, stationWords, termNames } from "../../components/market/words";
import { now } from "../../../lib/clock";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../common";
import "./Carriers.css";

export default function StudioCarriers() {
  const s = useStation();
  const agreements = useAgreements(s.id, s.studio);
  if (!s.studio) return <Navigate to={`${s.base}/market/offered`} replace />;
  if (agreements.isLoading) return <Quiet />;
  if (agreements.error) return <Quietly role="alert">{agreements.error.message}</Quietly>;
  const month = monthName(now());
  const list = (agreements.data?.carriedBy ?? []).filter((a) => !a.endsAt || a.endsAt > now().toISOString());
  const programs = [...new Map(list.map((a) => [a.program.id, a])).values()].map((a) => a.program);
  const groups = programs.map((p) => {
    const rows = list.filter((a) => a.program.id === p.id);
    const paid = rows.reduce((n, a) => n + a.paidThisMonthMicros, 0);
    return {
      title: p.title,
      sub: `${rows.length} ${rows.length === 1 ? "station" : "stations"}`,
      end: (
        <>
          {s.can("seeMoney") && <span className="cc-mk-car__m">{money(paid)}</span>}
          {rows[0]?.offerId && (
            <Button size="sm" href={`${s.base}/market/offers/${rows[0].offerId}/carriers`} aria-label={`Carriers of ${p.title}`}>
              Open
            </Button>
          )}
        </>
      ),
      rows
    };
  });
  const columns: Column<Agreement>[] = [
    { key: "sw", width: "14px", cell: (a) => <span className="cc-mk-car__sw" style={{ background: a.carrier.colour ?? undefined }} aria-hidden="true" /> },
    { key: "ch", header: "Ch.", width: "50px", kind: "mono", cell: (a) => a.carrier.channel ?? "" },
    {
      key: "station",
      header: "Station",
      cell: (a) => (
        <div className="cc-mk-car__words">
          <b>{stationWords(a.carrier, "named")}</b>
          <small>
            {a.carrier.band === "radio" ? "Radio band" : "TV band"}, since {monthDay(localDate(a.startedAt))}
          </small>
        </div>
      )
    },
    { key: "airs", header: "Airs it", width: "170px", cell: (a) => slotText(a.slots ?? [], "comma") },
    { key: "deal", header: "Deal", width: "120px", cell: (a) => termNames([a.term]) },
    {
      key: "month",
      header: month,
      width: "120px",
      align: "end",
      cell: (a) => (
        <span className="cc-mk-car__m">
          {s.can("seeMoney") ? money(a.paidThisMonthMicros) : null}
          <small>
            {a.airingsThisMonth} {a.airingsThisMonth === 1 ? "airing" : "airings"}
          </small>
        </span>
      )
    }
  ];
  return (
    <div className="cc-mk-carriers">
      <ControlTitle title="Carriers" description={`Stations carrying your programs, and what each paid in ${month}.`} />
      <Table label="Stations carrying your programs" columns={columns} groups={groups} rowKey={(a) => a.id} rowPadding={12} header />
      {!groups.length && <Quietly>No station carries your programs yet.</Quietly>}
    </div>
  );
}
