// Offering 04.1 who carries it (/market/offers/:offerId/carriers): each station, when it airs the
// program, on what deal, this month's airings and what that paid. Three numbers only: no audience
// figures from other stations. Ending carriage with one station gives the notice the terms promise.

import { useState } from "react";
import { useParams } from "react-router";
import { catalogApi } from "@opencast/contracts";
import { Button, ControlTitle, Menu, Modal, money, StatRow, Table, useToast, type Column } from "@opencast/ui";
import { call } from "../../api/client";
import { AgreementX, OfferX, type CarriageRequestX } from "../../api/ext/market";
import { useAgreements, useOffer, useRefreshMarket, useRequests } from "../../components/market/api";
import { Quietly } from "../../components/market/parts";
import { localDate, monthDay, monthName } from "../../components/market/time";
import { approvalText, slotText, stationWords, termNames } from "../../components/market/words";
import { useShellOptions } from "../../layout/shell";
import { now } from "../../lib/clock";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../common";
import "./Carriers.css";

type Row = { kind: "carrier"; a: AgreementX } | { kind: "asked"; r: CarriageRequestX };

function dayWords(iso: string): string {
  const d = localDate(iso);
  const today = localDate(now());
  if (d === today) return "today";
  return monthDay(d);
}

export default function Carriers() {
  const s = useStation();
  const { offerId = "" } = useParams();
  const offer = useOffer(offerId, null);
  const agreements = useAgreements(s.id);
  const requests = useRequests(s.id);
  const refresh = useRefreshMarket();
  const toast = useToast();
  const [ending, setEnding] = useState<AgreementX | null>(null);
  const [busy, setBusy] = useState(false);
  useShellOptions({ context: "Syndication market" });

  if (offer.isLoading || agreements.isLoading) return <Quiet />;
  if (offer.error || !offer.data) return <Quietly role="alert">{offer.error?.message ?? "That program isn't offered."}</Quietly>;
  const o = offer.data;
  const name = s.station.callSign ?? s.station.name;
  if (o.maker.id !== s.id) return <Quietly role="alert">Only {o.maker.callSign ?? o.maker.name} sees who carries {o.program.title}.</Quietly>;

  const carrying = (agreements.data?.carriedBy ?? []).filter((a) => a.offerId === o.id || a.program.id === o.program.id);
  const active = carrying.filter((a) => !a.endsAt || a.endsAt > now().toISOString());
  const asked = (requests.data?.incoming ?? []).filter((r) => r.offerId === o.id && r.status === "asked");
  const rows: Row[] = [...active.map((a) => ({ kind: "carrier" as const, a })), ...asked.map((r) => ({ kind: "asked" as const, r }))];
  const month = monthName(now());
  const airings = active.reduce((n, a) => n + a.airingsThisMonth, 0);
  const paid = active.reduce((n, a) => n + a.paidThisMonthMicros, 0);
  const acts = s.can("programming");

  const stop = async (status: "offered" | "withdrawn") => {
    try {
      await call(catalogApi.updateOffer, { params: { offerId: o.id }, body: { status } }, OfferX);
      refresh();
      if (status === "withdrawn")
        toast.show({ message: `${o.program.title} is no longer offered. Stations carrying it keep it until they end.`, onUndo: () => void stop("offered") });
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : "Something went wrong. Try again." });
    }
  };

  const giveNotice = async () => {
    if (!ending) return;
    setBusy(true);
    try {
      const a = await call(catalogApi.endAgreement, { params: { agreementId: ending.id } }, AgreementX);
      refresh();
      toast.show({ message: `Notice given. ${a.carrier.callSign ?? a.carrier.name} carries ${o.program.title} until ${a.endsAt ? monthDay(localDate(a.endsAt)) : "the notice ends"}.` });
      setEnding(null);
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : "Something went wrong. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const station = (row: Row) => (row.kind === "carrier" ? row.a.carrier : row.r.carrier);
  const columns: Column<Row>[] = [
    { key: "sw", width: "14px", cell: (row) => <span className="cc-mk-car__sw" style={{ background: station(row).colour ?? undefined }} aria-hidden="true" /> },
    { key: "ch", header: "Ch.", width: "50px", kind: "mono", cell: (row) => <span className={row.kind === "asked" ? "cc-mk-car--asked" : undefined}>{station(row).channel ?? ""}</span> },
    {
      key: "station",
      header: "Station",
      cell: (row) => {
        const st = station(row);
        const band = st.band === "radio" ? "Radio band" : "TV band";
        const detail =
          row.kind === "asked"
            ? `Asked ${dayWords(row.r.createdAt)}`
            : row.a.endsAt
              ? `${band}, ends ${monthDay(localDate(row.a.endsAt))}`
              : `${band}, since ${monthDay(localDate(row.a.startedAt))}`;
        return (
          <div className={`cc-mk-car__words${row.kind === "asked" ? " cc-mk-car--asked" : ""}`}>
            <b>{stationWords(st, "named")}</b>
            <small>{detail}</small>
          </div>
        );
      }
    },
    { key: "airs", header: "Airs it", width: "170px", cell: (row) => <span className={row.kind === "asked" ? "cc-mk-car--asked" : undefined}>{slotText(row.kind === "carrier" ? (row.a.slots ?? []) : row.r.slots, "comma")}</span> },
    { key: "deal", header: "Deal", width: "120px", cell: (row) => <span className={row.kind === "asked" ? "cc-mk-car--asked" : undefined}>{termNames([row.kind === "carrier" ? row.a.term : row.r.term])}</span> },
    {
      key: "month",
      header: month,
      width: "120px",
      align: "end",
      cell: (row) =>
        row.kind === "asked" ? (
          <Button size="sm" href={`${s.base}/market/offered/requests/${row.r.id}`} aria-label={`Review ${row.r.carrier.callSign ?? row.r.carrier.name}'s request`}>
            Review
          </Button>
        ) : (
          <span className="cc-mk-car__m">
            {s.can("seeMoney") ? money(row.a.paidThisMonthMicros) : null}
            <small>
              {row.a.airingsThisMonth} {row.a.airingsThisMonth === 1 ? "airing" : "airings"}
            </small>
          </span>
        )
    },
    ...(acts
      ? [
          {
            key: "more",
            width: "40px",
            align: "end" as const,
            cell: (row: Row) =>
              row.kind === "carrier" && !row.a.endNoticeGivenAt ? <Menu label={`More for ${row.a.carrier.callSign ?? row.a.carrier.name}`} items={[{ label: "End carriage", danger: true, onSelect: () => setEnding(row.a) }]} /> : null
          }
        ]
      : [])
  ];

  return (
    <div className="cc-mk-carriers">
      <ControlTitle
        title={`${o.program.title}, carriers`}
        description={`Offered on ${termNames(o.termsOffered).toLowerCase()}. ${o.approval === "i_approve" ? "You approve each station." : `${approvalText(o, s.id)} can carry it.`}${o.status === "withdrawn" ? " No longer offered to new carriers." : ""}`}
        end={
          acts && (
            <>
              <Button size="sm" href={`${s.base}/market/offers/${o.id}/terms`}>
                Edit terms
              </Button>
              {o.status === "offered" ? (
                <Button size="sm" onClick={() => void stop("withdrawn")}>
                  Stop offering
                </Button>
              ) : (
                <Button size="sm" onClick={() => void stop("offered")}>
                  Offer it again
                </Button>
              )}
            </>
          )
        }
      />
      <StatRow
        size="sm"
        className="cc-mk-carriers__stats"
        stats={[
          { value: String(active.length), caption: active.length === 1 ? "Station carrying it" : "Stations carrying it" },
          { value: String(airings), caption: `Airings in ${month}, on other stations` },
          ...(s.can("seeMoney") ? [{ amount: paid, caption: `Paid to ${name} in ${month}` }] : [])
        ]}
      />
      <Table label={`Stations carrying ${o.program.title}`} columns={columns} rows={rows} rowKey={(row) => (row.kind === "carrier" ? row.a.id : row.r.id)} rowPadding={12} className="cc-mk-carriers__table" />
      {!rows.length && <Quietly>No station carries it yet.</Quietly>}
      {active.some((a) => a.term !== "cash") && <p className="cc-mk-carriers__note">Barter pays from your share of break time on their station, settled from each airing.</p>}
      {ending && (
        <Modal
          open
          onClose={() => setEnding(null)}
          title={`End carriage with ${ending.carrier.callSign ?? ending.carrier.name}?`}
          footer={
            <>
              <Button variant="primary" onClick={giveNotice} disabled={busy}>
                Give notice
              </Button>
              <Button onClick={() => setEnding(null)}>Keep it</Button>
            </>
          }
        >
          <p className="cc-mk-carriers__confirm">
            {ending.carrier.callSign ?? ending.carrier.name} is told now, and {o.program.title} stays on its log for the {ending.terms.noticeDays} days' notice the terms promise.
          </p>
        </Modal>
      )}
    </div>
  );
}
