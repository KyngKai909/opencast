// Market 04.1 a studio: Your programs (/:handle/programs). A studio makes programs and doesn't
// broadcast: what it offers, who carries it, what it earned, and the way to a channel of its own.

import { type Offer } from "@opencast/contracts";
import { Navigate } from "react-router";
import { Button, ControlTitle, StatRow, Table, type Column } from "@opencast/ui";
import { useAgreements, useBrowse } from "../../components/market/api";
import { ProgramCard, Quietly } from "../../components/market/parts";
import { monthName } from "../../components/market/time";
import { formatLine, termsTwoLines } from "../../components/market/words";
import { now } from "../../../lib/clock";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../common";
import "./Studio.css";
import { controlPath } from "../../../areas";

export default function StudioPrograms() {
  const s = useStation();
  const offers = useBrowse({ maker: s.id }, s.studio);
  const agreements = useAgreements(s.id, s.studio);
  if (!s.studio) return <Navigate to={`${s.base}/market/offered`} replace />;
  if (offers.isLoading || agreements.isLoading) return <Quiet />;
  if (offers.error) return <Quietly role="alert">{offers.error.message}</Quietly>;
  const offered = (offers.data ?? []).filter((o) => o.status === "offered");
  const carriedBy = (agreements.data?.carriedBy ?? []).filter((a) => !a.endsAt || a.endsAt > now().toISOString());
  const stations = new Set(carriedBy.map((a) => a.carrier.id)).size;
  const earned = carriedBy.reduce((n, a) => n + a.paidThisMonthMicros, 0);
  const columns: Column<Offer>[] = [
    { key: "card", width: "104px", cell: (o) => <ProgramCard offer={o} className="cc-mk-studio__tc" /> },
    {
      key: "program",
      header: "Program",
      cell: (o) => (
        <div className="cc-mk-studio__prog">
          <b>{o.program.title}</b>
          <small>{formatLine(o.program)}</small>
        </div>
      )
    },
    {
      key: "terms",
      header: "Terms",
      width: "210px",
      cell: (o) => {
        const t = termsTwoLines(o, s.id);
        return (
          <div className="cc-mk-studio__terms">
            <em>{t.names}</em>
            {t.detail}
          </div>
        );
      }
    },
    { key: "by", header: "Carried by", width: "150px", cell: (o) => <span className="cc-mk-studio__by">{o.carriers} {o.carriers === 1 ? "station" : "stations"}</span> },
    {
      key: "acts",
      width: "130px",
      align: "end",
      cell: (o) => (
        <Button size="sm" href={`${s.base}/market/offers/${o.id}/carriers`} aria-label={`Carriers of ${o.program.title}`}>
          Carriers
        </Button>
      )
    }
  ];
  return (
    <div className="cc-mk-studio">
      <ControlTitle
        title={s.station.name}
        description="A studio. Your programs air on the stations that carry them."
        end={
          s.can("programming") && (
            <Button variant="primary" size="sm" href={`${s.base}/market/offered`}>
              Offer a program
            </Button>
          )
        }
      />
      <StatRow
        size="sm"
        className="cc-mk-studio__stats"
        stats={[
          { value: String(offered.length), caption: "Programs offered" },
          { value: String(stations), caption: "Stations carrying them" },
          ...(s.can("seeMoney") ? [{ amount: earned, caption: `Earned in ${monthName(now())}` }] : [])
        ]}
      />
      <Table label="Your programs" columns={columns} rows={offered} rowKey={(o) => o.id} gap={14} rowPadding={11} className="cc-mk-studio__table" />
      {!offered.length && <Quietly>Nothing is offered yet. Offer a program and stations can carry it.</Quietly>}
      <div className="cc-mk-studio__note">
        <div>
          <b>Want your own channel?</b>
          <small>Claim a place on the dial and your programs can air on your own station too. Everything here comes with you.</small>
        </div>
        {s.can("manage") && <Button href={controlPath("/new")}>Claim a channel</Button>}
      </div>
    </div>
  );
}
