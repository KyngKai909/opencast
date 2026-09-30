// earnings 02.1 Earnings (/earnings?period=month): every source of money for the period, grouped
// by where it comes from, the undecided shared lines at $0.00, and on the right the Clear account,
// the next payout and the money held for airings still to come. 04.2 on the phone: the compact
// month the weekly notice opens. A studio (market 04.1) gets the same page for its carriage.
// Owners and operators see it; only owners move money (hosts never get here: the layout sends them away).

import { useState } from "react";
import { useSearchParams } from "react-router";
import { ledgerApi } from "@opencast/contracts";
import { Button, ControlTitle, KeyValueList, Segmented, money } from "@opencast/ui";
import { useApi } from "../../../api/hooks";
import { ClearAccount } from "../../components/earnings/ClearAccount";
import { AccountBanner } from "../../components/account/AccountBanner";
import { earningsSections, heldTonightDetail, payoutDetail, phoneRows, plural } from "../../components/earnings/lines";
import { MoveToBank } from "../../components/earnings/MoveToBank";
import { earningsPeriodLabel, earningsRange, earningsShortLabel, earningsTotalLabel, isEarningsPeriod, weekdayOf, type EarningsPeriod } from "../../components/earnings/periods";
import { MoneyRows, Section } from "../../components/earnings/Section";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { STATION_TZ, useNow } from "../../../lib/clock";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../common";
import "./Earnings.css";

const PERIODS: EarningsPeriod[] = ["week", "month", "year"];

export default function Earnings() {
  const s = useStation();
  const phone = useIsPhone();
  const t = useNow(60_000);
  const [params, setParams] = useSearchParams();
  const raw = params.get("period");
  const period: EarningsPeriod = isEarningsPeriod(raw) ? raw : "month";
  const owner = s.can("moveMoney");
  const name = s.label;
  const [moving, setMoving] = useState(false);

  // The phone's page names itself under the top bar, as the notice opens it (04.2).
  useShellOptions({ context: phone ? "" : undefined });

  const earnings = useApi(ledgerApi.getStationEarnings, { params: { stationId: s.id }, query: { period } }, { refetchInterval: 60_000 });
  const account = useApi(ledgerApi.getPayoutAccount, { params: { stationId: s.id } }, { enabled: owner, retry: false });
  const e = earnings.data;
  const setUp = account.data?.status === "needs_onboarding" ? account.data : null;

  if (phone) {
    const label = earningsShortLabel(period, t, STATION_TZ);
    return (
      <div className="cc-earn-phone">
        <div className="cc-earn-phone__head">
          <h1 className="cc-earn-phone__h">Earnings</h1>
          <span className="cc-earn-phone__period">{label}</span>
        </div>
        <AccountBanner className="cc-earn__banner" />
        <div className="cc-earn-phone__main">
          {earnings.isLoading ? (
            <Quiet />
          ) : !e ? (
            <p className="cc-earn__error" role="alert">
              {earnings.error?.message ?? "Something went wrong. Try again."}
            </p>
          ) : (
            <>
              <ClearAccount compact name={name} availableMicros={e.account.availableMicros} line={e.nextPayout ? `Pays out ${weekdayOf(e.nextPayout.on, false)}` : "Stays in Clear until it's moved"} />
              <MoneyRows rows={phoneRows(e, s.studio)} total={{ title: label, amount: e.totalMicros }} />
            </>
          )}
        </div>
      </div>
    );
  }

  const sections = e ? earningsSections(e, period, s.studio) : [];
  const accountLine = e
    ? setUp
      ? "Available now. Payouts start once you finish setting up where you're paid."
      : e.account.paidOutThisMonthMicros > 0
        ? `Available now. ${money(e.account.paidOutThisMonthMicros)} has been paid out this month.`
        : "Available now."
    : null;

  return (
    <div className="cc-earn">
      <ControlTitle
        title="Earnings"
        description={`${earningsRange(period, t, STATION_TZ)}. Owners and operators can see this; only owners move money.`}
        end={
          <Segmented
            label="Period"
            value={period}
            options={PERIODS.map((p) => ({ value: p, label: earningsPeriodLabel(p, t, STATION_TZ) }))}
            onChange={(p) =>
              setParams(
                (q) => {
                  q.set("period", p);
                  return q;
                },
                { replace: true }
              )
            }
          />
        }
      />
      <AccountBanner className="cc-earn__banner" />
      {earnings.isLoading ? (
        <Quiet />
      ) : !e ? (
        <p className="cc-earn__error" role="alert">
          {earnings.error?.message ?? "Something went wrong. Try again."}
        </p>
      ) : (
        <div className="cc-earn__split">
          <div className="cc-earn__lines">
            {sections.map((sec, i) => (
              <Section key={sec.key} title={sec.title}>
                <MoneyRows rows={sec.rows} total={i === sections.length - 1 ? { title: earningsTotalLabel(period, t, STATION_TZ), amount: e.totalMicros } : undefined} />
              </Section>
            ))}
          </div>
          <aside className="cc-earn__side" aria-label="Account and held money">
            <ClearAccount
              name={name}
              availableMicros={e.account.availableMicros}
              line={accountLine}
              actions={
                <>
                  {owner && setUp?.url && (
                    <Button variant="primary" size="sm" href={setUp.url} target="_blank" rel="noreferrer">
                      Finish setting up
                    </Button>
                  )}
                  {owner && !setUp && (
                    <Button variant="primary" size="sm" onClick={() => setMoving(true)} disabled={e.account.availableMicros <= 0}>
                      Move to bank
                    </Button>
                  )}
                  <Button size="sm" href={`${s.base}/earnings/statements`}>
                    Statements
                  </Button>
                </>
              }
            />
            {e.nextPayout && (
              <Section title="Next payout">
                <KeyValueList variant="rows" items={[{ title: weekdayOf(e.nextPayout.on), detail: payoutDetail(e.nextPayout), amount: e.nextPayout.amountMicros }]} />
              </Section>
            )}
            <Section title="Held for airings" sub="Already paid in by advertisers">
              <MoneyRows
                rows={[
                  { key: "tonight", title: "Tonight", detail: e.held.tonightAirings ? heldTonightDetail(e.held) : "No airings held", amount: e.held.tonightMicros },
                  { key: "rest", title: "Rest of the week", detail: e.held.restOfWeekAirings ? plural(e.held.restOfWeekAirings, "airing") : "No airings held", amount: e.held.restOfWeekMicros }
                ]}
              />
              <p className="cc-earn__note">Held money becomes yours when each airing runs. If an advertiser runs out, what's already held still airs and still pays.</p>
            </Section>
          </aside>
        </div>
      )}
      {e && owner && !setUp && (
        <MoveToBank open={moving} onClose={() => setMoving(false)} stationId={s.id} name={name} availableMicros={e.account.availableMicros} destination={e.nextPayout?.destination ?? null} />
      )}
    </div>
  );
}
