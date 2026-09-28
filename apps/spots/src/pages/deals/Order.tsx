// One production order (/orders/:orderId), by state: asked (waiting for a quote), passed (ask
// another maker), quoted (04.1: the quote, and accepting it into a hold with ?modal=accept, or
// ?sheet=accept on the phone), in the making (the hold, and cancelling once the delivery date has
// passed), delivered (05.1 review with pinned notes; 06.1 approve on the phone), changes asked for,
// with Opencast for review, approved (it's a spot now), cancelled.
// Owners and managers; accepting and approving are the spend right.

import { useParams, useSearchParams } from "react-router";
import { spotsApi } from "@opencast/contracts";
import { Button, KeyValueList, StepRail, money, useToast } from "@opencast/ui";
import type { OrderX } from "../../api/ext/deals";
import { ApiError, call } from "../../api/client";
import { useBusiness } from "../../business/BusinessContext";
import { AcceptQuote } from "../../components/deals/AcceptQuote";
import { errorText, useOrder, useRefresh, useWrite } from "../../components/deals/data";
import { callSign, dayText, marketDate, orderSteps, orderSubtitle, orderTag, roundsShort, stationLabel } from "../../components/deals/format";
import { MockStation, type MockAction } from "../../components/deals/MockStation";
import { ErrorLine, NoAccess, PageHead, StateTag } from "../../components/deals/parts";
import { PhoneReview, ReviewDelivery } from "../../components/deals/Review";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { useNow } from "../../lib/clock";
import { Quiet } from "../common";
import "./Order.css";

export default function Order() {
  const b = useBusiness();
  if (!b.can("advertise")) return <NoAccess base={b.base} />;
  return <OrderPage />;
}

function OrderPage() {
  const b = useBusiness();
  const { orderId } = useParams();
  const phone = useIsPhone();
  const nowAt = useNow(30_000);
  const today = marketDate(nowAt);
  const [params, setParams] = useSearchParams();
  const order = useOrder(b, orderId);
  const o = order.data;
  useShellOptions({ title: o?.title ?? "Made for you" });

  if (order.isLoading) return <Quiet />;
  if (!o) {
    const missing = order.error instanceof ApiError && order.error.status === 404;
    return (
      <div className="bz-order">
        <PageHead trail="Made for you" title={missing ? "That order wasn't found." : "Made for you"} />
        {!missing && <ErrorLine>{errorText(order.error)}</ErrorLine>}
        <Button href={`${b.base}/orders`}>Made for you</Button>
      </div>
    );
  }

  const accepting = (params.get("modal") ?? params.get("sheet")) === "accept" && o.state === "quoted";
  const openAccept = () => setParams((p) => (p.set(phone ? "sheet" : "modal", "accept"), p));
  const closeAccept = () => setParams((p) => (p.delete("modal"), p.delete("sheet"), p), { replace: true });

  if (phone && o.state === "delivered") {
    return (
      <>
        <PhoneReview order={o} today={today} />
        <OrderMock order={o} />
      </>
    );
  }

  return (
    <div className="bz-order">
      {!phone && <PageHead trail={`Made for you / ${o.title}`} title={o.title} description={orderSubtitle(o) ?? undefined} />}
      {phone && orderSubtitle(o) && <p className="bz-order__sub">{orderSubtitle(o)}</p>}
      {o.state !== "cancelled" && <StepRail variant="row" label={`${o.title}, step by step`} steps={orderSteps(o.state)} className="bz-order__steps" />}
      <OrderBody order={o} today={today} nowMs={nowAt.getTime()} onAccept={openAccept} />
      <OrderMock order={o} />
      {o.quote && <AcceptQuote order={o} open={accepting} phone={phone} onClose={closeAccept} />}
    </div>
  );
}

