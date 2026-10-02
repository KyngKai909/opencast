// production-orders 04.1 accept the quote: paying into a hold. The price moves from available to
// held (acceptQuote; the mock holds it through move(..., { hold: true })), and the promise says when
// it goes to the maker and when it comes back. A modal on the web, a sheet on the phone.

import { spotsApi, type ProductionOrder } from "@opencast/contracts";
import { Button, KeyValueList, Modal, PromiseList, Sheet, money, useToast } from "@opencast/ui";
import { useBusiness } from "../../business/BusinessContext";
import { errorText, useBalance, useWrite } from "./data";
import { callSign, dayText } from "./format";
import { ErrorLine } from "./parts";
import "./AcceptQuote.css";

export function AcceptQuote({ order, open, phone, onClose }: { order: ProductionOrder; open: boolean; phone: boolean; onClose: () => void }) {
  const b = useBusiness();
  const toast = useToast();
  const balance = useBalance(b);
  const accept = useWrite(spotsApi.acceptQuote);
  const q = order.quote;
  if (!q) return null;
  const cs = callSign(order.maker);
  const price = money(q.priceMicros);
  const available = balance.data?.availableMicros ?? null;
  const short = available !== null && available < q.priceMicros;

  const body = (
    <div className="bz-accept">
      <KeyValueList
        items={[
          { label: "Held now from your balance", value: price },
          { label: "Available after", value: available === null ? "" : money(available - q.priceMicros) }
        ]}
      />
      <PromiseList
        className="bz-accept__promise"
        label="When the money moves"
        lines={[
          { lead: `${cs} starts work`, rest: "knowing it's paid for." },
          { lead: "You approve the finished spot,", rest: `and the ${price} goes to ${cs}.` },
          { lead: "If you don't answer", rest: `within 7 days of delivery, it goes to ${cs} too.` },
          { lead: `If ${cs} can't deliver`, rest: `by ${dayText(q.deliverBy)} and you cancel, it all comes back.` }
        ]}
      />
      {short && (
        <p className="bz-accept__short">
          Your available balance is {money(available!)}. <a href={`${b.base}/balance`}>Add money</a> to accept.
        </p>
      )}
      <ErrorLine>{accept.error ? errorText(accept.error) : null}</ErrorLine>
    </div>
  );
  const footer = (
    <Button
      variant="primary"
      block
      disabled={short || accept.isPending || !b.can("spend")}
      onClick={() =>
        accept.mutate(
          { params: { orderId: order.id } },
          {
            onSuccess: () => {
              toast.show({ message: `${price} held for ${order.title}.` });
              onClose();
            }
          }
        )
      }
    >
      Accept and hold {price}
    </Button>
  );
  const title = `Accept ${cs}'s quote`;
  const subtitle = `${price} for ${order.title}.`;
  return phone ? (
    <Sheet open={open} onClose={onClose} title={title} subtitle={subtitle} footer={footer}>
      {body}
    </Sheet>
  ) : (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle} footer={footer} width={520}>
      {body}
    </Modal>
  );
}
