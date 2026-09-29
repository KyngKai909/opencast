// Statements (/earnings/statements): every weekly statement, newest first, each opening its page
// (03.1). No frame draws this list; Earnings' "Statements" button leads here.

import { useNavigate } from "react-router";
import { ledgerApi } from "@opencast/contracts";
import { ControlTitle, Lines, Table, money, type Column } from "@opencast/ui";
import type { Statement } from "@opencast/contracts";
import { useApi } from "../../../api/hooks";
import { statementSubtitle, statementTitle } from "../../components/earnings/lines";
import { useShellOptions } from "../../layout/shell";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../common";
import "./Statement.css";

export default function Statements() {
  const s = useStation();
  const navigate = useNavigate();
  useShellOptions({ context: "Earnings" });
  const list = useApi(ledgerApi.listStationStatements, { params: { stationId: s.id } });
  const rows = [...(list.data ?? [])].sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  const columns: Column<Statement>[] = [
    { key: "week", header: "Week", cell: (r) => <Lines title={statementTitle(r)} detail={statementSubtitle(r).replace(/\.$/, "")} /> },
    { key: "amount", header: "Paid out", width: "140px", kind: "amount", cell: (r) => money(r.lines.reduce((a, l) => a + l.amountMicros, 0)) }
  ];
  return (
    <div className="cc-stmt">
      <ControlTitle title="Statements" description="Every weekly payout, with the airings and lines behind it." />
      {list.isLoading ? (
        <Quiet />
      ) : list.error ? (
        <p className="cc-stmt__error" role="alert">
          {list.error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="cc-stmt__error">No statements yet. The first comes the Monday after a week of earnings is paid out.</p>
      ) : (
        <Table<Statement> label="Statements" columns={columns} rows={rows} rowKey={(r) => r.id} onSelect={(r) => navigate(`${s.base}/earnings/statements/${r.id}`)} rowPadding={10} gap={16} />
      )}
    </div>
  );
}
