// Carried by BEAT (/market/carried): the market's third tab, what the station carries from other
// makers, on what deal and when it airs. No frame draws it; it's the Browse row's layout with the
// station's own schedule (see the report).

import { type Agreement, type Offer } from "@opencast/contracts";
import { Button, ControlTitle, Table, TitleCard, type Column } from "@opencast/ui";
import { useAgreements, useBrowse, useRequests } from "../../components/market/api";
import { MarketTabs, Quietly } from "../../components/market/parts";
import { localDate, monthDay } from "../../components/market/time";
import { slotText, stationWords, termDetail, termNames } from "../../components/market/words";
import { useShellOptions } from "../../layout/shell";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../common";
import "./Market.css";
import { stationLabel } from "../../station/slug";

export default function Carried() {
  const s = useStation();
  const agreements = useAgreements(s.id);
  const offers = useBrowse({ forStation: s.id });
  const requests = useRequests(s.id);
  useShellOptions({ context: "Syndication market" });
  if (agreements.isLoading) return <Quiet />;
  if (agreements.error) return <Quietly role="alert">{agreements.error.message}</Quietly>;
  const name = s.label;
  const offerOf = (a: Agreement): Offer | undefined => offers.data?.find((o) => o.id === a.offerId);
  const rows = agreements.data?.carrying ?? [];
  const waiting = requests.data?.incoming.filter((r) => r.status === "asked").length ?? 0;
  const asked = requests.data?.outgoing.filter((r) => r.status === "asked") ?? [];
  const columns: Column<Agreement>[] = [
    { key: "card", width: "112px", cell: (a) => <TitleCard colour={offerOf(a)?.program.colour ?? a.maker.colour ?? "#26345A"} title={a.program.title} decorative className="cc-mk__tc" /> },
    {
      key: "program",
      header: "Program",
      cell: (a) => (
        <div className="cc-mk__prog">
          <b>{a.program.title}</b>
          <small>From {a.maker.kind === "catalog" ? "Opencast catalog" : stationWords(a.maker)}</small>
          <small>{a.endsAt ? `Ends ${monthDay(localDate(a.endsAt))}` : `Since ${monthDay(localDate(a.startedAt))}`}</small>
        </div>
      )
    },
    {
      key: "terms",
      header: "Terms",
      width: "210px",
      cell: (a) => {
        const o = offerOf(a);
        const d = o ? termDetail({ ...o, ...a.terms }, a.term, s.id) : null;
        return (
          <div className="cc-mk__terms">
            <em>{termNames([a.term])}</em>
            {d}
          </div>
        );
      }
    },
    { key: "airs", header: "Airs it", width: "170px", cell: (a) => <span className="cc-mk__by">{a.slots?.length ? slotText(a.slots) : ""}</span> },
    {
      key: "acts",
      width: "110px",
      align: "end",
      cell: (a) => (
        <Button size="sm" href={`${s.base}/market/offers/${a.offerId}`} aria-label={`Open ${a.program.title}`}>
          Open
        </Button>
      )
    }
  ];
  return (
    <div className="cc-mk">
      <ControlTitle title="Syndication market" />
      <MarketTabs value="carried" waiting={waiting} />
      <Table label={`Programs ${name} carries`} columns={columns} rows={rows} rowKey={(a) => a.id} gap={14} rowPadding={10} className="cc-mk__table" />
      {!rows.length && <Quietly>{name} doesn't carry any programs yet. Browse the market for one that fits.</Quietly>}
      {asked.length > 0 && (
        <p className="cc-mk-quiet">
          Asked, waiting for the maker: {asked.map((r) => `${r.program.title} from ${stationLabel(r.maker)}`).join("; ")}.
        </p>
      )}
    </div>
  );
}
