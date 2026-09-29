// Offering 01.1 Offered by BEAT: every program the station makes, offered or not, with its terms
// and carriers; a request waiting sits on top in standby amber; this month's carriage money, barter
// and cash apart. Nested: a station asks (03.1, /requests/:requestId). On the phone, 05.2 and the
// request as a sheet (05.1).

import { useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { Button, ControlTitle, KeyValueList, money, Notice, Table, Tag, TitleCard, type Column } from "@opencast/ui";
import type { AgreementX, OfferX } from "../../api/ext/market";
import { useAgreements, useBrowse, useLibrary, useRequests } from "../../components/market/api";
import { useApproving } from "../../components/market/approvals";
import { MarketTabs, ProgramCard, Quietly, SectionTop } from "../../components/market/parts";
import { RequestDialog } from "../../components/market/RequestDialog";
import { agoWords, monthName } from "../../components/market/time";
import { approvalText, formatFromLibrary, formatLine, priceText, slotText, termNames, termsTwoLines } from "../../components/market/words";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { now } from "../../../lib/clock";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../common";
import "./Offered.css";

interface Row {
  key: string;
  programId: string;
  title: string;
  colour: string | null;
  format: string;
  state: "offered" | "not_offered" | "cannot";
  offer: OfferX | null;
}

export default function Offered() {
  const s = useStation();
  const phone = useIsPhone();
  const navigate = useNavigate();
  const { requestId } = useParams();
  const name = s.station.callSign ?? s.station.name;
  const library = useLibrary(s.id);
  const mine = useBrowse({ maker: s.id });
  const requests = useRequests(s.id);
  const agreements = useAgreements(s.id);
  const approving = useApproving();
  useShellOptions({ context: "Syndication market" });

  const rows = useMemo<Row[]>(() => {
    const offers = mine.data ?? [];
    const lib = library.data;
    const out: Row[] = [];
    for (const p of lib?.programs ?? []) {
      const offer = offers.find((o) => o.program.id === p.id) ?? null;
      const items = lib!.items.filter((i) => i.programId === p.id);
      const linked = items.some((i) => i.source === "link");
      const format = offer?.program.format ?? formatFromLibrary(p, items.map((i) => i.durationMs));
      out.push({ key: p.id, programId: p.id, title: p.title, colour: p.station.colour, format: linked ? "Imported from links" : formatLine({ ...p, format }), state: offer?.status === "offered" ? "offered" : linked ? "cannot" : "not_offered", offer });
    }
    // Offers of programs the library doesn't list (a studio's, until its library is mocked).
    for (const o of offers) if (!out.some((r) => r.programId === o.program.id)) out.push({ key: o.program.id, programId: o.program.id, title: o.program.title, colour: o.program.colour ?? null, format: formatLine(o.program), state: o.status === "offered" ? "offered" : "not_offered", offer: o });
    const rank = { offered: 0, not_offered: 1, cannot: 2 } as const;
    return out.sort((a, b) => rank[a.state] - rank[b.state] || (b.offer?.carriers ?? 0) - (a.offer?.carriers ?? 0) || a.title.localeCompare(b.title));
  }, [mine.data, library.data]);

  if (mine.isLoading || (library.isLoading && !library.error)) return <Quiet />;
  if (mine.error) return <Quietly role="alert">{mine.error.message}</Quietly>;

  const incoming = requests.data?.incoming ?? [];
  const waiting = incoming.filter((r) => r.status === "asked" && !approving.has(r.id));
  const approvedNow = (programId: string) => incoming.filter((r) => r.program.id === programId && (approving.has(r.id) || (r.status === "approved" && r.decidedAt && now().getTime() - Date.parse(r.decidedAt) < 24 * 3600e3)));
  const carriers = (r: Row) => (r.offer?.carriers ?? 0) + incoming.filter((q) => q.program.id === r.programId && approving.has(q.id)).length;
  const carriedBy = (agreements.data?.carriedBy ?? []).filter((a) => !a.endsAt);
  const paidFor = (programId: string) => carriedBy.filter((a) => a.program.id === programId).reduce((n, a) => n + a.paidThisMonthMicros, 0);
  const month = monthName(now());
  const open = requestId ? incoming.find((r) => r.id === requestId) : null;
  const dialog = requestId && (open ? <RequestDialog request={open} offer={mine.data?.find((o) => o.id === open.offerId) ?? null} onClose={() => navigate(`${s.base}/market/offered`)} /> : requests.isLoading ? null : <Quietly role="alert">That request wasn't found.</Quietly>);

  const requestNotices = waiting.map((r) => (
    <Notice
      key={r.id}
      className="cc-mk-offered__req"
      swatch={r.carrier.colour ?? undefined}
      channel={r.carrier.channel ?? undefined}
      title={`${r.carrier.callSign ?? r.carrier.name} wants to carry ${r.program.title}`}
      detail={`${slotText(r.slots)}, on ${termNames([r.term]).toLowerCase()} terms. Asked ${agoWords(r.createdAt, now().getTime())}`}
      action={
        <Button size="sm" href={`${s.base}/market/offered/requests/${r.id}`} aria-label={`Review ${r.carrier.callSign ?? r.carrier.name}'s request`}>
          Review
        </Button>
      }
    />
  ));

  if (phone) {
    return (
      <div className="cc-mk-offered-phone">
        <h1 className="cc-mk-offered-phone__h">Offered by {name}</h1>
        {requestNotices}
        <dl className="cc-mk-offered-phone__list">
          {rows.map((r) => {
            const approved = approvedNow(r.programId);
            const o = r.offer;
            const n = carriers(r);
            const detail =
              r.state === "cannot"
                ? `Imported, stays on ${name}`
                : r.state === "not_offered" || !o
                  ? "Not offered"
                  : o.termsOffered.includes("barter")
                    ? `${n} ${n === 1 ? "station" : "stations"}, ${money(paidFor(r.programId))} in ${month}`
                    : `${n} ${n === 1 ? "station" : "stations"}, ${termNames([o.termsOffered[0]!]).toLowerCase()} ${o.cashPriceMicros != null ? priceText(o.cashPriceMicros, o.cashPriceUnit) : ""}`.trim();
            return (
              <div key={r.key} className="cc-mk-offered-phone__row">
                <dt>
                  <b>{r.title}</b>
                  <small>{detail}</small>
                </dt>
                <dd>
                  {approved.length > 0 ? (
                    <Tag>Approved {approved.map((q) => q.carrier.callSign ?? q.carrier.name).join(", ")}</Tag>
                  ) : r.state === "not_offered" && s.can("programming") ? (
                    <Button size="sm" href={`${s.base}/market/offered/${r.programId}/offer`} aria-label={`Offer ${r.title}`}>
                      Offer
                    </Button>
                  ) : null}
                </dd>
              </div>
            );
          })}
        </dl>
        {dialog}
      </div>
    );
  }

  const columns: Column<Row>[] = [
    { key: "card", width: "104px", cell: (r) => (r.offer ? <ProgramCard offer={r.offer} className="cc-mk-offered__tc" /> : <TitleCard colour={r.colour ?? s.station.colour ?? "#26345A"} title={r.title} decorative className={`cc-mk-offered__tc${r.state === "cannot" ? " cc-mk-offered__tc--no" : ""}`} />) },
    {
      key: "program",
      header: "Program",
      cell: (r) => (
        <div className={`cc-mk-offered__prog${r.state === "cannot" ? " cc-mk-offered__prog--no" : ""}`}>
          <b>{r.title}</b>
          <small>{r.format}</small>
        </div>
      )
    },
    {
      key: "terms",
      header: "Terms",
      width: "210px",
      cell: (r) => {
        if (r.state === "cannot") return <span className="cc-mk-offered__terms cc-mk-offered__no">Can't be offered</span>;
        if (r.state === "not_offered" || !r.offer) return <span className="cc-mk-offered__terms cc-mk-offered__quiet">Not offered</span>;
        const t = termsTwoLines(r.offer, s.id);
        return (
          <div className="cc-mk-offered__terms">
            <em>{t.names}</em>
            {t.detail}
          </div>
        );
      }
    },
    {
      key: "by",
      header: "Carried by",
      width: "150px",
      cell: (r) => {
        if (r.state !== "offered" || !r.offer) return <span className={`cc-mk-offered__by${r.state === "not_offered" ? " cc-mk-offered__quiet" : " cc-mk-offered__no"}`}>Only on {name}</span>;
        const n = carriers(r);
        return (
          <span className="cc-mk-offered__by">
            {n} {n === 1 ? "station" : "stations"}
            <small>{approvalText(r.offer, s.id, "maker-list")}</small>
          </span>
        );
      }
    },
    {
      key: "acts",
      width: "130px",
      align: "end",
      cell: (r) => {
        const approved = approvedNow(r.programId);
        if (approved.length) return <Tag>Approved {approved.map((q) => q.carrier.callSign ?? q.carrier.name).join(", ")}</Tag>;
        if (r.state === "cannot") return <span className="cc-mk-offered__local">Link imports stay local</span>;
        if (!s.can("programming")) return r.offer && r.state === "offered" ? <Button size="sm" href={`${s.base}/market/offers/${r.offer.id}/carriers`}>Carriers</Button> : null;
        if (r.state === "not_offered")
          return (
            <Button size="sm" href={`${s.base}/market/offered/${r.programId}/offer`} aria-label={`Offer ${r.title}`}>
              Offer it
            </Button>
          );
        // Programs that need approval open their carriers (where requests are answered); the rest their terms.
        return r.offer!.approval === "i_approve" ? (
          <Button size="sm" href={`${s.base}/market/offers/${r.offer!.id}/carriers`} aria-label={`Carriers of ${r.title}`}>
            Carriers
          </Button>
        ) : (
          <Button size="sm" href={`${s.base}/market/offers/${r.offer!.id}/terms`} aria-label={`Edit terms of ${r.title}`}>
            Edit terms
          </Button>
        );
      }
    }
  ];

  return (
    <div className="cc-mk-offered">
      <ControlTitle title="Syndication market" />
      <MarketTabs value="offered" waiting={waiting.length} />
      {requestNotices}
      <Table label={`Programs ${name} makes`} columns={columns} rows={rows} rowKey={(r) => r.key} gap={14} rowPadding={11} className="cc-mk-offered__table" />
      {!rows.length && <Quietly>{name} has no programs yet. Programs you make in the library can be offered here.</Quietly>}
      {s.can("seeMoney") && <CarriageMoney name={name} carriedBy={carriedBy} />}
      {dialog}
    </div>
  );
}

/** "This month from carriage": barter share and cash fees apart, because a maker choosing between them needs to see which pays. */
function CarriageMoney({ name, carriedBy }: { name: string; carriedBy: AgreementX[] }) {
  const barter = carriedBy.filter((a) => a.term === "barter" || a.term === "cash_plus_barter");
  const cash = carriedBy.filter((a) => a.term === "cash");
  const who = (list: AgreementX[]) => [...new Set(list.map((a) => a.carrier.callSign ?? a.carrier.name))];
  const and = (l: string[]) => (l.length <= 1 ? (l[0] ?? "") : `${l.slice(0, -1).join(", ")} and ${l.at(-1)}`);
  const sum = (list: AgreementX[]) => list.reduce((n, a) => n + a.paidThisMonthMicros, 0);
  const airings = (list: AgreementX[]) => list.reduce((n, a) => n + a.airingsThisMonth, 0);
  const paying = (list: AgreementX[]) => list.filter((a) => a.paidThisMonthMicros > 0);
  const cashDetail =
    paying(cash).length === 1
      ? `${paying(cash)[0]!.program.title} on ${paying(cash)[0]!.carrier.callSign ?? paying(cash)[0]!.carrier.name}, ${airings(paying(cash))} airings`
      : paying(cash).length
        ? `${airings(paying(cash))} airings on ${and(who(paying(cash)))}`
        : "None this month";
  return (
    <section className="cc-mk-offered__money" aria-labelledby="cc-mk-offered-money">
      <SectionTop title={<span id="cc-mk-offered-money">This month from carriage</span>} sub={`Settled into ${name}'s Clear account`} />
      <KeyValueList
        variant="rows"
        items={[
          { title: "Your share of break time on other stations", detail: paying(barter).length ? `Barter, from ${and(who(paying(barter)))}` : "None this month", amount: sum(barter) },
          { title: "Cash fees for airings", detail: cashDetail, amount: sum(cash) }
        ]}
      />
    </section>
  );
}
