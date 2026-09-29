// Reserved call signs (a rail page no frame draws): the waitlist's reservations in the market, and
// the channels held for them. A held channel shows hatched on the board and can't go to anyone else.
import { waitlistApi } from "@opencast/contracts";
import { ControlTitle, Table, type Column } from "@opencast/ui";
import { useApi } from "../../api/hooks";
import { useMarket } from "../layout/market";
import { DEFAULT_TZ } from "../../lib/clock";
import { dayMonth } from "../lib/dates";
import { ErrorLine, NotFound, Quiet } from "./common";
import "./Held.css";

type Row = (typeof waitlistApi.listReservations.response)["_output"][number];

export default function Reserved() {
  const { market, loading } = useMarket();
  const list = useApi(waitlistApi.listReservations, { query: { marketId: market?.id } }, { enabled: !!market });
  if (loading || list.isLoading) return <Quiet />;
  if (!market) return <NotFound />;
  if (list.error) return <ErrorLine error={list.error} />;
  const tz = market.timezone || DEFAULT_TZ;
  const rows = [...(list.data ?? [])].sort((a, b) => Number(!!b.channel) - Number(!!a.channel) || a.callSign.localeCompare(b.callSign));
  const columns: Column<Row>[] = [
    { key: "callSign", header: "Call sign", width: "120px", cell: (r) => <b className="nd-reserved__cs">{r.callSign}</b> },
    { key: "channel", header: "Channel held", width: "140px", cell: (r) => (r.channel ? <span className="nd-mono">{r.channel}</span> : <span className="nd-ok__quiet">None yet</span>) },
    { key: "until", header: "Held until", width: "150px", cell: (r) => (r.heldUntil ? dayMonth(r.heldUntil, tz) : "") },
    { key: "asked", header: "Asked", width: "130px", cell: (r) => dayMonth(r.createdAt, tz) },
    { key: "email", header: "From", cell: (r) => r.email ?? "" }
  ];
  const held = rows.filter((r) => r.channel).length;
  return (
    <>
      <ControlTitle title="Reserved call signs" description={`${rows.length} call signs reserved from the waitlist in the ${market.name}, ${held} with a channel held.`} />
      {rows.length ? <Table label="Reserved call signs" columns={columns} rows={rows} rowKey={(r) => r.id} rowPadding={9} /> : <p className="nd-held__empty">Nobody in the {market.name} has reserved a call sign yet.</p>}
    </>
  );
}
