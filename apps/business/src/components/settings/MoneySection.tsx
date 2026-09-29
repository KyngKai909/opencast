// Settings, Money and receipts (biz-settings 03.1): where money comes from (the default, removing
// one), topping up automatically, the tax details on every receipt, and every receipt and
// statement with its PDF. The owner changes it; managers read it (the lede says why); viewers see
// the receipts and statements only.

import { useState, type FormEvent, type ReactNode } from "react";
import { ledgerApi, spotsApi, type Business, type FundingSource } from "@opencast/contracts";
import { Button, Field, Tag, Toggle, ToggleLock, money } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, call, type CallArgs } from "../../api/client";
import { useApi } from "../../api/hooks";
import { BusinessSettingsX, settingsExtApi, type ReceiptX } from "../../api/ext/settings";
import { shortAddress, useClear } from "../../auth/clear";
import type { BusinessState } from "../../business/BusinessContext";
import { MARKET_TZ } from "../../lib/clock";
import { Quiet } from "../../pages/common";
import { fundingDetail, fundingTitle, shortDay } from "./format";
import { accessFor } from "./rules";
import "./common.css";
import "./MoneySection.css";

const TOP_UPS = [100, 200, 300, 500].map((d) => d * 1_000_000);

function oops(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Try again.";
}

/** "On. Adds $200.00 from Chase ending 8810 when about 3 days of airings are left". */
export function topUpLine(t: Business["autoTopUp"], source: Pick<FundingSource, "label"> | undefined): string {
  if (!t.on) return "Off";
  const from = source ? ` from ${source.label.replace(/^Clear,\s*/, "")}` : "";
  const amount = t.amountMicros ? money(t.amountMicros) : "money";
  return `On. Adds ${amount}${from} when about ${t.belowDays} ${t.belowDays === 1 ? "day" : "days"} of airings ${t.belowDays === 1 ? "is" : "are"} left`;
}

