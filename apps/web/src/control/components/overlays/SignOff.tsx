// Sign off, from the header's button beside the lit tally (owners only), opened with
// ?modal=sign-off over any page: what signing off does, then playout.signOff. A modal on the web,
// a sheet on the phone. No frame draws it; its words are listed as new copy.

import { useSearchParams } from "react-router";
import { playoutApi } from "@opencast/contracts";
import { Button, Modal, Notice, Sheet, useToast } from "@opencast/ui";
import { useApiMutation } from "../../../api/hooks";
import { LOG_READS, usePlayout } from "../onair/data";
import { useIsPhone } from "../../layout/shell";
import { useStation } from "../../station/StationContext";

export default function SignOff() {
  const [params, setParams] = useSearchParams();
  const s = useStation();
  const phone = useIsPhone();
  const toast = useToast();
  const signOff = useApiMutation(playoutApi.signOff, { invalidates: LOG_READS });
  const open = params.get("modal") === "sign-off" && !s.studio;
  const playout = usePlayout(s.id, { enabled: open });
  if (!open) return null;

  const close = () =>
    setParams(
      (p) => {
        p.delete("modal");
        return p;
      },
      { replace: true }
    );
  const name = s.label;
  const allowed = s.can("manage");

  const go = () =>
    signOff.mutate(
      { params: { stationId: s.id }, body: { permanently: false } },
      {
        onSuccess: () => {
          close();
          toast.show({ message: `${name} is off air.` });
        }
      }
    );

  const offAir = playout.data ? !playout.data.onAir : false;
  const content = {
    title: offAir ? `${name} is off air` : `Sign off ${name}?`,
    subtitle: offAir ? "There's nothing to sign off." : allowed ? `${name} stops going out now. Viewers see "Off air" until you sign on again. The log stays as it is.` : "Only an owner can sign off.",
    footer: (
      <>
        <Button onClick={close}>{offAir ? "Close" : "Stay on air"}</Button>
        {allowed && !offAir && (
          <Button variant="ink" onClick={go} disabled={signOff.isPending}>
            Sign off
          </Button>
        )}
      </>
    ),
    children: signOff.isError ? <Notice tone="standby">{signOff.error.message}</Notice> : undefined
  };

  return phone ? <Sheet open onClose={close} {...content} /> : <Modal open onClose={close} width={440} {...content} />;
}
