// biz-funding 03.1 Balance (/:businessId/balance): available, held and spent with the bar, the
// runway in days, money on its way, every movement (All / Money in and out / Airings), and the
// settings column (auto top-up, warnings, funding, statements). 04.1 Take money out
// (?modal=withdraw; owners only). On the phone (06.1, 06.2): ?sheet=add&amount=250&source=<id>
// opens straight on Add money, as the low-balance notice does; after adding, what's on its way.
// Roles: everyone sees it; owners and managers add money; only the owner takes money out or changes
// funding and auto top-up; viewers change nothing.

import { useState } from "react";
import { useSearchParams } from "react-router";
import { ledgerApi, spotsApi, type Movement } from "@opencast/contracts";
import { BalanceBar, Button, ControlTitle, KeyValueList, Movements, Runway, Segmented, StatRow, Toggle, useToast, type Movement as MovementRow } from "@opencast/ui";
import { shortAddress, useClear } from "../../auth/clear";
import { useApi, useApiMutation } from "../../api/hooks";
import { useBusiness } from "../../business/BusinessContext";
import { AddMoney } from "../../components/money/AddMoney";
import { ClearTag } from "../../components/money/ClearTag";
import { PendingDeposits } from "../../components/money/PendingDeposits";
import { SecTop } from "../../components/money/SecTop";
import { Withdraw } from "../../components/money/Withdraw";
import {
  aboutDays,
  autoTopUpText,
  heldCaption,
  monthName,
  movementDay,
  movementDirection,
  sourceParts,
  spentCaption,
  spotsLine,
  usualAmount,
  warnText
} from "../../components/money/words";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { MARKET_TZ, useNow } from "../../lib/clock";
import { Quiet } from "../common";
import "./Balance.css";

type Filter = "all" | "money" | "airings";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "money", label: "Money in and out" },
  { value: "airings", label: "Airings" }
];
const PAGE = 50;

