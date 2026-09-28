// Raising a spot's budget (biz-spots 04.1 "Bring it back", 06.2 the phone sheet). Budget is not
// balance: the raise comes from money already available, holds nothing and charges nothing. For a
// spot paused with its budget spent, raising it also brings it back to the market (updateSpot, then
// resumeSpot); the stations that had it are told, and each chooses whether to add it again.

import { useState } from "react";
import { spotsApi } from "@opencast/contracts";
import { AmountPicker, Button, money, Sheet, useToast } from "@opencast/ui";
import type { SpotX } from "../../api/ext/spots";
import { defaultRaise, listWords, plural, RAISE_AMOUNTS, raiseDays } from "./format";
import { errorText, useSpotWrite } from "./data";
import "./RaiseBudget.css";

export interface RaiseProps {
  spot: SpotX;
  available: number;
  /** resume: raise and bring it back (a paused spot). raise: only raise it. */
  mode: "resume" | "raise";
}

/** The stations told when it comes back: the ones that had it when it paused. */
export function toldNames(spot: SpotX): string[] {
  return (spot.pause?.stations ?? []).map((s) => s.station.callSign ?? s.station.name);
}

function useRaise({ spot, available, mode }: RaiseProps) {
  const toast = useToast();
  const [raise, setRaise] = useState(() => defaultRaise(available));
  const update = useSpotWrite(spotsApi.updateSpot);
  const resume = useSpotWrite(spotsApi.resumeSpot);
  const [error, setError] = useState<string | null>(null);
  const over = raise > available;
  const days = raiseDays(raise, spot.pacePerDayMicros ?? spot.budget.dailyCapMicros);
  const newTotal = spot.budget.totalMicros + raise;
  const names = toldNames(spot);
  const busy = update.isPending || resume.isPending;

  const submit = async (): Promise<boolean> => {
    setError(null);
    try {
      await update.mutateAsync({ params: { spotId: spot.id }, body: { budget: { totalMicros: newTotal, dailyCapMicros: spot.budget.dailyCapMicros } } });
      if (mode === "resume") {
        const back = await resume.mutateAsync({ params: { spotId: spot.id } });
        const told = (back.back?.told ?? []).map((s) => s.callSign ?? s.name);
        toast.show({ message: told.length ? `${spot.title} is back in the market. ${listWords(told)} ${told.length === 1 ? "is" : "are"} told.` : `${spot.title} is back in the market.` });
      } else {
        toast.show({ message: `${spot.title}'s budget is ${money(newTotal, { trimCents: true })} now.` });
      }
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  };
  return { raise, setRaise, over, days, newTotal, names, busy, error, submit };
}

function Amounts({ raise, setRaise, label }: { raise: number; setRaise: (n: number) => void; label: string }) {
  return <AmountPicker variant="mono" other={false} label={label} amounts={RAISE_AMOUNTS} value={raise} onChange={(v) => typeof v === "number" && setRaise(v)} />;
}

function overWords(available: number) {
  return `That's more than your ${money(available)} available. Add money first, or raise it by less.`;
}

/** The page's "Bring it back" (or "Raise the budget") column. */
export function RaiseBudget(props: RaiseProps) {
  const r = useRaise(props);
  const { spot, available, mode } = props;
  return (
    <div className="bz-raise">
      <span className="bz-raise__label" aria-hidden="true">
        Raise the budget by
      </span>
      <Amounts raise={r.raise} setRaise={r.setRaise} label="Raise the budget by" />
      <p className="bz-raise__est">
        {r.days !== null && (
          <>
            {money(r.raise, { trimCents: true })} more is about <b>{plural(r.days, "day", "days")}</b> at the same pace.{" "}
          </>
        )}
        It comes from your available {money(available)}; nothing is charged.
      </p>
      {r.over && <p className="bz-raise__error">{overWords(available)}</p>}
      <Button variant="primary" block className="bz-raise__go" disabled={r.over || r.busy} onClick={() => void r.submit()}>
        Raise budget to {money(r.newTotal, { trimCents: true })}
      </Button>
      {mode === "resume" && r.names.length > 0 && <span className="oc-sr-only">{`${listWords(r.names)} will be told it's back.`}</span>}
      {r.error && (
        <p className="bz-raise__error" role="alert">
          {r.error}
        </p>
      )}
    </div>
  );
}

/** The phone's sheet from the pause notification (biz-spots 06.2). */
export function RaiseSheet(props: RaiseProps & { open: boolean; onClose: () => void }) {
  const r = useRaise(props);
  const { spot, available, open, onClose } = props;
  const told = r.names.length ? ` ${listWords(r.names)} will be told it's back.` : "";
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Bring ${spot.title} back`}
      subtitle={`From your ${money(available)} available. Nothing is charged.`}
      footer={
        <Button variant="primary" disabled={r.over || r.busy} onClick={() => void r.submit().then((ok) => ok && onClose())}>
          Raise budget by {money(r.raise, { trimCents: true })}
        </Button>
      }
    >
      <Amounts raise={r.raise} setRaise={r.setRaise} label="Raise the budget by" />
      <p className="bz-raise__est">
        {r.days !== null ? `About ${r.days} more ${r.days === 1 ? "day" : "days"}.` : ""}
        {told}
      </p>
      {r.over && <p className="bz-raise__error">{overWords(available)}</p>}
      {r.error && (
        <p className="bz-raise__error" role="alert">
          {r.error}
        </p>
      )}
    </Sheet>
  );
}
