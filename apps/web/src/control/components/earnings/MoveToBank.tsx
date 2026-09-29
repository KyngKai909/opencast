// Move to bank (owners): any amount up to what's available, to the bank the station is paid to.
// A modal on the web, a sheet on the phone, with the same content and button. Held money isn't
// the station's until its airings run, so it isn't offered.

import { useEffect, useState } from "react";
import { ledgerApi } from "@opencast/contracts";
import { Button, Field, KeyValueList, Modal, Sheet, money, useToast } from "@opencast/ui";
import { ApiError } from "../../../api/client";
import { useApiMutation } from "../../../api/hooks";
import { useIsPhone } from "../../layout/shell";
import { parseAmount } from "./lines";
import "./MoveToBank.css";

export interface MoveToBankProps {
  open: boolean;
  onClose: () => void;
  stationId: string;
  /** "BEAT" */
  name: string;
  availableMicros: number;
  /** "Chase ending 2231" */
  destination: string | null;
}

export function MoveToBank({ open, onClose, stationId, name, availableMicros, destination }: MoveToBankProps) {
  const phone = useIsPhone();
  const toast = useToast();
  const [text, setText] = useState(money(availableMicros));
  const [error, setError] = useState<string | null>(null);
  const move = useApiMutation(ledgerApi.moveToBank, { invalidates: [ledgerApi.getStationEarnings] });

  useEffect(() => {
    if (open) {
      setText(money(availableMicros));
      setError(null);
    }
    // Only when it opens: typing shouldn't be reset by a refresh behind it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const amount = parseAmount(text);
  const valid = amount !== null && amount > 0 && amount <= availableMicros;
  const to = destination ?? "Your bank";

  const submit = () => {
    if (amount === null || amount <= 0) return setError("Enter an amount to move.");
    if (amount > availableMicros) return setError(`Up to ${money(availableMicros)} is available.`);
    move.mutate(
      { params: { stationId }, body: { amountMicros: amount } },
      {
        onSuccess: () => {
          onClose();
          toast.show({ message: `${money(amount)} is on its way to ${to}.` });
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.")
      }
    );
  };

  const body = (
    <form
      id="cc-move"
      className="cc-move"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field
        label="Amount"
        mono
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        error={error ?? undefined}
      />
      <KeyValueList
        items={[
          { label: "To", value: to },
          { label: "Left available", value: valid ? money(availableMicros - amount!) : money(availableMicros) },
          { label: "Arrives", value: "1 to 2 business days, no fee" }
        ]}
      />
      <p className="cc-move__note">Held money isn't included. It becomes {name}'s when each airing runs.</p>
    </form>
  );
  const footer = (
    <Button variant="primary" block type="submit" form="cc-move" disabled={move.isPending}>
      {valid ? `Move ${money(amount!)}` : "Move to bank"}
    </Button>
  );
  const common = { open, onClose, title: "Move to bank", subtitle: `Up to ${money(availableMicros)} is available.`, footer };
  return phone ? <Sheet {...common}>{body}</Sheet> : <Modal {...common} width={500}>{body}</Modal>;
}
