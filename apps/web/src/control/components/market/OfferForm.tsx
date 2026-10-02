// Offering 02.1 Offer a program: tick the deals you'll accept, each with its price, then the
// limits; the pane on the right is what carrying stations will see. Also editing an offer's terms
// (they apply to new carriers only). Desk work: the phone lists offers but doesn't set terms.

import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { type CarriageTerm, catalogApi, type Offer } from "@opencast/contracts";
import { Button, ControlTitle, duration, Field, Icon, KeyValueList, money, Notice, Segmented, useToast } from "@opencast/ui";
import { call } from "../../../api/client";
import type { OfferDetailX } from "../../api/ext/market";
import type { TermsBody } from "../../api/types";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../../pages/common";
import { useLibrary, useRefreshMarket } from "./api";
import { ProgramCard, Quietly, SectionTop } from "./parts";
import { airingsText, approvalText, formatFromLibrary, formatLine, noticeText, readDuration, readMoney, termDetail } from "./words";
import "./OfferForm.css";

const BREAKS_PER_HOUR = 4 * 60_000;

interface Draft {
  barter: boolean;
  barterFill: string;
  cash: boolean;
  cashPrice: string;
  cpb: boolean;
  cpbFill: string;
  cpbPrice: string;
  airings: "1" | "2" | "3" | "any";
  liveOnly: boolean;
  approval: "any_station" | "i_approve";
}

function draftOf(o: OfferDetailX | null): Draft {
  if (!o)
    return { barter: true, barterFill: "2:00", cash: true, cashPrice: "$3.00", cpb: false, cpbFill: "1:00", cpbPrice: "$1.50", airings: "3", liveOnly: false, approval: "i_approve" };
  return {
    barter: o.termsOffered.includes("barter"),
    barterFill: duration(o.barterMakerMsPerHour ?? 2 * 60_000),
    cash: o.termsOffered.includes("cash"),
    cashPrice: money(o.cashPriceMicros ?? 3_000_000),
    cpb: o.termsOffered.includes("cash_plus_barter"),
    cpbFill: duration(o.cashPlusBarter?.makerMsPerHour ?? 60_000),
    cpbPrice: money(o.cashPlusBarter?.priceMicros ?? 1_500_000),
    airings: o.airingsPerEpisode == null ? "any" : (String(o.airingsPerEpisode) as Draft["airings"]),
    liveOnly: o.liveOnly,
    approval: o.approval
  };
}

/** The body from the draft, or what's wrong with it. */
export function termsFromDraft(d: Draft, breakMsPerHour = BREAKS_PER_HOUR): { body: TermsBody } | { errors: Partial<Record<"deals" | "barterFill" | "cashPrice" | "cpbFill" | "cpbPrice", string>> } {
  const errors: Partial<Record<"deals" | "barterFill" | "cashPrice" | "cpbFill" | "cpbPrice", string>> = {};
  const fill = readDuration(d.barterFill);
  const price = readMoney(d.cashPrice);
  const cpbFill = readDuration(d.cpbFill);
  const cpbPrice = readMoney(d.cpbPrice);
  const most = duration(breakMsPerHour);
  if (!d.barter && !d.cash && !d.cpb) errors.deals = "Choose at least one deal.";
  if (d.barter && (fill == null || fill <= 0 || fill > breakMsPerHour)) errors.barterFill = `Up to ${most}, like 2:00.`;
  if (d.cash && (price == null || price <= 0)) errors.cashPrice = "Set a price per airing, like $3.00.";
  if (d.cpb && (cpbFill == null || cpbFill <= 0 || cpbFill > breakMsPerHour)) errors.cpbFill = `Up to ${most}, like 1:00.`;
  if (d.cpb && (cpbPrice == null || cpbPrice <= 0)) errors.cpbPrice = "Set a price per airing, like $1.50.";
  if (Object.keys(errors).length) return { errors };
  const terms: CarriageTerm[] = [...(d.barter ? ["barter" as const] : []), ...(d.cash ? ["cash" as const] : []), ...(d.cpb ? ["cash_plus_barter" as const] : [])];
  return {
    body: {
      termsOffered: terms,
      cashPriceMicros: d.cash ? price : null,
      cashPriceUnit: d.cash ? "per_airing" : null,
      barterMakerMsPerHour: d.barter ? fill : null,
      airingsPerEpisode: d.airings === "any" ? null : Number(d.airings),
      windowDays: 7,
      liveOnly: d.liveOnly,
      noticeDays: 7,
      approval: d.approval,
      radioBandAllowed: true,
      cashPlusBarter: d.cpb ? { priceMicros: cpbPrice!, unit: "per_airing", makerMsPerHour: cpbFill! } : null
    }
  };
}

