// biz-results 01.1 where it aired, the month (?period=month&month=2026-09); 05.2 the week on the phone (?period=week).
// Four numbers (airings, people tuned in added up, spent, customers with cost each), then station
// by station with cost per customer, airings by time of day and by spot. "This week" and "All time"
// are P14's periods: shown only when the API answers with a period. The phone draws the week's
// summary the Monday push opens: airings, customers and cost each, by station, spent, and the
// balance in days. A business sees only its own results: no benchmarks against anyone else.

import { useSearchParams } from "react-router";
import { ledgerApi, type Results as ResultsData } from "@opencast/contracts";
import { ControlTitle, KeyValueList, Lines, Segmented, SplitBar, StatRow, Table, money, type Column } from "@opencast/ui";
import { useApi } from "../../api/hooks";
import { useBusiness } from "../../business/BusinessContext";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { useNow } from "../../lib/clock";
import { DAYPART_LABEL, daypartSentence, monthName, monthOf, perCustomer, plural, rangeWords, type Period } from "../../components/results/format";
import { selectionFrom, useResults, type Selection } from "../../components/results/useResults";
import { Section } from "../../components/results/Section";
import { Quiet } from "../common";
import "./Results.css";

type StationRow = ResultsData["byStation"][number] & { total?: boolean };

const PERIOD_TITLE = (sel: Selection, now: Date): string =>
  sel.period === "week" ? "This week" : sel.period === "all" ? "All time" : sel.month === monthOf(now) ? monthName(sel.month) : `${monthName(sel.month)} ${sel.month.slice(0, 4)}`;

