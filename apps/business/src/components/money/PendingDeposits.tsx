// Money on its way (biz-funding 06.2): "+$250.00 on the way", how and when it arrives, a Pending
// tag, and whether the spots keep running until then. Shown honestly: pending money isn't available.

import type { Balance } from "@opencast/contracts";
import { Tag, money } from "@opencast/ui";
import { MARKET_TZ, useNow } from "../../lib/clock";
import { arrivalDay, methodText, untilArrival } from "./words";
import "./PendingDeposits.css";

export function PendingDeposits({ balance }: { balance: Balance }) {
  const t = useNow(60_000);
  const list = balance.pendingDeposits;
  if (!list.length) return null;
  const last = [...list].sort((a, b) => Date.parse(b.expectedAt ?? "") - Date.parse(a.expectedAt ?? ""))[0]!;
  const until = untilArrival(balance, last.expectedAt, t, MARKET_TZ);
  return (
    <section className="bz-pending" aria-label="On the way">
      {list.map((d) => (
        <div key={d.id} className="bz-pending__row">
          <div>
            <b>{money(d.amountMicros, { sign: true })} on the way</b>
            <small>
              {methodText(d.method)}
              {d.expectedAt ? `. Arrives ${arrivalDay(d.expectedAt, t, MARKET_TZ)}` : ""}
            </small>
          </div>
          <Tag variant="standby">Pending</Tag>
        </div>
      ))}
      <p className="bz-pending__p">{until.sentence}</p>
    </section>
  );
}