/** A deal to tick, with its price fields under it (.chk). */
function DealCheck({ checked, onChange, title, helper, end, children }: { checked: boolean; onChange: (v: boolean) => void; title: string; helper: string; end?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`cc-mk-chk${checked ? " cc-mk-chk--on" : ""}`}>
      <label className="cc-mk-chk__box">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={undefined} />
        <span className="cc-mk-chk__bx" aria-hidden="true">
          {checked && <Icon name="check" size={13} />}
        </span>
        <span className="oc-sr-only">{title}</span>
      </label>
      <div>
        <b aria-hidden="true">{title}</b>
        <small>{helper}</small>
        {checked && children}
      </div>
      <span className="cc-mk-chk__end">{end}</span>
    </div>
  );
}

export function OfferForm({ programId, offer }: { programId: string; offer: OfferDetailX | null }) {
  const s = useStation();
  const phone = useIsPhone();
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshMarket();
  const library = useLibrary(s.id, !offer);
  const [d, setD] = useState<Draft>(() => draftOf(offer));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useShellOptions({ context: "Syndication market" });

  const program = useMemo(() => {
    if (offer) return { id: offer.program.id, title: offer.program.title, live: offer.program.live, episodeCount: offer.program.episodeCount, format: offer.program.format, colour: offer.program.colour ?? s.station.colour };
    const p = library.data?.programs.find((x) => x.id === programId);
    if (!p) return null;
    const items = library.data!.items.filter((i) => i.programId === p.id);
    return { id: p.id, title: p.title, live: p.live, episodeCount: p.episodeCount, format: formatFromLibrary(p, items.map((i) => i.durationMs)), colour: p.station.colour, linked: items.some((i) => i.source === "link") };
  }, [offer, library.data, programId, s.station.colour]);

  if (!offer && library.isLoading) return <Quiet />;
  if (!program) return <Quietly role="alert">{library.error?.message ?? "That program wasn't found."}</Quietly>;
  const name = s.label;
  const editing = !!offer && offer.status === "offered";
  if (phone)
    return (
      <div className="cc-mk-offer-form cc-mk-offer-form--phone">
        <h1 className="cc-mk-offer-form__h">{editing ? `${program.title} terms` : `Offer ${program.title}`}</h1>
        <Quietly>Setting terms is desk work. Open master control on a laptop to offer it.</Quietly>
        <Button href={`${s.base}/market/offered`}>Back to Offered by {name}</Button>
      </div>
    );

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const result = termsFromDraft(d);
  const errors = tried && "errors" in result ? result.errors : {};
  const description = `${formatLine(program, { long: true, band: false })}. Each hour has ${duration(BREAKS_PER_HOUR)} of breaks.`;
  // What carrying stations see: the offer as the market will show it.
  const preview: Offer = {
    id: offer?.id ?? program.id,
    program: { id: program.id, title: program.title, description: null, category: null, live: program.live, episodeCount: program.episodeCount, rightsNote: null, format: program.format, colour: program.colour },
    maker: s.station,
    makerKind: s.studio ? "studio" : "station",
    status: "offered",
    carriers: 0,
    fitsYourSchedule: null,
    previews: 0,
    ...("body" in result ? result.body : { termsOffered: ["barter"], cashPriceMicros: null, cashPriceUnit: null, barterMakerMsPerHour: null, airingsPerEpisode: 3, windowDays: 7, liveOnly: false, noticeDays: 7, approval: "i_approve", radioBandAllowed: true }),
    cashPlusBarter: "body" in result ? result.body.cashPlusBarter : null
  } as Offer;
  const viewer = null;
  const dealRows = "body" in result ? result.body.termsOffered.map((t) => ({ label: t === "cash_plus_barter" ? "Cash plus barter" : t === "cash" ? "Cash" : "Barter", value: termDetail({ ...preview, maker: s.station }, t, viewer) ?? "" })) : [];
  const linked = "linked" in program && program.linked;

  const submit = async () => {
    setTried(true);
    if (!("body" in result) || busy || !s.can("programming")) return;
    setBusy(true);
    setFailure(null);
    try {
      if (offer) await call(catalogApi.updateOffer, { params: { offerId: offer.id }, body: { ...result.body, status: "offered" } });
      else await call(catalogApi.offerProgram, { params: { programId: program.id }, body: result.body });
      refresh();
      toast.show({ message: editing ? "New terms saved. They apply to new carriers." : `${program.title} is offered. Stations can find it in the market.` });
      navigate(`${s.base}/market/offered`);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cc-mk-offer-form">
      <ControlTitle title={editing ? `${program.title} terms` : `Offer ${program.title}`} description={description} />
      {linked && <Notice className="cc-mk-offer-form__notice" title={`${program.title} can't be offered.`}>An episode was imported from a link. Link imports stay local.</Notice>}
      {failure && <Notice className="cc-mk-offer-form__notice" title={failure} />}
      <div className="cc-mk-offer-form__split">
        <div>
          <SectionTop first title="Deals you'll accept" sub="A carrying station picks one" />
          <div role="group" aria-label="Deals you'll accept">
            <DealCheck checked={d.barter} onChange={(v) => set("barter", v)} title="Barter" helper="No fee. You fill part of each hour's breaks with your own rotation, on their station." end={d.barter ? money(0) : null}>
              <div className="cc-mk-chk__inset">
                <span>You fill</span>
                <Field aria-label={`Barter: you fill, of each hour's ${duration(BREAKS_PER_HOUR)}`} mono size="sm" value={d.barterFill} onChange={(e) => set("barterFill", e.target.value)} className="cc-mk-chk__field" error={errors.barterFill} />
                <span>of each hour's {duration(BREAKS_PER_HOUR)}</span>
              </div>
            </DealCheck>
            <DealCheck checked={d.cash} onChange={(v) => set("cash", v)} title="Cash" helper="They pay per airing and sell all the break time.">
              <div className="cc-mk-chk__inset">
                <span>Per airing</span>
                <Field aria-label="Cash: per airing" mono size="sm" value={d.cashPrice} onChange={(e) => set("cashPrice", e.target.value)} className="cc-mk-chk__field cc-mk-chk__field--money" error={errors.cashPrice} />
              </div>
            </DealCheck>
            <DealCheck checked={d.cpb} onChange={(v) => set("cpb", v)} title="Cash plus barter" helper="A lower fee, and you fill some of the break time">
              <div className="cc-mk-chk__inset">
                <span>You fill</span>
                <Field aria-label="Cash plus barter: you fill" mono size="sm" value={d.cpbFill} onChange={(e) => set("cpbFill", e.target.value)} className="cc-mk-chk__field" error={errors.cpbFill} />
                <span>per hour, and</span>
                <Field aria-label="Cash plus barter: per airing" mono size="sm" value={d.cpbPrice} onChange={(e) => set("cpbPrice", e.target.value)} className="cc-mk-chk__field cc-mk-chk__field--money" error={errors.cpbPrice} />
                <span>per airing</span>
              </div>
            </DealCheck>
            {errors.deals && (
              <p className="cc-mk-offer-form__error" role="alert">
                {errors.deals}
              </p>
            )}
          </div>

          <SectionTop title="Limits" />
          <div className="cc-mk-limit">
            <div>
              <b>Airings per episode</b>
              <small>Within 7 days of its first airing on {name}</small>
            </div>
            <Segmented label="Airings per episode" value={d.airings} onChange={(v) => set("airings", v)} options={[{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }, { value: "any", label: "Any" }]} />
          </div>
          {program.live && (
            <div className="cc-mk-limit">
              <div>
                <b>When it can air</b>
                <small>Live means at the same time as {name}</small>
              </div>
              <Segmented label="When it can air" value={d.liveOnly ? "live" : "later"} onChange={(v) => set("liveOnly", v === "live")} options={[{ value: "live", label: "Live only" }, { value: "later", label: "Live or later" }]} />
            </div>
          )}
          <div className="cc-mk-limit">
            <div>
              <b>Who can carry it</b>
            </div>
            <Segmented label="Who can carry it" value={d.approval} onChange={(v) => set("approval", v)} options={[{ value: "any_station", label: "Any station" }, { value: "i_approve", label: "I approve each" }]} />
          </div>
          <div className="cc-mk-limit">
            <div>
              <b>Notice to end</b>
              <small>Either side, before the last airing</small>
            </div>
            <span className="cc-mk-limit__val">7 days</span>
          </div>
        </div>

        <aside className="cc-mk-offer-form__pane" aria-labelledby="cc-mk-offer-preview-h">
          <h2 id="cc-mk-offer-preview-h" className="cc-mk-offer-form__h4">
            How stations will see it
          </h2>
          <div className="cc-mk-offer-form__card">
            <ProgramCard offer={preview} className="cc-mk-offer-form__tc" />
            <div>
              <b>{program.title}</b>
              <small>From {s.station.callSign ? `${s.station.callSign} ${s.station.channel ?? ""}`.trim() : s.station.name}</small>
              <small>{formatLine(program)}</small>
            </div>
          </div>
          <KeyValueList
            className="cc-mk-offer-form__kv"
            items={[
              ...dealRows,
              { label: "Airings per episode", value: airingsText({ airingsPerEpisode: d.airings === "any" ? null : Number(d.airings), windowDays: 7 }) },
              ...(program.live ? [{ label: "Airs", value: d.liveOnly ? "Live only" : "Live or later" }] : []),
              { label: "Carriers", value: approvalText({ approval: d.approval, maker: s.station }, null) },
              { label: "Ending it", value: noticeText(7) }
            ]}
          />
          <p className="cc-mk-offer-form__note">Your share of break time is filled from {name}'s rotation, within the carrying station's hourly cap and blocked categories.</p>
          {editing && <p className="cc-mk-offer-form__note">Changes apply to new carriers. Stations carrying it keep their terms.</p>}
          <Button variant="primary" block className="cc-mk-offer-form__go" onClick={submit} disabled={busy || linked || !s.can("programming")}>
            {editing ? "Save terms" : `Offer ${program.title}`}
          </Button>
        </aside>
      </div>
    </div>
  );
}
