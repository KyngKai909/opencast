// Linking a funding source happens in the provider's own window (Clear's bank link, Stripe's card
// form, Clear's sign-in), which hands back a token for ledger.addFundingSource. Opencast never sees
// the bank or card details. Neither provider's SDK is in the app yet, so in mock mode this stands in
// for the window and returns a test token; against the real API it says it can't open yet.

import type { FundingSource } from "@opencast/contracts";
import { Button, Modal, Sheet } from "@opencast/ui";
import { config } from "../../config";
import { useIsPhone } from "../../layout/shell";
import "./ProviderWidget.css";

type Kind = FundingSource["kind"];

const WORDS: Record<Kind, { title: string; mock: string }> = {
  clear_bank: { title: "Link a bank through Clear", mock: "Clear's own window opens here to choose the bank. In this demo it links a test account, Chase ending 8810." },
  card: { title: "Add a card", mock: "Stripe's own card form opens here. In this demo it adds a test card, Visa ending 4417." },
  clear_account: { title: "Connect your Clear business account", mock: "Clear's own window opens here to sign in. In this demo it connects a test account." }
};

export function ProviderWidget({ kind, onToken, onClose }: { kind: Kind | null; onToken: (token: string) => void; onClose: () => void }) {
  const phone = useIsPhone();
  if (!kind) return null;
  const w = WORDS[kind];
  const body = <p className="bz-provider__p">{config.mock ? w.mock : "This can't open yet. Try again later, or choose another way to add money."}</p>;
  const footer = (
    <Button variant="primary" disabled={!config.mock} onClick={() => onToken(`mock_${kind}_${Date.now()}`)}>
      Continue
    </Button>
  );
  return phone ? (
    <Sheet open onClose={onClose} title={w.title} footer={footer}>
      {body}
    </Sheet>
  ) : (
    <Modal open onClose={onClose} title={w.title} footer={footer}>
      {body}
    </Modal>
  );
}
