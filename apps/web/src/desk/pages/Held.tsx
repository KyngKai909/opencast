// 07.1 Held earnings: every claimable station's money, held in the escrow contract under the
// station's ID. None of it is Opencast's: the contract has no way to pay Opencast.

import { networkApi } from "@opencast/contracts";
import { ControlTitle, KeyValueList, Lines, money, StatRow, Table, type Column } from "@opencast/ui";
import { useApi } from "../../api/hooks";
import { HeldEarningsX, type HeldStationX } from "../api/ext";
import { heldFigures, rowHeld, shortAddress, stationDetail, stationTitle, statusOf } from "../components/held/held";
import { Stg } from "../components/pipeline/StageTag";
import { DEFAULT_TZ, now } from "../../lib/clock";
import { ErrorLine, Quiet, SecTop } from "./common";
import "./Held.css";
import "./Board.css";

export default function Held() {
  const held = useApi(networkApi.heldEarnings, {}, { schema: HeldEarningsX });
  if (held.isLoading) return <Quiet />;
  if (held.error || !held.data) return <ErrorLine error={held.error} />;
  const h = held.data;
  const f = heldFigures(h);
  const tz = DEFAULT_TZ;
  const columns: Column<HeldStationX>[] = [
    { key: "station", header: "Station", cell: (s) => <Lines title={stationTitle(s)} detail={stationDetail(s, tz, now())} /> },
    { key: "escrow", header: "In escrow as", width: "180px", kind: "mono", cell: (s) => `Station #${s.escrowStationId}` },
    { key: "held", header: "Held", width: "160px", kind: "amount", cell: (s) => money(rowHeld(s)) },
    {
      key: "status",
      header: "Status",
      width: "150px",
      cell: (s) => {
        const st = statusOf(s, tz);
        return <Stg look={st.look}>{st.text}</Stg>;
      }
    }
  ];
  const period = f.period ?? "the unclaimed period";
  const address = h.contractAddress;
  return (
    <>
      <ControlTitle title="Held earnings" description="Money earned by stations Opencast runs for creators. None of it is Opencast's." />
      <StatRow
        size="sm"
        className="nd-cov"
        stats={[
          { value: f.total, caption: f.heldAcross },
          { value: String(f.invitations), caption: f.invitations === 1 ? "Claim invitation out" : "Claim invitations out" },
          { value: f.moved, caption: "Ever moved to Opencast. It can't be" },
          { value: f.period ?? "Not set yet", caption: "Unclaimed until it goes to the creator fund" }
        ]}
      />
      {h.stations.length ? (
        <Table label="Held earnings by station" columns={columns} rows={h.stations} rowKey={(s) => s.station.id} rowPadding={11} className="nd-held" />
      ) : (
        <p className="nd-held__empty">Nothing held yet. A claimable station's earnings show here from its first week on air.</p>
      )}
      <SecTop title="Where held money can go" />
      <KeyValueList
        variant="rows"
        className="nd-held__ways"
        items={[
          { title: "To the creator, when they claim", detail: "Paid to the wallet made when they sign in, after verification and a 72-hour public waiting period" },
          { title: "To the creator, if they say stop", detail: "Paid out to them within a week of the station signing off" },
          { title: "To the creator fund, if never claimed", detail: `After ${period} with no claim, the fund that backs new stations and programs` },
          { title: "Nowhere else", detail: "The contract has no other way to send money. Not to Opencast, not to another station, not to cover costs" },
          {
            title: "Escrow contract",
            detail: address ? "Public, with every deposit and payout visible" : "Not deployed yet. Earnings are recorded, and move into it when it is",
            actions: address ? (
              h.chain ? (
                <a className="nd-held__addr" href={`${h.chain.explorerUrl.replace(/\/+$/, "")}/address/${address}`} target="_blank" rel="noopener" title={`${address}, on ${h.chain.name}`}>
                  {shortAddress(address)}
                </a>
              ) : (
                <span className="nd-held__addr" title={address}>
                  {shortAddress(address)}
                </span>
              )
            ) : undefined
          }
        ]}
      />
    </>
  );
}
