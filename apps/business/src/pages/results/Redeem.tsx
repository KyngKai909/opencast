// biz-results 05.1 and biz-settings 05.1 redeem a code at the counter (/redeem).
// For a business that takes codes in person: type the code (or scan the customer's screen), see
// the check before it counts (valid, first use for this customer, where it was saved: B5's check,
// which counts nothing), then Redeem (spots.redeemCode). Owners and managers only: viewers see
// redemptions in Results. The tool and today's count are P12. Against an API without B5's check,
// the page skips straight to Redeem, and says what redeemCode answers.

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { spotsApi } from "@opencast/contracts";
import { Button, ControlTitle, useToast } from "@opencast/ui";
import { ApiError, call } from "../../api/client";
import { RedeemAnswer, redeemCheck, redeemToday } from "../../api/ext/results";
import { useApi } from "../../api/hooks";
import { useBusiness } from "../../business/BusinessContext";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { CheckResult } from "../../components/results/CheckResult";
import { CodeKeypad } from "../../components/results/CodeKeypad";
import { CodeScanner } from "../../components/results/CodeScanner";
import { plural } from "../../components/results/format";
import { Quiet } from "../common";
import "./Redeem.css";

type Answer = RedeemAnswer;
const clean = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);

export default function Redeem() {
  const b = useBusiness();
  const phone = useIsPhone();
  const toast = useToast();
  const qc = useQueryClient();
  useShellOptions({ title: "Redeem a code" });
  const allowed = b.can("advertise");
  const today = useApi(redeemToday, { params: { businessId: b.id } }, { enabled: allowed, retry: false });

  const [code, setCode] = useState("");
  const [customerRef, setCustomerRef] = useState<string | undefined>();
  const [mode, setMode] = useState<"type" | "scan">("type");
  const [checked, setChecked] = useState<Answer | null>(null);
  // B5 isn't in the API yet: redeem without the check.
  const [noCheck, setNoCheck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const check = useCallback(
    async (value: string, ref?: string) => {
      if (value.length < 3) return;
      const mine = ++seq.current;
      setError(null);
      try {
        const a = await call(redeemCheck, { params: { businessId: b.id }, body: { code: value, ...(ref ? { customerRef: ref } : {}) } }, RedeemAnswer);
        if (mine === seq.current) setChecked(a);
      } catch (e) {
        if (mine !== seq.current) return;
        if (e instanceof ApiError && e.status === 404) setNoCheck(true);
        else setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
      }
    },
    [b.id]
  );

  // Check once typing stops.
  useEffect(() => {
    if (mode !== "type" || checked || noCheck || code.length < 3) return;
    const t = setTimeout(() => void check(code, customerRef), 600);
    return () => clearTimeout(t);
  }, [code, customerRef, mode, checked, noCheck, check]);

  const reset = () => {
    seq.current++;
    setCode("");
    setCustomerRef(undefined);
    setChecked(null);
    setError(null);
    setMode("type");
    setTimeout(() => input.current?.focus(), 0);
  };

  const type = (v: string) => {
    seq.current++;
    setChecked(null);
    setCustomerRef(undefined);
    setCode(clean(v));
  };

  const redeem = async () => {
    setBusy(true);
    setError(null);
    try {
      const a = await call(spotsApi.redeemCode, { params: { businessId: b.id }, body: { code, ...(customerRef ? { customerRef } : {}) } }, RedeemAnswer);
      if (!a.valid) {
        setChecked(a);
        return;
      }
      void qc.invalidateQueries({ queryKey: [redeemToday.method, redeemToday.path] });
      void qc.invalidateQueries({ queryKey: [spotsApi.getResults.method, spotsApi.getResults.path] });
      toast.show({ message: `Redeemed ${a.code ?? code}${a.offer ? `, ${a.offer}` : ""}.` });
      reset();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const onScan = useCallback(
    (d: { code: string; customerRef?: string }) => {
      setMode("type");
      setCode(d.code);
      setCustomerRef(d.customerRef);
      setChecked(null);
      void check(d.code, d.customerRef);
    },
    [check]
  );

  const title = !phone ? <ControlTitle title="Redeem a code" description={checked ? undefined : b.business.name} /> : null;

  if (!allowed)
    return (
      <div className="bz-redeem">
        {title}
        <p className="bz-redeem__quiet">Viewers can see redemptions in Results but can't mark codes as used.</p>
        <Button size="sm" href={`${b.base}/results`}>
          Where it aired
        </Button>
      </div>
    );
  if (today.isLoading) return <Quiet />;
  if (today.data && !today.data.on)
    return (
      <div className="bz-redeem">
        {title}
        <p className="bz-redeem__quiet">Redeem is off for this business. Turn it on in Settings to mark codes used at the counter.</p>
      </div>
    );

  const countLine = today.data
    ? `${plural(today.data.redeemedToday, "code")} redeemed today.${today.data.clearPay ? " Online and Clear Pay uses are counted by themselves." : " Online uses are counted by themselves."}`
    : null;

  // Checked (biz-results 05.1): the code, the check, Redeem.
  if (checked || noCheck) {
    const valid = checked ? checked.valid : true;
    return (
      <div className="bz-redeem bz-redeem--checked">
        {title}
        <p className="bz-redeem__intro">Type the code, or scan the customer's screen.</p>
        <button type="button" className="bz-redeem__field bz-redeem__field--set" onClick={reset} aria-label={`${code}. Type another code`}>
          {code}
        </button>
        {checked && <CheckResult valid={valid} heading={valid ? (checked.offer ?? code) : code} message={checked.message} />}
        {error && (
          <p className="bz-redeem__error" role="alert">
            {error}
          </p>
        )}
        {valid ? (
          <Button variant="primary" block className="bz-redeem__go" onClick={redeem} disabled={busy}>
            Redeem
          </Button>
        ) : (
          <Button variant="primary" block className="bz-redeem__go" onClick={reset}>
            Type another code
          </Button>
        )}
        <Button block className="bz-redeem__alt" onClick={() => (reset(), setMode("scan"))}>
          Scan instead
        </Button>
      </div>
    );
  }

  // Typing or scanning (biz-settings 05.1).
  return (
    <div className="bz-redeem">
      {title}
      {mode === "scan" ? (
        <>
          <CodeScanner onCode={onScan} />
          <Button block className="bz-redeem__alt" onClick={reset}>
            Type a code instead
          </Button>
        </>
      ) : (
        <>
          <label className="oc-sr-only" htmlFor="bz-redeem-code">
            Code
          </label>
          <input
            id="bz-redeem-code"
            ref={input}
            className="bz-redeem__field"
            value={code}
            onChange={(e) => type(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void check(code, customerRef);
            }}
            placeholder="Type a code"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            maxLength={16}
          />
          <Button block icon="scan" onClick={() => setMode("scan")}>
            Scan the customer's phone
          </Button>
          <CodeKeypad onKey={(k) => type(code + k)} />
          {error && (
            <p className="bz-redeem__error" role="alert">
              {error}
            </p>
          )}
          {countLine && <p className="bz-redeem__count">{countLine}</p>}
        </>
      )}
    </div>
  );
}