export function MoneySection({ b }: { b: BusinessState }) {
  const access = accessFor(b.role);
  const params = { businessId: b.id };
  const biz = useApi(spotsApi.getBusiness, { params }, { schema: BusinessSettingsX, enabled: access.funding !== "hidden" });
  const balance = useApi(ledgerApi.getBalance, { params }, { enabled: access.funding !== "hidden" });
  const receipts = useApi(settingsExtApi.listReceipts, { params }, { retry: false });
  const clear = useClear();
  const qc = useQueryClient();
  const [error, setError] = useState<{ where: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<"legalName" | "ein" | "receiptsEmail" | null>(null);

  const owner = access.funding === "edit";
  const showFunding = access.funding !== "hidden";

  const run = async (where: string, step: () => Promise<unknown>, refresh: "business" | "balance") => {
    setError(null);
    setBusy(true);
    try {
      await step();
      return true;
    } catch (e) {
      setError({ where, message: oops(e) });
      return false;
    } finally {
      setBusy(false);
      const e = refresh === "business" ? spotsApi.getBusiness : ledgerApi.getBalance;
      void qc.invalidateQueries({ queryKey: [e.method, e.path] });
    }
  };
  const update = (where: string, body: CallArgs["body"]) => run(where, () => call(spotsApi.updateBusiness, { params, body }), "business");
  const errorAt = (where: string) =>
    error?.where === where ? (
      <p className="bz-error" role="alert">
        {error.message}
      </p>
    ) : null;

  const left = () => {
    if (biz.isLoading || balance.isLoading) return <Quiet />;
    if (!biz.data || !balance.data) return <p className="bz-error" role="alert">{((biz.error ?? balance.error) as Error | null)?.message ?? "Something went wrong. Try again."}</p>;
    const d = biz.data;
    const sources = balance.data.fundingSources;
    const def = sources.find((f) => f.isDefault);
    const t = d.autoTopUp;
    return (
      <>
        <div className="bz-sec-top">
          <h4 className="bz-sec-top__h">Funding</h4>
        </div>
        {sources.length === 0 && (
          <div className="bz-row">
            <div>
              <b>Nothing connected yet</b>
              <small>Add money from the Balance page to connect a bank or card</small>
            </div>
          </div>
        )}
        {sources.map((f) => (
          <div key={f.id} className="bz-row">
            <div>
              <b>{fundingTitle(f.kind)}</b>
              <small>{fundingDetail(f)}</small>
            </div>
            <div className="bz-row__end">
              {f.isDefault ? (
                <Tag variant="solid">Default</Tag>
              ) : (
                owner && (
                  <>
                    <Button variant="text" size="sm" disabled={busy} onClick={() => void run("funding", () => call(settingsExtApi.makeDefaultFundingSource, { params: { ...params, sourceId: f.id } }), "balance")}>
                      Make default
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => void run("funding", () => call(settingsExtApi.removeFundingSource, { params: { ...params, sourceId: f.id } }), "balance")}>
                      Remove
                    </Button>
                  </>
                )
              )}
            </div>
          </div>
        ))}
        {owner && clear.account && !sources.some((f) => f.kind === "clear_account") && (
          <div className="bz-row">
            <div>
              <b>Clear business account</b>
              <small>
                {shortAddress(clear.account.address)}. {clear.account.access === "full" ? "Add money from it, and take money out to it" : "Take money out to it. Money is added inside Clear"}
              </small>
            </div>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void run("funding", () => call(ledgerApi.addFundingSource, { params, body: { kind: "clear_account", token: "linked", makeDefault: false } }), "balance")}
            >
              Add as a source
            </Button>
          </div>
        )}
        {errorAt("funding")}
        <div className="bz-row">
          <div>
            <b id="bz-topup">Top up automatically</b>
            <small>{topUpLine(t, def)}</small>
          </div>
          <div className="bz-row__end">
            {owner && t.on && (
              <span className="bz-valsel">
                <select
                  aria-label="Amount to add"
                  value={String(t.amountMicros ?? TOP_UPS[1])}
                  disabled={busy}
                  onChange={(e) => void update("topup", { autoTopUp: { ...t, amountMicros: Number(e.target.value) } })}
                >
                  {[...new Set([...TOP_UPS, t.amountMicros ?? TOP_UPS[1]!])].sort((a, z) => a - z).map((m) => (
                    <option key={m} value={m}>
                      {money(m, { trimCents: true })}
                    </option>
                  ))}
                </select>
              </span>
            )}
            <Toggle
              checked={t.on}
              aria-labelledby="bz-topup"
              disabled={!owner || busy || (!t.on && !def)}
              onChange={(on) => void update("topup", { autoTopUp: { on, amountMicros: t.amountMicros ?? TOP_UPS[1], belowDays: t.belowDays } })}
            />
          </div>
        </div>
        {errorAt("topup")}

        <div className="bz-sec-top bz-money__tax">
          <h4 className="bz-sec-top__h">Tax details</h4>
          <span className="bz-sec-top__sub">On every receipt</span>
        </div>
        <EditRow
          title="Legal name"
          value={d.legalName ?? "Not set"}
          editing={editing === "legalName"}
          canEdit={owner}
          busy={busy}
          initial={d.legalName ?? ""}
          onEdit={() => (setError(null), setEditing("legalName"))}
          onCancel={() => setEditing(null)}
          onSave={async (v) => (await update("legalName", { legalName: v.trim() || null })) && setEditing(null)}
          error={errorAt("legalName")}
        />
        <EditRow
          title="EIN"
          value={d.einLast4 ? `Ending ${d.einLast4}` : "Not set"}
          editing={editing === "ein"}
          canEdit={owner}
          busy={busy}
          initial=""
          placeholder="12-3456789"
          inputMode="numeric"
          lock
          onEdit={() => (setError(null), setEditing("ein"))}
          onCancel={() => setEditing(null)}
          onSave={async (v) => {
            const t = v.trim();
            if (t && !/^\d{2}-?\d{7}$/.test(t)) return setError({ where: "ein", message: "An EIN is nine digits, like 12-3456789." });
            if ((await update("ein", { ein: t || null })) === true) setEditing(null);
          }}
          error={errorAt("ein")}
        />
        <EditRow
          title="Receipts go to"
          value={d.receiptsEmail ?? "Not set"}
          editing={editing === "receiptsEmail"}
          canEdit={owner}
          busy={busy}
          initial={d.receiptsEmail ?? ""}
          inputMode="email"
          onEdit={() => (setError(null), setEditing("receiptsEmail"))}
          onCancel={() => setEditing(null)}
          onSave={async (v) => (await update("receiptsEmail", { receiptsEmail: v.trim().toLowerCase() || null })) && setEditing(null)}
          error={errorAt("receiptsEmail")}
        />
      </>
    );
  };

  return (
    <div className={showFunding ? "bz-money" : "bz-money bz-money--receipts"}>
      {showFunding && <div className="bz-money__col">{left()}</div>}
      <div className="bz-money__col">
        <div className="bz-sec-top">
          <h4 className="bz-sec-top__h">Receipts and statements</h4>
        </div>
        {receipts.isLoading ? (
          <Quiet />
        ) : receipts.error instanceof ApiError && receipts.error.status === 404 ? (
          // E4 isn't in the API yet: the statements are still on the balance.
          <p className="bz-note">
            Receipts aren't listed here yet. Each month's statement is under <a href={`${b.base}/balance/statements`}>Balance, Statements</a>.
          </p>
        ) : !receipts.data ? (
          <p className="bz-error" role="alert">
            {(receipts.error as Error | null)?.message ?? "Something went wrong. Try again."}
          </p>
        ) : receipts.data.length === 0 ? (
          <p className="bz-note">No receipts yet. Adding money, orders and each month's statement are listed here.</p>
        ) : (
          <ul className="bz-rc" aria-label="Receipts and statements">
            {receipts.data.map((r) => (
              <ReceiptRow key={r.id} r={r} />
            ))}
          </ul>
        )}
        <p className="bz-quiet-note">Adding money isn't an expense; spending it on airings is. Receipts for money added say so, so a bookkeeper doesn't count it twice.</p>
      </div>
    </div>
  );
}

