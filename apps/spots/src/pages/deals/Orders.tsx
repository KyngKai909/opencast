// production-orders 01.1 Made for you: your orders (/orders). Each order, its maker, its price and
// its state, coloured by whose turn it is; Open, Review (a delivery) or Spot (what it became).
// Owners and managers; a viewer gets the rail's reason.

import { Button, Table, money, type Column } from "@opencast/ui";
import type { OrderX } from "../../api/ext/deals";
import { useBusiness } from "../../business/BusinessContext";
import { errorText, useOrders } from "../../components/deals/data";
import { orderAction, orderLine, orderTag, stationLabel } from "../../components/deals/format";
import { ErrorLine, NoAccess, PageHead, QuietRows, StateTag } from "../../components/deals/parts";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import "./Orders.css";

export default function Orders() {
  const b = useBusiness();
  useShellOptions({ title: "Made for you" });
  if (!b.can("advertise")) return <NoAccess base={b.base} />;
  return <OrdersPage />;
}

function OrdersPage() {
  const b = useBusiness();
  const phone = useIsPhone();
  const orders = useOrders(b, { refetchInterval: 30_000 });
  const rows = orders.data ?? [];
  const short = b.business.name.split(" ").slice(0, 2).join(" ");

  const go = (o: OrderX) => {
    const action = orderAction(o);
    return action === "Spot" ? `${b.base}/spots/${o.spotId}` : `${b.base}/orders/${o.id}`;
  };

  const columns: Column<OrderX>[] = [
    {
      key: "order",
      header: "Order",
      cell: (o) => (
        <span className="bz-or__what">
          <b>{o.title}</b>
          <small>{orderLine(o)}</small>
        </span>
      )
    },
    { key: "maker", header: "Maker", width: "170px", cell: (o) => stationLabel(o.maker) },
    { key: "price", header: "Price", width: "110px", kind: "amount", cell: (o) => (o.quote ? money(o.quote.priceMicros) : <span className="bz-or__none">Not quoted</span>) },
    { key: "state", header: "State", width: "230px", cell: (o) => <StateTag {...orderTag(o)} fill /> },
    {
      key: "go",
      width: "100px",
      cell: (o) => (
        <Button size="sm" block href={go(o)} aria-label={`${orderAction(o)}: ${o.title}`}>
          {orderAction(o)}
        </Button>
      )
    }
  ];

  return (
    <div className="bz-or">
      {!phone && (
        <PageHead
          title="Made for you"
          description={`Spots made for ${short} by stations and Opencast's studio.`}
          end={
            <Button variant="primary" size="sm" icon="plus" href={`${b.base}/orders/new`}>
              Order a spot
            </Button>
          }
        />
      )}
      {orders.isLoading ? (
        <QuietRows rows={4} />
      ) : orders.error ? (
        <ErrorLine>{errorText(orders.error)}</ErrorLine>
      ) : rows.length === 0 ? (
        <p className="bz-or__empty">No orders yet. A station or Opencast's studio can make your first spot.</p>
      ) : phone ? (
        <ul className="bz-or-phone">
          {rows.map((o) => (
            <li key={o.id}>
              <a className="bz-or-phone__row" href={go(o)}>
                <span className="bz-or__what">
                  <b>{o.title}</b>
                  <small>
                    {stationLabel(o.maker)}
                    {o.quote ? `, ${money(o.quote.priceMicros)}` : ""}
                  </small>
                </span>
                <StateTag {...orderTag(o)} />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <Table label="Your orders" columns={columns} rows={rows} rowKey={(o) => o.id} rowPadding={12} gap={14} />
      )}
    </div>
  );
}
