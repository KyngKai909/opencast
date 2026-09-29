// Settings, Connections (biz-settings 04.1, the second pane of the notifications frame): the Clear
// account (Connect Clear: the owner's Clear wallet, linked through Privy's cross-app linking,
// read-only or with full access), Clear Pay (codes counted at the counter) and an online checkout
// (codes counted online), and whether codes are marked used in the app (the Redeem tool, P12). All
// optional. The owner connects them; managers and viewers see their status only (the Clear account
// as the business's funding source, since the link is the owner's). Connections are P20's
// spots.getConnections, connect and disconnect. A checkout connects with the webhook signing
// secret its provider shows; the owner then pastes the address the API gives (`webhookUrl`) into
// the provider, and each promotion code used online counts as a use.

import { useState, type FormEvent } from "react";
import { ledgerApi, spotsApi, type ClearLink } from "@opencast/contracts";
import { Button, Field, Tag, Toggle, useToast } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, apiUrl, call } from "../../api/client";
import { useApi } from "../../api/hooks";
import { shortAddress, useClear, type ClearState } from "../../auth/clear";
import type { BusinessState } from "../../business/BusinessContext";
import { config } from "../../config";
import { MARKET_TZ } from "../../lib/clock";
import { Quiet } from "../../pages/common";
import { shortDay } from "./format";
import { READ_ONLY, accessFor } from "./rules";
import "./common.css";
import "./NotifyConnections.css";

type Provider = "shopify" | "stripe" | "square";
/** Each checkout, and where its webhook signing secret is (what `connect` takes as `token`). */
export const PROVIDERS: { id: Provider; label: string; secret: string; where: string }[] = [
  { id: "shopify", label: "Shopify", secret: "Shopify's app secret", where: "In Shopify, under your app's API credentials" },
  { id: "stripe", label: "Stripe", secret: "Stripe's signing secret", where: "In Stripe, on the webhook's page. It starts whsec_" },
  { id: "square", label: "Square", secret: "Square's signature key", where: "In Square, on the webhook subscription's page" }
];

/**
 * Clear Pay connects through Clear's own flow, which hands back a token. That flow isn't in the app
 * yet (Clear hasn't defined Clear Pay's events: docs/clear-integration.md), so only the mock
 * connects it; against the API, Connect says so.
 */
const CLEAR_PAY_TOKEN = config.mock ? "mock-connect-token" : null;

/** "Applies ORANGE10 and other codes when…": the codes on the business's live spots. */
export function clearPayLine(codes: string[]): string {
  const which = codes.length === 0 ? "your codes" : codes.length === 1 ? codes[0] : `${codes[0]} and other codes`;
  return `Applies ${which} when customers pay in person, and counts them in Results`;
}

/** What Clear shares, in plain words. */
export const CLEAR_ACCESS: Record<ClearLink["access"], string> = {
  read_only: "Payouts and withdrawals can go here. Money is added inside Clear.",
  full: "You can also add money from Clear. You confirm each transfer in Clear."
};

/** "0x1f2e…c1ea. Linked Sept 26". */
export function clearLinkedLine(l: ClearLink, timeZone = MARKET_TZ): string {
  return `${shortAddress(l.address)}. Linked ${shortDay(l.linkedAt, timeZone)}`;
}

const CLEAR_PITCH = "Funds your balance for free, and money you take out goes back to it";