export default function Results() {
  const b = useBusiness();
  const phone = useIsPhone();
  const now = useNow(60_000);
  const [params, setParams] = useSearchParams();
  const sel = selectionFrom(params, now);
  const res = useResults(b.id, sel);
  // The week's balance in days (phone): not a viewer's to see.
  const balance = useApi(ledgerApi.getBalance, { params: { businessId: b.id } }, { enabled: b.can("money") });
  const title = PERIOD_TITLE(sel, now);
  useShellOptions({ title: phone ? title : "Where it aired" });

  const choose = (p: Period) =>
    setParams((q) => {
      q.set("period", p);
      if (p === "month") q.set("month", sel.month);
      else q.delete("month");
      q.delete("week");
      return q;
    });

  // P14: without a period in the answer, the API only knows months.
  const periods = res.data && res.data.period === undefined ? (["month"] as const) : (["week", "month", "all"] as const);
  const segment = (
    <Segmented<Period>
      label="Period"
      value={sel.period}
      onChange={choose}
      options={periods.map((p) => ({ value: p, label: p === "week" ? "This week" : p === "all" ? "All time" : monthName(sel.month) }))}
      block={phone}
      size={phone ? "sm" : "md"}
    />
  );

  if (res.isLoading) return <Quiet />;
  if (!res.data)
    return (
      <div className="bz-res">
        {!phone && <ControlTitle title="Where it aired" end={segment} />}
        <p className="bz-res__error" role="alert">
          {res.error?.message ?? "Something went wrong. Try again."}
        </p>
      </div>
    );

  const r = res.data;
  const range = r.from && r.to ? { from: r.from, to: r.to } : null;
  const t = r.totals;
  const each = perCustomer(t.spentMicros, t.customers);
  const quiet = t.airings === 0;
  const periodWord = sel.period === "week" ? "this week" : sel.period === "all" ? "yet" : "this month";

  if (phone) {
    const days = balance.data?.runwayDays;
    return (
      <div className="bz-res bz-res--phone">
        {range && <p className="bz-res__range">{rangeWords(range.from, range.to, true)}</p>}
        <StatRow
          size="sm"
          className="bz-res__stats"
          stats={[
            { value: t.airings.toLocaleString("en-US"), caption: "Airings" },
            { value: t.customers.toLocaleString("en-US"), caption: each !== null ? `Customers, ${money(each)} each` : "Customers" }
          ]}
        />
        <KeyValueList
          variant="rows"
          items={[
            ...r.byStation.map((s) => ({ title: `${s.station.callSign} ${s.station.channel}`, detail: plural(s.airings, "airing"), value: plural(s.customers, "customer") })),
            { title: "Spent", amount: t.spentMicros },
            ...(balance.data ? [{ title: "Available", detail: days != null ? `About ${plural(days, "day")} of airings` : undefined, amount: balance.data.availableMicros }] : [])
          ]}
        />
        {quiet && <p className="bz-res__quiet">Nothing has aired {periodWord}.</p>}
        <div className="bz-res__phone-seg">{segment}</div>
      </div>
    );
  }

  const stationColumns: Column<StationRow>[] = [
    { key: "sw", width: "14px", cell: (s) => (s.total ? null : <span className="bz-res__sw" style={{ background: s.station.colour ?? "var(--line)" }} aria-hidden="true" />) },
    { key: "ch", header: "Ch.", width: "52px", cell: (s) => (s.total ? null : <span className="bz-res__ch">{s.station.channel}</span>) },
    {
      key: "cs",
      header: "Station",
      cell: (s) =>
        s.total ? (
          <Lines title="All stations" />
        ) : (
          <Lines
            title={
              <a className="bz-res__link" href={`${b.base}/results/airings?station=${s.station.id}${sel.period === "month" ? `&month=${sel.month}` : ""}`}>
                {s.station.callSign}
              </a>
            }
            detail={s.category ?? undefined}
          />
        )
    },
    { key: "airings", header: "Airings", width: "80px", kind: "amount", cell: (s) => s.airings.toLocaleString("en-US") },
    { key: "avg", header: "Avg tuned in", width: "100px", kind: "amount", cell: (s) => s.averageTunedIn.toLocaleString("en-US") },
    { key: "spent", header: "Spent", width: "100px", kind: "amount", cell: (s) => money(s.spentMicros) },
    { key: "customers", header: "Customers", width: "100px", kind: "amount", cell: (s) => s.customers.toLocaleString("en-US") },
    {
      key: "per",
      header: "Per customer",
      width: "130px",
      kind: "amount",
      cell: (s) => {
        const per = perCustomer(s.spentMicros, s.customers);
        return per !== null ? money(per) : <span aria-label="No customers yet">–</span>;
      }
    }
  ];
  const total: StationRow = {
    total: true,
    station: r.byStation[0]?.station ?? ({} as StationRow["station"]),
    airings: t.airings,
    averageTunedIn: t.airings ? Math.round(t.tunedInAddedUp / t.airings) : 0,
    spentMicros: t.spentMicros,
    customers: t.customers
  };
  const codeFor = (spotId: string) => r.codes?.find((c) => c.spotId === spotId)?.code;
  const sentence = daypartSentence(r.byDaypart);

  return (
    <div className="bz-res">
      <ControlTitle title="Where it aired" description={range ? `All spots, ${rangeWords(range.from, range.to)}.` : undefined} end={segment} />
      {quiet ? (
        <p className="bz-res__quiet">Nothing has aired {periodWord}. Spots air once stations put them in their breaks.</p>
      ) : (
        <>
          <StatRow
            size="md"
            className="bz-res__stats"
            stats={[
              { value: t.airings.toLocaleString("en-US"), caption: `Airings on ${plural(r.byStation.filter((s) => s.airings > 0).length, "station")}` },
              { value: t.tunedInAddedUp.toLocaleString("en-US"), caption: "People tuned in, added up across airings" },
              { amount: t.spentMicros, caption: "Spent" },
              { value: t.customers.toLocaleString("en-US"), caption: each !== null ? `Customers used the code. ${money(each)} each` : "Customers used the code" }
            ]}
          />
          <div className="bz-res__split">
            <Table<StationRow> label="By station" columns={stationColumns} rows={r.byStation} total={total} rowKey={(s) => s.station.id} rowPadding={11} className="bz-res__stations" />
            <div>
              <Section title="Airings by time of day">
                <SplitBar className="bz-res__dp" parts={r.byDaypart.map((p) => ({ label: DAYPART_LABEL[p.daypart] ?? p.daypart, amount: p.airings }))} />
                {sentence && <p className="bz-res__note">{sentence}</p>}
              </Section>
              <Section title="By spot">
                <KeyValueList
                  variant="rows"
                  items={r.bySpot.map((s) => {
                    const code = codeFor(s.spotId);
                    return {
                      title: (
                        <a className="bz-res__link" href={`${b.base}/results/airings?spot=${s.spotId}`}>
                          {s.title}
                        </a>
                      ),
                      detail: plural(s.airings, "airing"),
                      value: code ? (
                        <a className="bz-res__link" href={`${b.base}/results/codes/${code}`}>
                          {plural(s.customers, "customer")}
                        </a>
                      ) : (
                        plural(s.customers, "customer")
                      )
                    };
                  })}
                />
              </Section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