/**
 * Opens a receipt's PDF in a new tab. Fetched first, so the mock (which a new tab's own request
 * wouldn't reach) can answer it; a plain link otherwise.
 */
function openPdf(url: string) {
  const w = window.open("", "_blank");
  fetch(url)
    .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
    .then((blob) => {
      const href = URL.createObjectURL(blob);
      if (w) w.location.href = href;
      else window.location.assign(href);
    })
    .catch(() => {
      if (w) w.location.href = url;
      else window.open(url, "_blank", "noreferrer");
    });
}

function ReceiptRow({ r }: { r: ReceiptX }) {
  return (
    <li className="bz-rc__row">
      <span className="bz-rc__t">{shortDay(r.at, MARKET_TZ)}</span>
      <div>
        <b>{r.title}</b>
        {r.detail && <small>{r.detail}</small>}
      </div>
      <span className="bz-rc__m">{money(r.amountMicros)}</span>
      <Button
        size="sm"
        block
        href={r.pdfUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`${r.title}, ${shortDay(r.at, MARKET_TZ)}, PDF`}
        onClick={(e) => {
          e.preventDefault();
          openPdf(r.pdfUrl);
        }}
      >
        PDF
      </Button>
    </li>
  );
}

function EditRow(props: {
  title: string;
  value: string;
  editing: boolean;
  canEdit: boolean;
  busy: boolean;
  initial: string;
  placeholder?: string;
  inputMode?: "numeric" | "email";
  /** The EIN: "Owner only" beside it, for everyone. */
  lock?: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (v: string) => void | Promise<unknown>;
  error: ReactNode;
}) {
  const [v, setV] = useState(props.initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void props.onSave(v);
  };
  if (props.editing)
    return (
      <form className="bz-row bz-row--edit" onSubmit={submit}>
        <div>
          <b>{props.title}</b>
          <div className="bz-inline">
            <Field size="sm" aria-label={props.title} value={v} placeholder={props.placeholder} inputMode={props.inputMode} onChange={(e) => setV(e.target.value)} autoFocus onKeyDown={(e) => e.key === "Escape" && props.onCancel()} />
            <Button size="sm" variant="primary" type="submit" disabled={props.busy}>
              Save
            </Button>
            <Button size="sm" variant="text" onClick={props.onCancel}>
              Cancel
            </Button>
          </div>
          {props.error}
        </div>
      </form>
    );
  return (
    <>
      <div className="bz-row">
        <div>
          <b>{props.title}</b>
          <small>{props.value}</small>
        </div>
        <div className="bz-row__end">
          {props.lock && <ToggleLock label="Owner only">Owner only</ToggleLock>}
          {props.canEdit && (
            <Button size="sm" onClick={() => (setV(props.initial), props.onEdit())} aria-label={`Edit ${props.title.toLowerCase()}`}>
              Edit
            </Button>
          )}
        </div>
      </div>
      {props.error}
    </>
  );
}
