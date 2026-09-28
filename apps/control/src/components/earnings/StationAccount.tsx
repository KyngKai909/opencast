// Settings, Station account (/settings/account): where the station's money settles and where it's
// paid, and moving money to the bank. Rendered by the Station area's Settings page. No frame draws
// it; it's built from the contract (getPayoutAccount, moveToBank, and the account lines of
// getStationEarnings). Owners act; operators see (station-settings 03.1: "Earnings, payouts and
// the station account: Owner, Operator see only"). The payout schedule and bank can't be changed
// here: the contract has no endpoint for it.

import { useState } from "react";
import { ledgerApi } from "@opencast/contracts";
import { Button, KeyValueList, Notice, type KeyValueRow } from "@opencast/ui";
import { StationEarningsX } from "../../api/ext/earnings";
import { useApi } from "../../api/hooks";
import { useStation } from "../../station/StationContext";
import { payoutDetail } from "./lines";
import { MoveToBank } from "./MoveToBank";
import { weekdayOf } from "./periods";
import "./StationAccount.css";

export default function StationAccount() {
  const s = useStation();
  const owner = s.can("moveMoney");
  const name = s.station.callSign ?? s.station.name;
  const [moving, setMoving] = useState(false);
  const earnings = useApi(ledgerApi.getStationEarnings, { params: { stationId: s.id }, query: { period: "month" } }, { schema: StationEarningsX, enabled: s.can("seeMoney") });
  const account = useApi(ledgerApi.getPayoutAccount, { params: { stationId: s.id } }, { enabled: owner, retry: false });
  const e = earnings.data;

  if (earnings.isLoading || (owner && account.isLoading)) return <div className="cc-acct" aria-busy="true" />;
  if (!e)
    return (
      <div className="cc-acct">
        <p className="cc-acct__note" role="alert">
          {earnings.error?.message ?? "Something went wrong. Try again."}
        </p>
      </div>
    );

  const setUp = account.data?.status === "needs_onboarding" ? account.data : null;
  const rows: KeyValueRow[] = [
    {
      title: `${name}'s Clear account`,
      detail: "Available now. Earnings settle here after each airing",
      amount: e.account.availableMicros
    },
    {
      title: "Payouts",
      detail: e.nextPayout
        ? `${payoutDetail(e.nextPayout)}. Next on ${weekdayOf(e.nextPayout.on)}`
        : setUp
          ? "Not set up yet. Earnings stay in Clear until they're moved"
          : "None scheduled. Earnings stay in Clear until they're moved"
    },
    { title: "Paid out this month", amount: e.account.paidOutThisMonthMicros }
  ];

  return (
    <div className="cc-acct">
      {owner && setUp && (
        <Notice
          className="cc-acct__notice"
          title={`Finish setting up where ${name} is paid`}
          detail={`Until then, ${name}'s earnings stay in its Clear account.`}
          action={
            setUp.url ? (
              <Button size="sm" href={setUp.url} target="_blank" rel="noreferrer">
                Finish setting up
              </Button>
            ) : undefined
          }
        />
      )}
      <div className="cc-acct__rows">
        <KeyValueList variant="rows" items={rows} />
      </div>
      {owner ? (
        !setUp && (
          <div className="cc-acct__acts">
            <Button variant="primary" size="sm" onClick={() => setMoving(true)} disabled={e.account.availableMicros <= 0}>
              Move to bank
            </Button>
            <Button size="sm" href={`${s.base}/earnings/statements`}>
              Statements
            </Button>
          </div>
        )
      ) : (
        <p className="cc-acct__note">Only owners move money or change where {name} is paid.</p>
      )}
      {owner && !setUp && (
        <MoveToBank open={moving} onClose={() => setMoving(false)} stationId={s.id} name={name} availableMicros={e.account.availableMicros} destination={e.nextPayout?.destination ?? null} />
      )}
    </div>
  );
}
