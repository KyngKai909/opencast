// Changing a code's offer (biz-results 03.1 Settings, "Change"): the words customers see, and how
// long after an airing a use counts as a customer. Saves through spots.updateSpot; a modal on the
// web, a sheet on the phone.

import { useState } from "react";
import { spotsApi } from "@opencast/contracts";
import { Button, Field, Modal, Sheet } from "@opencast/ui";
import { ApiError } from "../../api/client";
import { useApiMutation } from "../../api/hooks";

export function OfferModal(props: { open: boolean; onClose: () => void; onSaved: () => void; phone: boolean; spotId: string; code: string; offer: string; windowDays: number }) {
  const [offer, setOffer] = useState(props.offer);
  const [days, setDays] = useState(String(props.windowDays));
  const save = useApiMutation(spotsApi.updateSpot, { invalidates: [spotsApi.getResults, spotsApi.getSpot, spotsApi.listSpots] });
  const n = Number(days);
  const daysOk = Number.isInteger(n) && n >= 1 && n <= 60;
  const error = save.error instanceof ApiError ? save.error.message : save.error ? "Something went wrong. Try again." : undefined;
  const submit = () => {
    if (!offer.trim() || !daysOk) return;
    save.mutate({ params: { spotId: props.spotId }, body: { code: { code: props.code, offer: offer.trim(), windowDays: n } } }, { onSuccess: props.onSaved });
  };
  const body = (
    <form
      id="bz-offer-form"
      className="bz-offer-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="Offer" value={offer} maxLength={80} onChange={(e) => setOffer(e.target.value)} error={!offer.trim() ? "Say what the offer is." : undefined} />
      <Field
        label="Counts as a customer if used within"
        mono
        inputMode="numeric"
        value={days}
        onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))}
        end="days"
        error={daysOk ? error : "From 1 to 60 days."}
      />
    </form>
  );
  const footer = (
    <Button variant="primary" type="submit" form="bz-offer-form" disabled={save.isPending || !offer.trim() || !daysOk}>
      Save
    </Button>
  );
  const common = { open: props.open, onClose: props.onClose, title: "Change the offer", subtitle: `${props.code}. Customers see it when they save the offer.`, footer };
  return props.phone ? <Sheet {...common}>{body}</Sheet> : <Modal {...common}>{body}</Modal>;
}