/** The owner's row: their linked Clear account, Connect Clear and Disconnect. */
function ClearOwnerRow({ clear }: { clear: ClearState }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (f: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const a = clear.account;
  return (
    <>
      <div className="bz-conn__row">
        <span className={a ? "bz-conn__ic" : "bz-conn__ic bz-conn__ic--off"} aria-hidden="true" />
        <div>
          <b>Clear business account</b>
          {a ? (
            <>
              <small className="bz-conn__mono">{clearLinkedLine(a)}</small>
              <small>{CLEAR_ACCESS[a.access]}</small>
            </>
          ) : (
            <small>{clear.available ? CLEAR_PITCH : `${CLEAR_PITCH}. Connect Clear isn't set up here yet.`}</small>
          )}
        </div>
        <div className="bz-conn__end">
          {a && (
            <Tag variant="solid" className="bz-conn__tag">
              Connected
            </Tag>
          )}
          {clear.available &&
            (a ? (
              <Button size="sm" variant="text" disabled={busy} onClick={() => void act(clear.unlink)}>
                Disconnect
              </Button>
            ) : (
              <Button size="sm" disabled={busy || clear.loading} onClick={() => void act(clear.link)}>
                {busy ? "Waiting for Clear" : "Connect Clear"}
              </Button>
            ))}
        </div>
      </div>
      {error && (
        <p className="bz-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

export function ConnectionsSection({ b, heading }: { b: BusinessState; heading: boolean }) {
  const params = { businessId: b.id };
  const conns = useApi(spotsApi.getConnections, { params });
  const biz = useApi(spotsApi.getBusiness, { params }, { staleTime: 60_000 });
  const balance = useApi(ledgerApi.getBalance, { params });
  const spots = useApi(spotsApi.listSpots, { params }, { enabled: b.can("see") });
  const clear = useClear();
  const qc = useQueryClient();
  const toast = useToast();
  const owner = accessFor(b.role).connections === "edit";
  const [choosing, setChoosing] = useState(false);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (step: () => Promise<unknown>, done?: string) => {
    setError(null);
    setBusy(true);
    try {
      await step();
      setChoosing(false);
      setProvider(null);
      setSecret("");
      if (done) toast.show({ message: done });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
      for (const e of [spotsApi.getConnections, spotsApi.getBusiness, spotsApi.redeemToday]) void qc.invalidateQueries({ queryKey: [e.method, e.path] });
    }
  };
  const connectClearPay = () => {
    if (!CLEAR_PAY_TOKEN) return setError("Clear Pay connects from Clear, and that isn't set up here yet.");
    void run(() => call(spotsApi.connect, { params: { ...params, kind: "clear_pay" }, body: { token: CLEAR_PAY_TOKEN } }));
  };
  const connectCheckout = (e: FormEvent) => {
    e.preventDefault();
    const p = PROVIDERS.find((x) => x.id === provider);
    if (!p) return;
    if (!secret.trim()) return setError(`Paste ${p.secret} to connect.`);
    void run(() => call(spotsApi.connect, { params: { ...params, kind: "checkout" }, body: { token: secret.trim(), provider: p.id } }), `${p.label} is connected.`);
  };
  const disconnect = (kind: "clear_pay" | "checkout") => void run(() => call(spotsApi.disconnect, { params: { ...params, kind } }));
  const setRedeem = (on: boolean) => void run(() => call(spotsApi.updateBusiness, { params, body: { redeemOn: on } }));

  const head = heading && (
    <>
      <h3 className="bz-conn__h">Connections</h3>
      <p className="bz-conn__lede">Optional. Opencast works without them.</p>
    </>
  );

  if (conns.isLoading || balance.isLoading || (owner && clear.loading))
    return (
      <div className="bz-conn">
        {head}
        <Quiet />
      </div>
    );

  const c = conns.data;
  // Managers and viewers: the Clear account as the business uses it, a funding source.
  const clearSource = balance.data?.fundingSources.find((f) => f.kind === "clear_account");
  const clearOn = owner ? !!clear.account : !!clearSource;
  const codes = [...new Set((spots.data ?? []).filter((s) => s.code && s.state !== "ended" && s.state !== "draft").map((s) => s.code!.code))];
  const checkout = c?.checkout.provider ? PROVIDERS.find((p) => p.id === c.checkout.provider) : undefined;
  const picked = PROVIDERS.find((p) => p.id === provider);
  const redeemOn = biz.data?.redeemOn;

  const status = (connected: boolean, onConnect: () => void, kind?: "clear_pay" | "checkout") =>
    connected ? (
      <div className="bz-conn__end">
        <Tag variant="solid" className="bz-conn__tag">
          Connected
        </Tag>
        {owner && kind && (
          <Button size="sm" variant="text" disabled={busy} onClick={() => disconnect(kind)}>
            Disconnect
          </Button>
        )}
      </div>
    ) : owner ? (
      <Button size="sm" onClick={onConnect} disabled={busy}>
        Connect
      </Button>
    ) : (
      <Tag className="bz-conn__tag">Not connected</Tag>
    );

  return (
    <div className="bz-conn">
      {head}
      {!owner && <p className="bz-readonly">{READ_ONLY.connections}</p>}
      {owner ? (
        <ClearOwnerRow clear={clear} />
      ) : (
        <div className="bz-conn__row">
          <span className={clearSource ? "bz-conn__ic" : "bz-conn__ic bz-conn__ic--off"} aria-hidden="true" />
          <div>
            <b>Clear business account</b>
            <small>{clearSource ? `Funds your balance from ${clearSource.label.replace(/^Clear,\s*/, "")}, free. Money you take out goes back here` : CLEAR_PITCH}</small>
          </div>
          {status(!!clearSource, () => undefined)}
        </div>
      )}
      {!c ? (
        <p className="bz-error" role="alert">
          {(conns.error as Error | null)?.message ?? "Something went wrong. Try again."}
        </p>
      ) : (
        <>
          <div className="bz-conn__row">
            <span className={c.clearPay.connected ? "bz-conn__ic" : "bz-conn__ic bz-conn__ic--off"} aria-hidden="true" />
            <div>
              <b>Clear Pay</b>
              <small>{clearPayLine(codes)}</small>
            </div>
            {status(c.clearPay.connected, connectClearPay, "clear_pay")}
          </div>
          <div className="bz-conn__row">
            <span className={c.checkout.connected ? "bz-conn__ic" : "bz-conn__ic bz-conn__ic--off"} aria-hidden="true" />
            <div>
              <b>Your online checkout</b>
              <small>{c.checkout.connected && checkout ? `${checkout.label} is connected. Codes used online are counted too` : "Connect Shopify, Stripe or Square and codes used online are counted too"}</small>
              {c.checkout.connected && c.checkout.webhookUrl && (
                <>
                  <small>Send {checkout?.label ?? "your checkout"}'s order webhooks to</small>
                  <small className="bz-conn__mono bz-conn__url">{apiUrl(c.checkout.webhookUrl)}</small>
                </>
              )}
              {choosing && !picked && (
                <div className="bz-conn__pick" role="group" aria-label="Your online checkout">
                  {PROVIDERS.map((p) => (
                    <Button key={p.id} size="sm" disabled={busy} onClick={() => (setError(null), setProvider(p.id))}>
                      {p.label}
                    </Button>
                  ))}
                  <Button size="sm" variant="text" onClick={() => setChoosing(false)}>
                    Cancel
                  </Button>
                </div>
              )}
              {choosing && picked && (
                <form className="bz-conn__secret" onSubmit={connectCheckout} noValidate>
                  <Field size="sm" label={picked.secret} help={picked.where} value={secret} autoComplete="off" spellCheck={false} onChange={(e) => setSecret(e.target.value)} />
                  <div className="bz-conn__pick">
                    <Button size="sm" variant="primary" type="submit" disabled={busy}>
                      Connect {picked.label}
                    </Button>
                    <Button size="sm" variant="text" onClick={() => (setProvider(null), setSecret(""), setError(null))}>
                      Back
                    </Button>
                  </div>
                </form>
              )}
            </div>
            {!choosing && status(c.checkout.connected, () => setChoosing(true), "checkout")}
          </div>
        </>
      )}
      {redeemOn !== undefined && (
        <div className="bz-conn__row">
          <span className={redeemOn ? "bz-conn__ic" : "bz-conn__ic bz-conn__ic--off"} aria-hidden="true" />
          <div>
            <b id="bz-redeem-on">Redeem in the app</b>
            <small>Owners and managers mark codes used at the counter, from Redeem on their phone</small>
          </div>
          {owner ? <Toggle checked={redeemOn} aria-labelledby="bz-redeem-on" disabled={busy} onChange={setRedeem} /> : <Tag className="bz-conn__tag">{redeemOn ? "On" : "Off"}</Tag>}
        </div>
      )}
      {clearOn && (
        <div className="bz-conn__row bz-conn__row--last">
          <span className="bz-conn__ic bz-conn__ic--off" aria-hidden="true" />
          <div>
            <b>Sponsor as Clear</b>
            <small>Clear's own sponsorships are run from Clear's account, not here</small>
          </div>
          <span />
        </div>
      )}
      {error && (
        <p className="bz-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