export default function Balance() {
  const b = useBusiness();
  const phone = useIsPhone();
  useShellOptions({ title: "Balance" });
  const t = useNow(60_000);
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const raw = params.get("show");
  const filter: Filter = raw === "money" || raw === "airings" ? raw : "all";
  const [limit, setLimit] = useState(PAGE);

  const balance = useApi(ledgerApi.getBalance, { params: { businessId: b.id } }, { refetchInterval: 30_000 });
  const movements = useApi(ledgerApi.listMovements, { params: { businessId: b.id }, query: { filter, limit } });
  const added = useApi(ledgerApi.listMovements, { params: { businessId: b.id }, query: { filter: "money", limit: 20 } }, { enabled: b.can("spend") });
  const profile = useApi(spotsApi.getBusiness, { params: { businessId: b.id } }, { staleTime: 60_000 });
  const spots = useApi(spotsApi.listSpots, { params: { businessId: b.id } }, { retry: false });
  const statements = useApi(ledgerApi.listStatements, { params: { businessId: b.id } }, { retry: false, staleTime: 300_000 });
  const update = useApiMutation(spotsApi.updateBusiness, { invalidates: [spotsApi.getBusiness] });
  const clear = useClear();

  const overlay = params.get("modal") ?? params.get("sheet");
  const close = () =>
    setParams(
      (q) => {
        for (const k of ["modal", "sheet", "amount", "source"]) q.delete(k);
        return q;
      },
      { replace: true }
    );
  const open = (name: "add" | "withdraw") =>
    setParams((q) => {
      q.delete(phone ? "modal" : "sheet");
      q.set(phone ? "sheet" : "modal", name);
      return q;
    });
  const setFilter = (f: Filter) =>
    setParams(
      (q) => {
        if (f === "all") q.delete("show");
        else q.set("show", f);
        return q;
      },
      { replace: true }
    );

  if (balance.isLoading) return <Quiet />;
  const bal = balance.data;
  if (!bal) {
    return (
      <div className="bz-bal">
        <ControlTitle title="Balance" />
        <p className="bz-bal__err" role="alert">
          {balance.error?.message ?? "Something went wrong. Try again."}
        </p>
      </div>
    );
  }

  const business = profile.data;
  const auto = business?.autoTopUp;
  const month = monthName(t, MARKET_TZ);
  const pending = bal.pendingDeposits.length > 0;
  const amountParam = Number(params.get("amount"));
  const startAmount = amountParam > 0 ? Math.round(amountParam * 100) * 10_000 : usualAmount(added.data);
  const latest = [...(statements.data ?? [])].sort((a, c) => (a.periodEnd < c.periodEnd ? 1 : -1))[0];

  const rows: MovementRow[] = (movements.data ?? []).map((m: Movement) => {
    const d = movementDay(m.at, t, MARKET_TZ);
    return { id: m.id, day: d.day, at: d.showTime ? m.at : undefined, title: m.label, detail: m.detail ?? undefined, amount: m.amountMicros, kind: movementDirection(m) };
  });

  const toggleAuto = (on: boolean) =>
    update.mutate(
      { params: { businessId: b.id }, body: { autoTopUp: { on, amountMicros: auto?.amountMicros ?? usualAmount(added.data), belowDays: auto?.belowDays ?? 3 } } },
      { onError: (e) => toast.show({ message: e.message }) }
    );

  const funding = bal.fundingSources.find((f) => f.isDefault) ?? bal.fundingSources[0];
  const fundingDetail = funding ? (
    funding.kind === "clear_bank" || funding.kind === "clear_account" ? (
      <>
        <ClearTag />
        {sourceParts(funding).account ? `, ${sourceParts(funding).account}` : ""}
      </>
    ) : (
      funding.label
    )
  ) : clear.account ? (
    <>
      <ClearTag />, {shortAddress(clear.account.address)}
    </>
  ) : (
    "Nothing linked yet"
  );

  const settings = (
    <section className="bz-bal__settings" aria-labelledby="bz-bal-settings">
      <SecTop title="Settings" id="bz-bal-settings" />
      <KeyValueList
        variant="rows"
        items={[
          {
            title: <span id="bz-bal-auto">Top up automatically</span>,
            detail: autoTopUpText(auto),
            actions: b.can("manage") && auto ? <Toggle checked={auto.on} onChange={toggleAuto} disabled={update.isPending} aria-labelledby="bz-bal-auto" /> : undefined
          },
          {
            title: "Warn me",
            detail: business ? warnText(business.warnDays) : "",
            actions: b.can("spend") ? (
              <Button size="sm" href={`${b.base}/settings/notifications`}>
                Change
              </Button>
            ) : undefined
          },
          {
            title: "Funding from",
            detail: fundingDetail,
            actions: b.can("manage") ? (
              <Button size="sm" href={`${b.base}/settings/money`}>
                Change
              </Button>
            ) : undefined
          },
          {
            title: "Statements",
            detail: "Monthly, with every airing",
            actions: latest ? (
              <Button size="sm" href={`${b.base}/balance/statements/${latest.id}`}>
                View
              </Button>
            ) : undefined
          }
        ]}
      />
    </section>
  );

  const everyMovement = (
    <section className="bz-bal__moves" aria-labelledby="bz-bal-moves">
      <SecTop title="Every movement" id="bz-bal-moves" end={<Segmented label="Show" options={FILTERS} value={filter} onChange={setFilter} size={phone ? "sm" : "md"} />} />
      {movements.isLoading ? (
        <Quiet />
      ) : movements.error ? (
        <p className="bz-bal__err" role="alert">
          {movements.error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="bz-bal__empty">{filter === "all" ? "Nothing yet. Money you add, and every airing, shows here." : "Nothing of that kind yet."}</p>
      ) : (
        <>
          <Movements items={rows} timeZone={MARKET_TZ} />
          {rows.length >= limit && (
            <Button size="sm" className="bz-bal__more" onClick={() => setLimit((n) => n + PAGE)}>
              Show earlier
            </Button>
          )}
        </>
      )}
    </section>
  );

  const runway =
    bal.runwayDays !== null && bal.pacePerDayMicros > 0 ? (
      <Runway className="bz-bal__runway" perDay={bal.pacePerDayMicros} days={bal.runwayDays} autoTopUp={!!auto?.on} />
    ) : (
      <p className="oc-runway bz-bal__runway">No airings yet this month, so there's no pace to go by.</p>
    );

  const overlays = (
    <>
      {overlay === "withdraw" && <Withdraw balance={bal} onClose={close} />}
      {overlay === "add" && b.can("spend") && !phone && (
        <AddMoney balance={bal} amount={startAmount} sourceId={params.get("source")} autoTopUpOff={!auto?.on} layout="modal" onClose={close} />
      )}
    </>
  );

  if (phone) {
    const adding = overlay === "add" && b.can("spend");
    const availableCaption = pending && !adding ? "Available now" : bal.runwayDays !== null ? `Available, ${aboutDays(bal.runwayDays)}` : "Available";
    return (
      <div className="bz-bal bz-bal--phone">
        <StatRow
          size="sm"
          stats={[
            { amount: bal.availableMicros, caption: availableCaption },
            { amount: bal.heldMicros, caption: "Held" }
          ]}
        />
        {adding ? (
          <AddMoney balance={bal} amount={startAmount} sourceId={params.get("source")} autoTopUpOff={!auto?.on} layout="inline" onClose={close} />
        ) : (
          <>
            <PendingDeposits balance={bal} />
            {b.can("spend") && (
              <div className="bz-bal__phone-acts">
                <Button variant="primary" onClick={() => open("add")}>
                  Add money
                </Button>
                <Button onClick={() => open("withdraw")}>Take money out</Button>
              </div>
            )}
            {everyMovement}
            {settings}
          </>
        )}
        {overlays}
      </div>
    );
  }

  return (
    <div className="bz-bal">
      <ControlTitle
        title="Balance"
        description={spotsLine(b.business.name, spots.data)}
        end={
          b.can("spend") ? (
            <>
              <Button size="sm" onClick={() => open("withdraw")}>
                Take money out
              </Button>
              <Button variant="primary" size="sm" onClick={() => open("add")}>
                Add money
              </Button>
            </>
          ) : undefined
        }
      />
      <StatRow
        stats={[
          { amount: bal.availableMicros, dot: "ink", caption: "Available. Yours to spend or take out" },
          { amount: bal.heldMicros, dot: "standby", caption: heldCaption(bal.heldAirings) },
          { amount: bal.spentThisMonthMicros, dot: "line", caption: spentCaption(month, bal.spentThisMonthAirings) }
        ]}
      />
      <BalanceBar
        className="bz-bal__bar"
        segments={[
          { tone: "available", label: "Available", amount: bal.availableMicros },
          { tone: "held", label: "Held", amount: bal.heldMicros },
          { tone: "spent", label: `Spent in ${month}`, amount: bal.spentThisMonthMicros }
        ]}
      />
      {runway}
      <PendingDeposits balance={bal} />
      <div className="bz-bal__split">
        {everyMovement}
        {settings}
      </div>
      {overlays}
    </div>
  );
}
