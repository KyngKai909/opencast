// Settings, Connections (biz-settings 04.1, the second pane of the notifications frame): the Clear
// account (Connect Clear: the owner's Clear wallet, linked through Privy's cross-app linking,
// read-only or with full access), Clear Pay (codes counted at the counter) and an online checkout
// (codes counted online). All optional. The owner connects them; managers and viewers see their
// status only (the Clear account as the business's funding source, since the link is the owner's).
// Without P20 (the real API today) Clear Pay and the checkout are left out.

import { useState } from "react";
import { ledgerApi, spotsApi, type ClearLink } from "@opencast/contracts";
import { Button, Tag } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, call } from "../../api/client";
import { useApi } from "../../api/hooks";
import { settingsExtApi } from "../../api/ext/settings";
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
const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "shopify", label: "Shopify" },
  { id: "stripe", label: "Stripe" },
  { id: "square", label: "Square" }
];

/**
 * Clear Pay's and a checkout's own flows hand back a token (Shopify's OAuth…). Only the mock
 * connects without one; against the API the button explains it isn't ready (P20).
 */
const MOCK_TOKEN = config.mock ? "mock-connect-token" : null;

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
  const conns = useApi(settingsExtApi.getConnections, { params }, { retry: false });
  const balance = useApi(ledgerApi.getBalance, { params });
  const spots = useApi(spotsApi.listSpots, { params }, { enabled: b.can("see") });
  const clear = useClear();
  const qc = useQueryClient();
  const owner = accessFor(b.role).connections === "edit";
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (step: () => Promise<unknown>) => {
    setError(null);
    if (!MOCK_TOKEN) return setError("Connecting isn't available here yet.");
    setBusy(true);
    try {
      await step();
      setChoosing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: [settingsExtApi.getConnections.method, settingsExtApi.getConnections.path] });
    }
  };

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

  // Without the connections endpoint (P20), Clear Pay and the checkout are left out.
  const c = conns.data;
  // Managers and viewers: the Clear account as the business uses it, a funding source.
  const clearSource = balance.data?.fundingSources.find((f) => f.kind === "clear_account");
  const clearOn = owner ? !!clear.account : !!clearSource;
  const codes = [...new Set((spots.data ?? []).filter((s) => s.code && s.state !== "ended" && s.state !== "draft").map((s) => s.code!.code))];

  const status = (connected: boolean, onConnect: () => void) =>
    connected ? (
      <Tag variant="solid" className="bz-conn__tag">
        Connected
      </Tag>
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
      {c && (
        <div className="bz-conn__row">
          <span className={c.clearPay.connected ? "bz-conn__ic" : "bz-conn__ic bz-conn__ic--off"} aria-hidden="true" />
          <div>
            <b>Clear Pay</b>
            <small>{clearPayLine(codes)}</small>
          </div>
          {status(c.clearPay.connected, () => void run(() => call(settingsExtApi.connect, { params: { ...params, kind: "clear_pay" }, body: { token: MOCK_TOKEN ?? "" } })))}
        </div>
      )}
      {c && (
        <div className="bz-conn__row">
          <span className={c.checkout.connected ? "bz-conn__ic" : "bz-conn__ic bz-conn__ic--off"} aria-hidden="true" />
          <div>
            <b>Your online checkout</b>
            <small>
              {c.checkout.connected && c.checkout.provider
                ? `${PROVIDERS.find((p) => p.id === c.checkout.provider)!.label} is connected. Codes used online are counted too`
                : "Connect Shopify, Stripe or Square and codes used online are counted too"}
            </small>
            {choosing && (
              <div className="bz-conn__pick" role="group" aria-label="Your online checkout">
                {PROVIDERS.map((p) => (
                  <Button
                    key={p.id}
                    size="sm"
                    disabled={busy}
                    onClick={() => void run(() => call(settingsExtApi.connect, { params: { ...params, kind: "checkout" }, body: { token: MOCK_TOKEN ?? "", provider: p.id } }))}
                  >
                    {p.label}
                  </Button>
                ))}
                <Button size="sm" variant="text" onClick={() => setChoosing(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
          {!choosing && status(c.checkout.connected, () => setChoosing(true))}
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
