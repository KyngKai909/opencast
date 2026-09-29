// Adding money, shared by getting started (02.1) and the balance (06.1, the web's Add money): link
// a source through the provider's window when there isn't one of that kind yet, quote it, add it,
// refresh everything that shows the balance, and say what happened: a bank transfer is on its way
// (with Undo, which cancels it before it arrives); a card or Clear account is in the balance now.

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ledgerApi, type FundingSource } from "@opencast/contracts";
import { money, useToast } from "@opencast/ui";
import { call } from "../../api/client";
import { DepositQuoteX } from "../../api/ext/money";
import { ProviderWidget } from "./ProviderWidget";

type Kind = FundingSource["kind"];

/** Everything that shows the balance: the shell's "Available", the Balance page, the runway, the movements. */
export function useRefreshMoney() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      [ledgerApi.getBalance, ledgerApi.listMovements].map((e) => qc.invalidateQueries({ queryKey: [e.method, e.path] }))
    );
}

/** The fee and airings estimate for an amount by a method (a POST, so keyed here by its body). */
export function useQuote(businessId: string, amountMicros: number | null, method: Kind | null) {
  return useQuery({
    queryKey: ["quoteDeposit", businessId, amountMicros, method],
    queryFn: () => call(ledgerApi.quoteDeposit, { params: { businessId }, body: { amountMicros, method } }, DepositQuoteX),
    enabled: !!amountMicros && amountMicros > 0 && !!method,
    staleTime: 60_000,
    retry: false
  });
}

export function useAddMoney(businessId: string) {
  const toast = useToast();
  const refresh = useRefreshMoney();
  const [widgetKind, setWidgetKind] = useState<Kind | null>(null);
  const answer = useRef<((token: string | null) => void) | null>(null);

  const askToken = (kind: Kind) =>
    new Promise<string | null>((resolve) => {
      answer.current = resolve;
      setWidgetKind(kind);
    });

  const widget = (
    <ProviderWidget
      kind={widgetKind}
      onClose={() => {
        answer.current?.(null);
        setWidgetKind(null);
      }}
      onToken={(t) => {
        answer.current?.(t);
        setWidgetKind(null);
      }}
    />
  );

  /** A source of this kind: the business's own, or one linked now (owner only). Null if they closed the window. */
  async function sourceOfKind(kind: Kind, sources: FundingSource[]): Promise<FundingSource | null> {
    const have = sources.find((s) => s.kind === kind && s.isDefault) ?? sources.find((s) => s.kind === kind);
    if (have) return have;
    const token = await askToken(kind);
    if (!token) return null;
    const list = await call(ledgerApi.addFundingSource, { params: { businessId }, body: { kind, token, makeDefault: sources.length === 0 } });
    return list.find((s) => s.kind === kind && !sources.some((o) => o.id === s.id)) ?? list.find((s) => s.kind === kind) ?? null;
  }

  /** Adds the money and says so. Resolves with the deposit, or throws the API's error. */
  async function add(amountMicros: number, source: FundingSource) {
    const res = await call(ledgerApi.addMoney, { params: { businessId }, body: { amountMicros, fundingSourceId: source.id } });
    await refresh();
    const amount = money(amountMicros, { trimCents: true });
    if (res.status === "pending") {
      toast.show({
        message: `${amount} is on its way`,
        onUndo: () => {
          call(ledgerApi.cancelDeposit, { params: { businessId, depositId: res.depositId } })
            .then(() => refresh())
            .then(() => toast.show({ message: `Undone. The ${amount} won't be added.` }))
            .catch((e: Error) => toast.show({ message: e.message }));
        }
      });
    } else {
      toast.show({ message: `${amount} is in your balance` });
    }
    return res;
  }

  return { widget, sourceOfKind, add, refresh };
}
