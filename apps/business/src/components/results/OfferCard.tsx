// The saved offer as the customer sees it on their phone (biz-results 03.1, "What customers see"):
// the station it was saved from, the offer and the business, where and until when, and the code
// to show at the counter or type at checkout online.

import "./OfferCard.css";

export function OfferCard(props: { savedFrom: string | null; offer: string; business: string; where: string | null; until: string; code: string }) {
  return (
    <figure className="bz-offer" aria-label="The saved offer, as customers see it">
      {props.savedFrom && <p className="bz-offer__from">Saved from {props.savedFrom}</p>}
      <p className="bz-offer__h">
        {props.offer} at {props.business}
      </p>
      <p className="bz-offer__where">{[props.where, `Until ${props.until}`].filter(Boolean).join(". ")}</p>
      <p className="bz-offer__code">{props.code}</p>
      <p className="bz-offer__how">Show this when you pay, or use it at checkout online</p>
    </figure>
  );
}
