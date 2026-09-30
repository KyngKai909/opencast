// One claim. Open (rights 02.1): the claim in the claimant's words, where the item was scheduled,
// what happens next, and the two ways out, both ghost buttons. Answered or closed (04.1): where
// it was pulled (the maker and every carrier), what carriers were told, and the timeline. On the
// phone (06.1): what already happened first, then the claim, with Remove it and Answer pinned.

import { useState } from "react";
import { libraryApi, trustApi } from "@opencast/contracts";
import { Button, clock, KeyValueList, Lines, Modal, Sheet, Tag, Timeline, useToast } from "@opencast/ui";
import { useApi, useApiMutation } from "../../../api/hooks";
import { ApiError } from "../../../api/client";
import type { ClaimX } from "../../api/ext/station";
import { useShellOptions } from "../../layout/shell";
import { STATION_TZ, useNow } from "../../../lib/clock";
import type { StationState } from "../../station/StationContext";
import {
  airingLine,
  CARRIERS_TOLD_AGAIN,
  claimedLine,
  CUT_FOOTNOTE,
  headline,
  IMPORTED_CARRIAGE,
  openTimeline,
  resolvedSummary,
  resolvedTimeline,
  stateWords,
  takedownLine,
  takedownTag
} from "./claimWords";
import { airingWhen, longDate, rangeText } from "./format";
import "./ClaimView.css";
import { stationLabel } from "../../station/slug";

