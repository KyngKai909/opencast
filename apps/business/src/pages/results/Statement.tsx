// biz-results 04.1 a monthly statement (/balance/statements/:statementId, rail: Balance).
// The month, tied to the balance: where it started, what was added, what airings spent, what came
// back from short airings (already netted into spent, shown so the rule is seen working), fees, and
// the balance now with available and held under it; then spent by spot and station. It's what goes
// to a bookkeeper: Download PDF, and the CSV with every airing's as-run entry
// (ledger.getStatementCsv). Every role reads it (viewers are here for this page). The line groups,
// in progress or final, and the closing split are E3; without them the lines read as one list.

import { useState } from "react";
import { useParams } from "react-router";
import { ledgerApi, type Statement as StatementData } from "@opencast/contracts";
import { Button, ControlTitle, KeyValueList, money, useToast, type KeyValueRow } from "@opencast/ui";
import { ApiError, apiUrl, call } from "../../api/client";
import type { StatementLine } from "../../api/types";
import { useApi } from "../../api/hooks";
import { useBusiness } from "../../business/BusinessContext";
import { useShellOptions } from "../../layout/shell";
import { dayWords, monthName, rangeWords, saveText, slug } from "../../components/results/format";
import { Section } from "../../components/results/Section";
import { Quiet } from "../common";
import "./Statement.css";

export function statementWords(st: StatementData, businessName: string) {
  const month = monthName(st.periodStart.slice(0, 7));
  const title = `${month} statement`;
  const description = st.inProgress
    ? `${businessName}. ${rangeWords(st.periodStart, st.asOf ?? st.periodEnd)} so far; the final statement is ready ${st.finalOn ? dayWords(st.finalOn) : "at the end of the month"}.`
    : `${businessName}. ${rangeWords(st.periodStart, st.periodEnd)}.`;
  return { title, description };
}

/** The balance lines (E3's group "balance"); without groups, every line. */
export function balanceRows(st: StatementData): KeyValueRow[] {
  const grouped = st.lines.some((l) => l.group);
  const lines = grouped ? st.lines.filter((l) => l.group === "balance") : st.lines;
  const row = (l: StatementLine): KeyValueRow => ({
    title: l.label,
    detail: l.detail ?? undefined,
    amount: l.amountMicros,
    sign: l.kind === "added" || l.kind === "refund",
    quiet: l.includedAbove
  });
  const closing: KeyValueRow = {
    title: st.inProgress ? "Balance now" : "Ended the month",
    detail: st.closingAvailableMicros !== undefined && st.closingHeldMicros !== undefined ? `${money(st.closingAvailableMicros)} available, ${money(st.closingHeldMicros)} held` : undefined,
    amount: st.closingMicros,
    total: true
  };
  return [{ title: "Started the month", amount: st.openingMicros }, ...lines.map(row), closing];
}

export default function Statement() {
  const b = useBusiness();
  const { statementId = "" } = useParams();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  useShellOptions({ title: "Statement" });
  const list = useApi(ledgerApi.listStatements, { params: { businessId: b.id } });
  const st = list.data?.find((x) => x.id === statementId);

  if (list.isLoading) return <Quiet />;
  if (!st)
    return (
      <div className="bz-stmt">
        <ControlTitle title="Statements" />
        <p className="bz-stmt__quiet" role={list.error ? "alert" : undefined}>
          {list.error?.message ?? "That statement wasn't found."}
        </p>
        <Button size="sm" href={b.can("money") ? `${b.base}/balance` : `${b.base}/results`}>
          {b.can("money") ? "Balance" : "Where it aired"}
        </Button>
      </div>
    );

  const words = statementWords(st, b.business.name);
  const spent = st.lines.filter((l) => l.group === "spent");
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

  return (
    <div className="bz-stmt">
      <ControlTitle
        title={words.title}
        description={words.description}
        end={
          <>
            {st.pdfUrl && (
              <Button size="sm" href={apiUrl(st.pdfUrl)} download={`${slug(b.business.name)}-statement-${st.periodStart.slice(0, 7)}.pdf`}>
                Download PDF
              </Button>
            )}
            <Button size="sm" onClick={download} disabled={saving} aria-label="Download CSV">
              CSV
            </Button>
          </>
        }
      />
      <div className="bz-stmt__split">
        <Section title="Balance">
          <KeyValueList variant="rows" items={balanceRows(st)} />
        </Section>
        {spent.length > 0 && (
          <Section title="Spent, by spot and station">
            <KeyValueList variant="rows" items={spent.map((l) => ({ title: l.label, detail: l.detail ?? undefined, amount: l.amountMicros }))} />
            <p className="bz-stmt__foot">Every line lists its airings in the CSV, with the as-run log entry for each.</p>
          </Section>
        )}
      </div>
    </div>
  );
}