function OrderBody({ order: o, today, nowMs, onAccept }: { order: OrderX; today: string; nowMs: number; onAccept: () => void }) {
  const b = useBusiness();
  const toast = useToast();
  const cancel = useWrite(spotsApi.cancelOrder);
  const cs = callSign(o.maker);
  const price = o.quote ? money(o.quote.priceMicros) : null;
  const doCancel = () => cancel.mutate({ params: { orderId: o.id } }, { onSuccess: (out) => toast.show({ message: (out as OrderX).refundedMicros ? `Cancelled. ${money((out as OrderX).refundedMicros!)} is back.` : "Cancelled." }) });
  const cancelError = <ErrorLine>{cancel.error ? errorText(cancel.error) : null}</ErrorLine>;

  switch (o.state) {
    case "asked":
      return (
        <div className="bz-order__narrow">
          <p className="bz-order__line">
            Asked {dayText(o.createdAt)}. {cs} quotes here before anything is paid.
          </p>
          <Brief order={o} />
          <Button className="bz-order__act" disabled={cancel.isPending} onClick={doCancel}>
            Cancel the order
          </Button>
          {cancelError}
        </div>
      );
    case "passed":
      return (
        <div className="bz-order__narrow">
          <p className="bz-order__line">{cs} passed on this one. The other makers can quote the same brief.</p>
          <Button variant="primary" className="bz-order__act" href={`${b.base}/orders/new?from=${o.id}`}>
            Ask another maker
          </Button>
          <Brief order={o} />
        </div>
      );
    case "quoted":
    case "accepted":
    case "changes_requested": {
      const q = o.quote!;
      const late = o.state !== "quoted" && today > q.deliverBy;
      const tag = o.state === "quoted" ? { text: `Quote from ${stationLabel(o.maker)}`, tone: "you" as const } : orderTag(o);
      return (
        <div className="bz-order__narrow">
          <div className={o.state === "quoted" ? "bz-quote" : "bz-quote bz-quote--held"}>
            <StateTag {...tag} />
            <h2>
              {price}, delivered by {dayText(q.deliverBy)}
            </h2>
            <KeyValueList
              items={[
                { label: "Changes", value: roundsShort(q.roundsIncluded) },
                ...(q.voicedBy ? [{ label: "Voiced by", value: q.voicedBy }] : []),
                ...(o.state !== "quoted" ? [{ label: "Held from your balance", value: price! }] : [])
              ]}
            />
          </div>
          {o.state === "quoted" ? (
            <div className="bz-order__acts">
              <Button variant="primary" disabled={!b.can("spend")} onClick={onAccept}>
                Accept {cs}'s quote
              </Button>
              <Button disabled={cancel.isPending} onClick={doCancel}>
                Cancel the order
              </Button>
            </div>
          ) : (
            <>
              <p className="bz-order__line">
                {o.state === "changes_requested" ? `${cs} is making the changes, and delivers again here.` : `${cs} is making it. It's yours to review here when it's delivered.`} The {price} goes to {cs} when you approve.
              </p>
              {late && (
                <Button className="bz-order__act" disabled={cancel.isPending} onClick={doCancel}>
                  Cancel and get {price} back
                </Button>
              )}
            </>
          )}
          {cancelError}
          {o.state === "changes_requested" && o.notes.length > 0 && <ReviewDelivery order={o} nowMs={nowMs} readOnly />}
        </div>
      );
    }
    case "delivered":
      return <ReviewDelivery order={o} nowMs={nowMs} />;
    case "disputed":
      return (
        <>
          <p className="bz-order__line">With Opencast for review. The {price} stays held until then; it's never refunded or released automatically.</p>
          <ReviewDelivery order={o} nowMs={nowMs} readOnly />
        </>
      );
    case "approved":
      return (
        <>
          <div className="bz-order__acts bz-order__acts--top">
            <StateTag {...orderTag(o)} />
            {o.spotId && (
              <Button variant="primary" size="sm" href={`${b.base}/spots/${o.spotId}/setup/rate`}>
                Set a rate and budget
              </Button>
            )}
          </div>
          <ReviewDelivery order={o} nowMs={nowMs} readOnly />
        </>
      );
    case "cancelled":
      return (
        <div className="bz-order__narrow">
          <p className="bz-order__line">Cancelled.{o.refundedMicros ? ` ${money(o.refundedMicros)} came back to your balance.` : ""}</p>
          <Brief order={o} />
        </div>
      );
  }
}

/** The brief as sent (the maker's frame 03.1 shows the same lines). */
function Brief({ order: o }: { order: OrderX }) {
  return (
    <section className="bz-order__brief" aria-label="The brief">
      <KeyValueList
        items={[
          { label: "Length", value: `:${o.lengthSec}` },
          { label: "About", value: o.about },
          ...(o.mustSay ? [{ label: "Must say", value: o.mustSay }] : []),
          ...(o.briefFiles.length ? [{ label: "Files", value: o.briefFiles.map((f) => f.filename ?? "file").join(", ") }] : []),
          { label: "Needed by", value: dayText(o.neededBy) }
        ]}
      />
    </section>
  );
}

/** Mock mode: the maker's and Opencast's side, through their own endpoints. */
function OrderMock({ order: o }: { order: OrderX }) {
  const refresh = useRefresh();
  const cs = callSign(o.maker);
  const id = { params: { orderId: o.id } };
  const actions: MockAction[] = [];
  if (o.state === "asked") {
    actions.push({
      label: `${cs} quotes`,
      run: async () => {
        // The maker's usual quote, from the mock (loaded only here, in mock mode).
        const { mockQuoteFor, getDeals } = await import("../../mocks/fixtures/deals");
        const fx = getDeals().orders.find((x) => x.id === o.id);
        if (!fx) throw new Error("Not in the mock.");
        await call(spotsApi.quoteOrder, { ...id, body: mockQuoteFor(fx) });
        await refresh();
      }
    });
    actions.push({ label: `${cs} passes`, run: () => call(spotsApi.quoteOrder, { ...id, body: { action: "pass" } }).then(refresh) });
  }
  if (o.state === "accepted" || o.state === "changes_requested") actions.push({ label: `${cs} delivers`, run: () => call(spotsApi.deliverOrder, id).then(refresh) });
  if (o.state === "delivered") {
    const open = o.notes.filter((n) => n.round === o.roundsUsed + 1 && !n.makersMistake);
    const last = open[open.length - 1];
    if (last) actions.push({ label: `${cs} marks the last note its mistake`, run: () => call(spotsApi.markOwnMistake, { params: { orderId: o.id, noteId: last.id } }).then(refresh) });
  }
  if (o.state === "disputed") {
    actions.push({ label: "Opencast pays the maker", run: () => call(spotsApi.resolveOrderDispute, { ...id, body: { outcome: "pay_maker" } }).then(refresh) });
    actions.push({ label: "Opencast refunds you", run: () => call(spotsApi.resolveOrderDispute, { ...id, body: { outcome: "refund" } }).then(refresh) });
  }
  return <MockStation who={`Answer as ${o.maker.kind === "studio" ? o.maker.name : "master control"} would:`} actions={actions} />;
}
