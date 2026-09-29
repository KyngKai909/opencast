// earnings 03.1 a weekly statement (/earnings/statements/:statementId): from each airing to the
// payout. Spots by advertiser with their math, sponsors and pledges, carriage both ways, the shared
// lines (not set yet), card fees at cost, and what was paid out. Download CSV is owners' (the API's
// rule; inventory worth raising 12): operators read the page without it.

import { useState } from "react";
import { useParams } from "react-router";
import { ledgerApi } from "@opencast/contracts";
import { Button, ControlTitle, useToast } from "@opencast/ui";
import { ApiError, call } from "../../../api/client";
import { useApi } from "../../../api/hooks";
import { saveText } from "../../components/earnings/download";
import { statementSections, statementSubtitle, statementTitle } from "../../components/earnings/lines";
import { MoneyRows, Section } from "../../components/earnings/Section";
import { useShellOptions } from "../../layout/shell";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../common";
import "./Statement.css";

export default function Statement() {
  const s = useStation();
  const { statementId = "" } = useParams();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  useShellOptions({ context: "Earnings" });

  const list = useApi(ledgerApi.listStationStatements, { params: { stationId: s.id } });
  const st = list.data?.find((x) => x.id === statementId);

  if (list.isLoading) return <Quiet />;
  if (!st)
    return (
      <div className="cc-stmt">
        <ControlTitle title="Statements" />
        <p className="cc-stmt__error" role="alert">
          {list.error?.message ?? "That statement wasn't found."}
        </p>
        <Button size="sm" href={`${s.base}/earnings/statements`}>
          Statements
        </Button>
      </div>
    );

  const download = async () => {
    setSaving(true);
    try {
      const r = await call(ledgerApi.getStatementCsv, { params: { statementId: st.id } });
      saveText(r.filename, r.csv);
    } catch (e) {
      toast.show({ message: e instanceof ApiError ? e.message : "Something went wrong. Try again." });
    } finally {
      setSaving(false);
    }
  };

  const sections = statementSections(st);
  const left = sections.filter((x) => x.column === "left");
  const right = sections.filter((x) => x.column === "right");
  const total = { title: st.paidOn ? "Paid out" : "Total", amount: st.lines.reduce((a, l) => a + l.amountMicros, 0) };
  const column = (secs: typeof sections, withTotal: boolean) => (
    <div className="cc-stmt__col">
      {secs.map((sec, i) => (
        <Section key={sec.key} title={sec.title || undefined} sub={sec.sub}>
          <MoneyRows rows={sec.rows} total={withTotal && i === secs.length - 1 ? total : undefined} />
        </Section>
      ))}
    </div>
  );

  return (
    <div className="cc-stmt">
      <ControlTitle
        title={statementTitle(st)}
        description={statementSubtitle(st)}
        end={
          s.can("moveMoney") ? (
            <Button size="sm" onClick={download} disabled={saving}>
              Download CSV
            </Button>
          ) : undefined
        }
      />
      <div className="cc-stmt__split">
        {column(left, right.length === 0)}
        {right.length > 0 && column(right, true)}
      </div>
    </div>
  );
}
