// A ruled section of a money page: its heading over a line rule (the reference's .sec-top), then
// its rows. Rules, not boxes.

import { useId, type ReactNode } from "react";
import { KeyValueList, type KeyValueRow } from "@opencast/ui";
import type { MoneyRow } from "./lines";
import "./Section.css";

export function Section({ title, sub, children, className }: { title?: ReactNode; sub?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section className={`cc-sec${className ? ` ${className}` : ""}`} aria-labelledby={title ? id : undefined}>
      {title && (
        <div className="cc-sec__top">
          <h2 className="cc-sec__h" id={id}>
            {title}
          </h2>
          {sub && <span className="cc-sec__sub">{sub}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Money rows (.row2): the title and detail on the left, the amount in mono on the right; undecided lines at $0.00, "Not set yet". */
export function MoneyRows({ rows, total }: { rows: MoneyRow[]; total?: { title: string; amount: number } }) {
  const items: KeyValueRow[] = rows.map((r) => ({ title: r.title, detail: r.detail, amount: r.amount, notSetYet: r.notSetYet, quiet: r.quiet }));
  if (total) items.push({ title: total.title, amount: total.amount, total: true });
  return <KeyValueList variant="rows" items={items} />;
}
