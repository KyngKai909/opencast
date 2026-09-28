// "Change" on the code check (biz-spots 02.1): the code's words and the offer customers save with
// it. Where it sits and when it shows aren't changeable yet (contract request P4).

import { useState } from "react";
import { spotsApi } from "@opencast/contracts";
import { Button, Field, Modal, Sheet } from "@opencast/ui";
import type { SpotX } from "../../api/ext/spots";
import { useIsPhone } from "../../layout/shell";
import { errorText, useSpotWrite } from "./data";

const CODE = /^[A-Z0-9]{3,16}$/;

export function CodeModal({ spot, open, onClose }: { spot: SpotX; open: boolean; onClose: () => void }) {
  const phone = useIsPhone();
  const save = useSpotWrite(spotsApi.updateSpot);
  const [code, setCode] = useState(spot.code?.code ?? "");
  const [offer, setOffer] = useState(spot.code?.offer ?? "");
  const codeOk = CODE.test(code);
  const offerOk = offer.trim().length > 0 && offer.length <= 80;
  const submit = () =>
    save.mutate(
      { params: { spotId: spot.id }, body: { code: { code, offer: offer.trim(), windowDays: spot.code?.windowDays ?? 7 } } },
      { onSuccess: onClose }
    );
  const content = {
    title: "Change the code",
    subtitle: "Customers scan it or type it, and save the offer.",
    footer: (
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!codeOk || !offerOk || save.isPending} onClick={submit}>
          Save
        </Button>
      </>
    ),
    children: (
      <div className="bz-codemodal">
        <Field
          label="Code"
          mono
          value={code}
          maxLength={16}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          error={code && !codeOk ? "3 to 16 letters and numbers" : undefined}
        />
        <Field label="Offer" value={offer} maxLength={80} onChange={(e) => setOffer(e.target.value)} help="What customers get: 10% off, a free pastry" />
        {save.error && (
          <p className="bz-sperror" role="alert">
            {errorText(save.error)}
          </p>
        )}
      </div>
    )
  };
  return phone ? <Sheet open={open} onClose={onClose} {...content} /> : <Modal open={open} onClose={onClose} {...content} />;
}
