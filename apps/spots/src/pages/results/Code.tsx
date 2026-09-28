// biz-results 03.1 codes and customers (/results/codes/:code).
// From a scan on the couch to a customer who paid: people who scanned the QR, saved the offer, and
// used it when paying (only uses are customers); how the uses were counted (Clear Pay in person,
// marked in the app, an online checkout); the saved offer as customers see it, naming the station
// it was saved from; and the offer's settings. The funnel per code and the counters are P13 and
// P20. Owners and managers change the offer (?modal=offer, ?sheet=offer on the phone); connecting
// a checkout is the owner's, in Settings. Viewers see it all and change nothing.

import { useParams, useSearchParams } from "react-router";
import { spotsApi } from "@opencast/contracts";
import { Button, ControlTitle, Funnel, KeyValueList, useToast, type KeyValueRow } from "@opencast/ui";
import { BusinessX } from "../../api/ext";
import { useApi } from "../../api/hooks";
import { useBusiness } from "../../business/BusinessContext";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { useNow } from "../../lib/clock";
import { dayWords, marketDay, plural, rangeWords } from "../../components/results/format";
import { OfferCard } from "../../components/results/OfferCard";
import { OfferModal } from "../../components/results/OfferModal";
import { Section } from "../../components/results/Section";
import { selectionFrom, useResults } from "../../components/results/useResults";
import { Quiet } from "../common";
import "./Code.css";

const DAY = 86_400_000;

export default function Code() {
  const b = useBusiness();
  const phone = useIsPhone();
  const now = useNow(60_000);
  const toast = useToast();
  const { code: raw = "" } = useParams();
  const code = raw.toUpperCase();
  const [params, setParams] = useSearchParams();
  const sel = selectionFrom(params, now);
  const res = useResults(b.id, sel);
  const profile = useApi(spotsApi.getBusiness, { params: { businessId: b.id } }, { schema: BusinessX, staleTime: 60_000 });
  useShellOptions({ title: code });

  const overlay = phone ? "sheet" : "modal";
  const offerOpen = params.get(overlay) === "offer";
  const setOffer = (open: boolean) =>
    setParams((q) => {
      if (open) q.set(overlay, "offer");
      else q.delete(overlay);
      return q;
    });

  if (res.isLoading) return <Quiet />;
  if (!res.data)
    return (
      <div className="bz-code">
        <ControlTitle title={code} />
        <p className="bz-code__error" role="alert">
          {res.error?.message ?? "Something went wrong. Try again."}
        </p>
      </div>
    );
  const c = res.data.codes?.find((x) => x.code === code);
  if (!c)
    return (
      <div className="bz-code">
        <ControlTitle title={code} />
        <p className="bz-code__quiet">{res.data.codes ? `${code} isn't one of your codes.` : "Codes and customers aren't available yet."}</p>
        <Button size="sm" href={`${b.base}/results`}>
          Where it aired
        </Button>
      </div>
    );

  const range = res.data.from && res.data.to ? rangeWords(res.data.from, res.data.to) : null;
  const canChange = b.can("advertise");
  const canConnect = b.can("manage");
  const connect = (
    <Button size="sm" href={`${b.base}/settings/connections`}>
      Connect
    </Button>
  );
  const counted: KeyValueRow[] = [
    c.usesBy.clearPay !== null
      ? {
          title: (
            <>
              <span className="bz-clear">
                <i aria-hidden="true" />
                Clear Pay
              </span>
              , in person
            </>
          ),
          detail: "Applied when the customer paid. Counted automatically",
          value: c.usesBy.clearPay.toLocaleString("en-US")
        }
      : {
          title: (
            <>
              <span className="bz-clear">
                <i aria-hidden="true" />
                Clear Pay
              </span>
              , in person
            </>
          ),
          detail: "Connect Clear Pay to count codes used at the counter by themselves",
          ...(canConnect ? { actions: connect } : {})
        },
    { title: "Marked as used", detail: "In the app, by the owner or a manager", value: c.usesBy.marked.toLocaleString("en-US") },
    c.usesBy.online !== null
      ? { title: "Online checkout", detail: "Codes used at checkout online. Counted automatically", value: c.usesBy.online.toLocaleString("en-US") }
      : { title: "Online checkout", detail: "Connect Shopify, Stripe or Square to count codes used online", ...(canConnect ? { actions: connect } : {}) }
  ];

  const business = profile.data;
  const place = business?.locations.find((l) => l.kind === "location" && l.streetAddress) ?? business?.locations[0];
  const where = place ? [place.streetAddress, place.city].filter(Boolean).join(", ") : business?.website ?? null;
  const until = dayWords(marketDay(now.getTime() + c.savedForDays * DAY));
  const from = c.savedMostFrom ? `${c.savedMostFrom.callSign} ${c.savedMostFrom.channel}` : null;

  return (
    <div className="bz-code">
      <ControlTitle title={c.code} description={`${c.offer}, on ${c.spotTitle}.${range ? ` ${range}.` : ""}`} />
      <div className="bz-code__split">
        <div>
          <Funnel
            steps={[
              { title: "Scanned the QR", detail: "From a TV or phone, during or after a spot", count: c.scans },
              { title: "Saved the offer", detail: "Kept it on their phone for later", count: c.saves },
              { title: "Used it when paying", detail: `Within ${plural(c.windowDays, "day")} of an airing`, count: c.uses }
            ]}
          />
          <p className="bz-code__note">Not everyone who comes in because of a spot uses the code. These are the customers Opencast can count.</p>
          <Section title="How uses were counted">
            <KeyValueList variant="rows" className="bz-code__counted" items={counted} />
          </Section>
        </div>
        <div>
          <Section title="What customers see">
            <OfferCard savedFrom={from} offer={c.offer} business={b.business.name} where={where} until={until} code={c.code} />
          </Section>
          <Section title="Settings">
            <KeyValueList
              variant="rows"
              items={[
                {
                  title: "Offer",
                  detail: c.oncePerCustomer ? `${c.offer}, once per customer` : c.offer,
                  ...(canChange
                    ? {
                        actions: (
                          <Button size="sm" onClick={() => setOffer(true)}>
                            Change
                          </Button>
                        )
                      }
                    : {})
                },
                { title: "Counts as a customer if used within", value: plural(c.windowDays, "day") }
              ]}
            />
          </Section>
        </div>
      </div>
      {canChange && offerOpen && (
        <OfferModal
          open
          phone={phone}
          onClose={() => setOffer(false)}
          onSaved={() => {
            setOffer(false);
            toast.show({ message: `Offer changed for ${c.code}.` });
          }}
          spotId={c.spotId}
          code={c.code}
          offer={c.offer}
          windowDays={c.windowDays}
        />
      )}
    </div>
  );
}