export function ClaimView({ s, claim, phone }: { s: StationState; claim: ClaimX; phone: boolean }) {
  const cs = s.label;
  const now = useNow(60_000);
  const toast = useToast();
  const library = useApi(libraryApi.getLibrary, { params: { stationId: s.id }, query: {} }, { retry: false });
  const remove = useApiMutation(trustApi.removeClaimedItem, { invalidates: [trustApi.listClaims, libraryApi.getLibrary] });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = claim.state === "open";
  const owner = s.can("manage");
  const answerHref = `${s.base}/rights/${claim.id}/answer`;

  const doRemove = () => {
    setError(null);
    remove.mutate(
      { params: { claimId: claim.id } },
      {
        onSuccess: () => {
          setConfirmRemove(false);
          toast.show({ message: `${claim.item.title} is removed from ${cs}. The claim is closed.` });
        },
        onError: (e) => {
          setConfirmRemove(false);
          setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
        }
      }
    );
  };

  // The phone pins the two choices under the page (06.1).
  useShellOptions(
    {
      context: "Rights",
      actions:
        phone && open ? (
          <div className="cc-claim__pinned">
            <Button block onClick={() => setConfirmRemove(true)}>
              Remove it
            </Button>
            {owner ? (
              <Button block href={answerHref}>
                Answer
              </Button>
            ) : (
              <Button block disabled>
                Answer
              </Button>
            )}
          </div>
        ) : undefined
    },
    [phone, open, owner, answerHref]
  );

  const item = library.data?.items.find((i) => i.id === claim.item.id);
  const imported = item?.source === "link";
  const range = rangeText(claim.rangeStartMs, claim.rangeEndMs);
  const own = claim.takedowns.filter((t) => t.station.id === s.id);
  const carriers = claim.takedowns.filter((t) => t.station.id !== s.id);
  const state = stateWords(claim, cs);

  const confirm = (
    <ConfirmRemove
      open={confirmRemove}
      phone={phone}
      title={`Remove ${claim.item.title} from ${cs}?`}
      busy={remove.isPending}
      onClose={() => setConfirmRemove(false)}
      onConfirm={doRemove}
      cs={cs}
    />
  );

  if (phone && open) {
    const airing = own[0]?.airings?.[0];
    return (
      <article className="cc-claim cc-claim--phone" aria-labelledby="cc-claim-h">
        <Tag variant="standby">{state.text}</Tag>
        <h1 className="cc-claim__ph" id="cc-claim-h">
          {headline(claim, true)}
        </h1>
        <p className="cc-claim__range">{range ? `${range} of ${claim.item.title}.` : claim.item.title}</p>
        {airing && (
          <div className="cc-claim__prow">
            <Lines title={airingWhen(airing.startsAt, now, STATION_TZ)} detail={airing.replacedWith ? `Replaced with ${airing.replacedWith}` : undefined} />
          </div>
        )}
        {!owner && <p className="cc-claim__note">Only the owner can answer a claim.</p>}
        {error && (
          <p className="cc-claim__error" role="alert">
            {error}
          </p>
        )}
        {confirm}
      </article>
    );
  }

  return (
    <article className={phone ? "cc-claim cc-claim--phone-closed" : "cc-claim"} aria-labelledby="cc-claim-h">
      <nav className="cc-claim__crumb" aria-label="Breadcrumb">
        <a href={`${s.base}/rights`}>Rights</a> / <span aria-current="page">{claim.item.title}</span>
      </nav>
      <h1 className="cc-claim__h" id="cc-claim-h">
        {open ? `A rights claim on ${claim.item.title}` : `A claim on ${claim.item.title}`}
      </h1>
      {!open && <p className="cc-claim__summary">{resolvedSummary(claim, cs, STATION_TZ)}</p>}

      <div className="cc-claim__grid">
        <div className="cc-claim__main">
          {open ? (
            <>
              <section className="cc-claim__card" aria-label="The claim">
                <Tag variant="standby">Off air since {clock(claim.receivedAt, { timeZone: STATION_TZ })}</Tag>
                <h2 className="cc-claim__card-h">{headline(claim)}</h2>
                <blockquote className="cc-claim__quote">"{claim.claimText}"</blockquote>
                <KeyValueList
                  items={[
                    { label: "What's claimed", value: claimedLine(claim, range) ?? "Not said" },
                    { label: "Their contact", value: "Through Opencast" },
                    { label: "Sworn statement", value: claim.swornStatement ? "Included, as the law requires" : "Not included" }
                  ]}
                />
              </section>

              <div className="cc-claim__sec">
                <h3 className="cc-claim__sec-h">Where it was scheduled</h3>
                <span className="cc-claim__sec-sub">All removed, gaps filled</span>
              </div>
              <ul className="cc-claim__rows">
                {own.flatMap((t) =>
                  (t.airings ?? []).map((a) => (
                    <li key={a.startsAt} className="cc-claim__row">
                      <Lines title={airingLine(a.startsAt, t.station.callSign ? stationLabel(t.station) : cs, now, STATION_TZ)} detail={a.replacedWith ? `Replaced with ${a.replacedWith}` : undefined} />
                      <Tag>Pulled</Tag>
                    </li>
                  ))
                )}
                {own.some((t) => !t.airings) &&
                  own.map((t) => (
                    <li key={t.station.id} className="cc-claim__row">
                      <Lines title={`${t.station.callSign} ${t.station.channel ?? ""}`} detail={takedownLine(t, true)} />
                      <Tag>Pulled</Tag>
                    </li>
                  ))}
                {carriers.map((t) => (
                  <li key={t.station.id} className="cc-claim__row">
                    <Lines title={`${t.station.callSign} ${t.station.channel ?? ""}`} detail={takedownLine(t, false)} />
                    <Tag>Pulled</Tag>
                  </li>
                ))}
                {!carriers.length && (
                  <li className="cc-claim__row">
                    <Lines title="Carriage" detail={imported || item?.offerable === false ? IMPORTED_CARRIAGE : "None. No other station carries it"} />
                  </li>
                )}
              </ul>
            </>
          ) : (
            <>
              <div className="cc-claim__sec">
                <h3 className="cc-claim__sec-h">Where it was pulled</h3>
                {claim.takedowns[0] && (
                  <span className="cc-claim__sec-sub">
                    {longDate(claim.takedowns[0].pulledAt, STATION_TZ)}, {clock(claim.takedowns[0].pulledAt, { timeZone: STATION_TZ })}
                  </span>
                )}
              </div>
              <ul className="cc-claim__rows">
                {claim.takedowns.map((t) => (
                  <li key={t.station.id} className="cc-claim__row">
                    <Lines title={`${t.station.callSign} ${t.station.channel ?? ""}`} detail={takedownLine(t, t.station.id === s.id)} />
                    <Tag>{takedownTag(claim, t)}</Tag>
                  </li>
                ))}
              </ul>
              {claim.carrierNotice && carriers.length > 0 && (
                <>
                  <div className="cc-claim__sec">
                    <h3 className="cc-claim__sec-h">What carriers were told</h3>
                  </div>
                  <blockquote className="cc-claim__told">"{claim.carrierNotice}"</blockquote>
                </>
              )}
            </>
          )}
        </div>

        <aside className="cc-claim__side" aria-labelledby="cc-claim-next">
          <h3 className="cc-claim__side-h" id="cc-claim-next">
            {open ? "What happens" : "Timeline"}
          </h3>
          <Timeline whenWidth={130} items={open || claim.state === "answered" ? openTimeline(claim, cs, now, STATION_TZ) : resolvedTimeline(claim, cs, STATION_TZ)} />
          {open && (
            <div className="cc-claim__acts">
              <Button block onClick={() => setConfirmRemove(true)}>
                Remove it from {cs}
              </Button>
              {owner ? (
                <Button block href={answerHref}>
                  Answer the claim
                </Button>
              ) : (
                <>
                  <Button block disabled aria-describedby="cc-claim-owner">
                    Answer the claim
                  </Button>
                  <p className="cc-claim__note" id="cc-claim-owner">
                    Only the owner can answer a claim. It goes out with {cs}'s legal name and contact.
                  </p>
                </>
              )}
              {range && <p className="cc-claim__foot">{CUT_FOOTNOTE(range)}</p>}
            </div>
          )}
          {!open && claim.state === "restored" && carriers.length > 0 && <p className="cc-claim__foot">{CARRIERS_TOLD_AGAIN}</p>}
          {error && (
            <p className="cc-claim__error" role="alert">
              {error}
            </p>
          )}
        </aside>
      </div>
      {confirm}
    </article>
  );
}

/** Removing is final: the item leaves the library. Neither choice leans, so the confirm is plain. */
function ConfirmRemove({ open, phone, title, busy, onClose, onConfirm, cs }: { open: boolean; phone: boolean; title: string; busy: boolean; onClose: () => void; onConfirm: () => void; cs: string }) {
  const props = {
    open,
    onClose,
    title,
    footer: (
      <>
        <Button onClick={onClose}>Keep it for now</Button>
        <Button onClick={onConfirm} disabled={busy}>
          Remove it
        </Button>
      </>
    )
  };
  const body = <p className="cc-claim__confirm">It comes out of the library and off every log it was on, and the claim closes. Removing isn't counted against {cs}.</p>;
  return phone ? <Sheet {...props}>{body}</Sheet> : <Modal {...props}>{body}</Modal>;
}
