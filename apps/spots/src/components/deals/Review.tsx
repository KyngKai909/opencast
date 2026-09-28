// production-orders 05.1 review the delivery (web): the spot with a scrub bar, notes pinned to
// moments (addOrderNote; amber marks on the bar), approve (the hold goes to the maker and it becomes
// a spot) or ask for changes with the included round (reviewDelivery). A note the maker marked as
// its own mistake doesn't use a round; with no rounds left, Opencast reviews it.
// 06.1 approve on the phone: the spot, where it came from, when it approves itself, Approve.
// Notes are desk work, so the phone has none.

import { useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { spotsApi } from "@opencast/contracts";
import { Button, Field, Icon, ScrubBar, clock, duration, money, useToast } from "@opencast/ui";
import type { OrderX } from "../../api/ext/deals";
import { useBusiness, useMe } from "../../business/BusinessContext";
import { MARKET_TZ } from "../../lib/clock";
import { errorText, useWrite } from "./data";
import { DeliveryPicture, cardOf, usePlayhead } from "./DeliveryPicture";
import { callSign, changesButton, dayText, deliveredLine, noteWhen, roundsIncluded } from "./format";
import { ErrorLine } from "./parts";
import "./Review.css";

type Note = OrderX["notes"][number];

/** This round's notes: the ones on the delivery under review. */
export function currentNotes(o: Pick<OrderX, "notes" | "roundsUsed">): Note[] {
  return o.notes.filter((n) => n.round === o.roundsUsed + 1);
}

function lastDelivery(o: OrderX) {
  return o.deliveries[o.deliveries.length - 1] ?? null;
}

function lengthOf(o: OrderX) {
  return lastDelivery(o)?.durationMs ?? o.lengthSec * 1000;
}

/** Approve, and say where it went. */
function useApprove(o: OrderX) {
  const toast = useToast();
  const review = useWrite(spotsApi.reviewDelivery);
  const approve = (then?: () => void) =>
    review.mutate(
      { params: { orderId: o.id }, body: { decision: "approve" } },
      {
        onSuccess: () => {
          toast.show({ message: `${o.title} is in your Spots now.` });
          then?.();
        }
      }
    );
  return { approve, review };
}

export function ReviewDelivery({ order: o, nowMs, readOnly }: { order: OrderX; nowMs: number; readOnly?: boolean }) {
  const b = useBusiness();
  const me = useMe();
  const toast = useToast();
  const fieldId = useId();
  const delivery = lastDelivery(o);
  const length = lengthOf(o);
  const head = usePlayhead(length, !!delivery && cardOf(delivery.url) !== null);
  const notes = readOnly ? o.notes : currentNotes(o);
  const pins = notes.filter((n) => n.timecodeMs !== null).map((n) => ({ at: n.timecodeMs!, label: n.body }));
  const addNote = useWrite(spotsApi.addOrderNote);
  const { approve, review } = useApprove(o);
  const [text, setText] = useState("");
  const cs = callSign(o.maker);
  const who = (n: Note) => (n.author && (n.author === me.data?.displayName || n.author === me.data?.email) ? "You" : n.author ?? "You");
  const usesARound = notes.length === 0 || notes.some((n) => !n.makersMistake);
  const changes = changesButton(o, usesARound);
  const checks = delivery?.checksPassed;

  const pin = (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    addNote.mutate({ params: { orderId: o.id }, body: { timecodeMs: Math.round(head.position), body } }, { onSuccess: () => setText("") });
  };

  const ask = () =>
    review.mutate(
      { params: { orderId: o.id }, body: { decision: changes.decision } },
      { onSuccess: () => toast.show({ message: changes.decision === "dispute" ? "Sent to Opencast for review." : `Sent to ${cs}.` }) }
    );

  return (
    <div className="bz-review">
      <div>
        {delivery && <DeliveryPicture url={delivery.url} fallback={{ title: o.title, line: o.business.name, colour: "#6B4A2B" }} head={head} label={`${o.title}, version ${delivery.version}`} />}
        <ScrubBar position={head.position} length={length} playing={head.playing} onPlayPause={head.toggle} onSeek={head.seek} pins={pins} knob={false} step={1000} />
        {checks && checks.length > 0 && (
          <p className="bz-review__checks">
            <span className="bz-review__ok" aria-hidden="true">
              <Icon name="check" size={12} />
            </span>
            Passed the spot checks: {checks.join(", ")}.
          </p>
        )}
      </div>
      <div>
        <div className="bz-review__sec">
          <h2>Your notes</h2>
          <span>{roundsIncluded(o.quote?.roundsIncluded ?? 0)}</span>
        </div>
        {notes.length === 0 && !readOnly && <p className="bz-review__quiet">Pause where something's wrong and pin a note to that moment.</p>}
        <ul className="bz-review__notes">
          {notes.map((n) => (
            <li key={n.id} className="bz-review__note">
              {n.timecodeMs !== null ? (
                <button type="button" className="bz-review__tc" onClick={() => head.seek(n.timecodeMs!)} aria-label={`Go to ${duration(n.timecodeMs)}`}>
                  {duration(n.timecodeMs)}
                </button>
              ) : (
                <span />
              )}
              <div>
                {n.body}
                <small>
                  {who(n)}, {noteWhen(n.createdAt, nowMs, (t) => clock(t, { timeZone: MARKET_TZ }))}
                </small>
                {n.makersMistake && <small className="bz-review__mistake">{cs} marked it their mistake. It doesn't use a round.</small>}
              </div>
            </li>
          ))}
        </ul>
        {!readOnly && (
          <>
            <form className="bz-review__add" onSubmit={pin}>
              <Field
                id={fieldId}
                size="sm"
                aria-label={`A note at ${duration(head.position)}`}
                placeholder={`A note at ${duration(head.position)}`}
                value={text}
                maxLength={1000}
                onChange={(e) => setText(e.target.value)}
              />
              <Button size="sm" type="submit" disabled={!text.trim() || addNote.isPending}>
                Pin it
              </Button>
            </form>
            <ErrorLine>{addNote.error ? errorText(addNote.error) : null}</ErrorLine>
            <div className="bz-review__acts">
              <Button block disabled={review.isPending || notes.length === 0} onClick={ask}>
                {changes.label}
              </Button>
              <Button variant="primary" block disabled={review.isPending || !b.can("spend")} onClick={() => approve()}>
                Approve and make it a spot
              </Button>
            </div>
            <ErrorLine>{review.error ? errorText(review.error) : null}</ErrorLine>
            {o.autoApproveAt && o.quote && (
              <p className="bz-review__auto">
                If you don't answer, it's approved automatically on <b>{dayText(o.autoApproveAt)}</b> and the {money(o.quote.priceMicros)} goes to {cs}.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function PhoneReview({ order: o, today }: { order: OrderX; today: string }) {
  const b = useBusiness();
  const navigate = useNavigate();
  const delivery = lastDelivery(o);
  const length = lengthOf(o);
  const head = usePlayhead(length, !!delivery && cardOf(delivery.url) !== null);
  const { approve, review } = useApprove(o);
  return (
    <div className="bz-review-phone">
      {delivery && <DeliveryPicture phone url={delivery.url} fallback={{ title: o.title, line: o.business.name, colour: "#6B4A2B" }} head={head} label={`${o.title}, version ${delivery.version}`} />}
      <ScrubBar position={head.position} length={length} playing={head.playing} onPlayPause={head.toggle} onSeek={head.seek} knob={false} step={1000} />
      <p className="bz-review-phone__from">{deliveredLine(o, today)}</p>
      {o.autoApproveAt && <p className="bz-review__auto bz-review-phone__auto">Approves itself on {dayText(o.autoApproveAt)} if you don't answer.</p>}
      <Button variant="primary" block className="bz-review-phone__approve" disabled={review.isPending || !b.can("spend")} onClick={() => approve(() => navigate(`${b.base}/orders`))}>
        Approve and make it a spot
      </Button>
      <Button block className="bz-review-phone__later" onClick={() => navigate(`${b.base}/orders`)}>
        Add notes on a computer
      </Button>
      <ErrorLine>{review.error ? errorText(review.error) : null}</ErrorLine>
    </div>
  );
}
