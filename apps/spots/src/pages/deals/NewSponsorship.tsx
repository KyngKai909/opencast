// sponsorships 02.1 sponsor a station or program (/sponsorships/new): what to sponsor (P16, with
// each one's minimum and room), the credit line checked against the rules as it's typed
// (spots.checkCredit), the credit as it will air with the fixes already applied, the amount against
// the station's minimum, and Send (offerSponsorship), held back until everything passes.
// Owners and managers.

import { useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { spotsApi } from "@opencast/contracts";
import { Button, Field, money, useToast } from "@opencast/ui";
import { CreditCheckX, type CreditFlag, type SponsorTarget } from "../../api/ext/deals";
import { call } from "../../api/client";
import { useBusiness } from "../../business/BusinessContext";
import { CreditEditor } from "../../components/deals/CreditEditor";
import { CreditRules } from "../../components/deals/CreditRules";
import { CreditSlate } from "../../components/deals/CreditSlate";
import { errorText, useBalance, useProfile, useTargets, useWrite } from "../../components/deals/data";
import { applyFixes, callSign, creditLine, dayText, fixLine, hasRoom, marketDate, nextFirst, parseAmount, roomLine, targetTitle } from "../../components/deals/format";
import { PickRows } from "../../components/deals/PickRows";
import { ErrorLine, NoAccess, PageHead, QuietRows } from "../../components/deals/parts";
import { useShellOptions } from "../../layout/shell";
import { useNow } from "../../lib/clock";
import "./NewSponsorship.css";

const keyOf = (t: Pick<SponsorTarget, "station" | "program">) => `${t.station.id}:${t.program?.id ?? "all"}`;

export default function NewSponsorship() {
  const b = useBusiness();
  useShellOptions({ title: "Sponsor a station or program" });
  if (!b.can("advertise")) return <NoAccess base={b.base} />;
  return <NewSponsorshipPage />;
}

/** The text after it's stopped changing for a moment: the check runs as you type, not per key. */
function useSettled<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function NewSponsorshipPage() {
  const b = useBusiness();
  const navigate = useNavigate();
  const toast = useToast();
  const ids = { credit: useId(), rules: useId(), amount: useId() };
  const today = marketDate(useNow(60_000));
  const targets = useTargets(b);
  const profile = useProfile(b);
  const balance = useBalance(b);
  const offer = useWrite(spotsApi.offerSponsorship);

  const list = targets.data?.targets ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const target = list.find((t) => keyOf(t) === picked) ?? list.find(hasRoom) ?? null;

  // The credit starts from the business's own description; the check says what has to change.
  const [text, setText] = useState<string | null>(null);
  const credit = text ?? profile.data?.about ?? "";
  const settled = useSettled(credit);
  const check = useQuery({
    queryKey: ["deals", "credit-check", settled],
    queryFn: () => call(spotsApi.checkCredit, { body: { text: settled } }, CreditCheckX),
    enabled: settled.trim().length > 0,
    staleTime: Infinity,
    placeholderData: (prev) => prev
  });
  const current = check.data && settled === credit ? check.data : null;
  const flags = current?.flags ?? [];

  const [amountText, setAmountText] = useState<string | null>(null);
  const minimum = target?.minMonthlyMicros ?? 0;
  const amountShown = amountText ?? money(minimum);
  const amount = parseAmount(amountShown);
  const startsOn = nextFirst(today);
  const available = balance.data?.availableMicros ?? null;
  const cs = target ? callSign(target.station) : "";

  const reason = useMemo(() => {
    if (!target) return "Choose what to sponsor.";
    if (!credit.trim()) return "Write your credit to send.";
    if (flags.length) return fixLine(flags.length);
    if (!current) return "Checking your credit.";
    if (amount === null) return "Enter the amount a month.";
    if (amount < minimum) return `${cs}'s minimum is ${money(minimum, { trimCents: true })}.`;
    if (available !== null && available < amount) return "Your balance can't cover the first month. Add money to send.";
    return null;
  }, [target, credit, flags.length, current, amount, minimum, cs, available]);

  const fix = (f: CreditFlag) => setText(applyFixes(credit, [f]).replace(/\s{2,}/g, " "));
  const preview = creditLine(applyFixes(credit, flags));

  const send = () => {
    if (!target || reason || amount === null) return;
    offer.mutate(
      { params: { businessId: b.id }, body: { stationId: target.station.id, programId: target.program?.id ?? null, monthlyMicros: amount, creditText: creditLine(credit), startsOn } },
      {
        onSuccess: () => {
          toast.show({ message: `Sent to ${cs}.` });
          navigate(`${b.base}/sponsorships`);
        }
      }
    );
  };

  return (
    <div className="bz-ns">
      <PageHead trail="Sponsorships / New" title="Sponsor a station or program" />
      <div className="bz-ns__grid">
        <div>
          <div className="bz-ns__sec">
            <h2>What to sponsor</h2>
            {targets.data?.near && <span className="bz-ns__sub">Near {targets.data.near}</span>}
          </div>
          <div className="bz-ns__picks">
            {targets.isLoading ? (
              <QuietRows />
            ) : targets.error ? (
              <ErrorLine>{errorText(targets.error)}</ErrorLine>
            ) : list.length === 0 ? (
              <p className="bz-ns__quiet">Nothing near you takes sponsors yet.</p>
            ) : (
              <PickRows
                label="What to sponsor"
                value={target ? keyOf(target) : null}
                onChange={(v) => {
                  setPicked(v);
                  setAmountText(null);
                }}
                options={list.map((t) => ({
                  value: keyOf(t),
                  colour: t.station.colour,
                  title: targetTitle(t),
                  line: roomLine(t),
                  end: money(t.minMonthlyMicros, { trimCents: true }),
                  endNote: "minimum a month",
                  disabled: !hasRoom(t)
                }))}
              />
            )}
          </div>

          <div className="bz-ns__sec bz-ns__sec--gap">
            <h2>
              <label htmlFor={ids.credit}>Your credit</label>
            </h2>
            <span className="bz-ns__sub">One line, read after your name</span>
          </div>
          <div className="bz-ns__credit">
            <CreditEditor id={ids.credit} value={credit} onChange={setText} marks={flags} describedBy={ids.rules} />
          </div>
          <div id={ids.rules} aria-live="polite">
            <CreditRules who={current?.who} flags={flags} onFix={fix} />
          </div>
          {check.error && <ErrorLine>{errorText(check.error)}</ErrorLine>}
        </div>

        <div>
          <div className="bz-ns__sec">
            <h2>As it will air</h2>
            {target && <span className="bz-ns__sub">{target.where}</span>}
          </div>
          {target && (
            <div className="bz-ns__slate">
              <CreditSlate
                colour={target.station.colour ?? "#0F1830"}
                lead={`${target.program ? target.program.title : cs} is made possible by`}
                name={profile.data?.name ?? b.business.name}
                line={preview}
                members={target.membersCredit}
                callSign={cs}
                channel={target.station.channel}
              />
            </div>
          )}

          <div className="bz-ns__sec bz-ns__sec--gap">
            <h2>Amount</h2>
          </div>
          <div className="bz-ns__row">
            <div>
              <label htmlFor={ids.amount}>
                <b>A month</b>
              </label>
              <small>{target ? `${cs}'s minimum is ${money(minimum, { trimCents: true })}` : null}</small>
            </div>
            <Field
              id={ids.amount}
              className="bz-ns__amount"
              mono
              inputMode="decimal"
              value={amountShown}
              onChange={(e) => setAmountText(e.target.value)}
              onBlur={() => amount !== null && setAmountText(money(amount))}
              aria-invalid={amount !== null && amount < minimum ? true : undefined}
            />
          </div>
          <div className="bz-ns__row">
            <div>
              <b>Starts</b>
              <small>If {cs || "the station"} approves by then</small>
            </div>
            <span>{dayText(startsOn)}</span>
          </div>
          <div className="bz-ns__row">
            <div>
              <b>Paid from</b>
              <small>Held on the 1st of each month from your balance, paid to {cs || "the station"} at the end</small>
            </div>
            <span className="bz-ns__m">{available === null ? "" : money(available)}</span>
          </div>
          <Button variant="primary" block className="bz-ns__send" disabled={!!reason || offer.isPending} aria-describedby={reason ? `${ids.amount}-why` : undefined} onClick={send}>
            {target ? `Send to ${cs}` : "Send"}
          </Button>
          {reason && (
            <p className="bz-ns__why" id={`${ids.amount}-why`}>
              {reason}
            </p>
          )}
          <ErrorLine>{offer.error ? errorText(offer.error) : null}</ErrorLine>
        </div>
      </div>
    </div>
  );
}
