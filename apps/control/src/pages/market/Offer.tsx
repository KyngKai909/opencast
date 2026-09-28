// Market 02.1 a program, for stations (/market/offers/:offerId): the maker and its rights, the
// deals, where it fits the schedule, every episode with a preview, and where else it airs.
// Nested: B.2 Choose terms (/terms; the maker's own offer edits its terms there instead) and
// 03.1 previewing an episode (/preview/:episodeId).

import { useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import type { CarriageTerm } from "@opencast/contracts";
import { Button, clock, clockRange, duration, KeyValueList, Tag, TitleCard, ChoiceList } from "@opencast/ui";
import type { AgreementX, FitSlotX, OfferDetailX } from "../../api/ext/market";
import { useAgreements, useOffer } from "../../components/market/api";
import { gapPlan, useCarryIntoGap } from "../../components/market/carry";
import { ChooseTerms } from "../../components/market/ChooseTerms";
import { OfferForm } from "../../components/market/OfferForm";
import { MakerLine, ProgramCard, Quietly, SectionTop } from "../../components/market/parts";
import { PreviewEpisode } from "../../components/market/PreviewEpisode";
import { monthName } from "../../components/market/time";
import { airingsText, approvalText, carrierRows, dealLines, formatLine, lengthText, makerName, noticeText } from "../../components/market/words";
import { useShellOptions } from "../../layout/shell";
import { STATION_TZ } from "../../lib/clock";
import { useStation, type StationState } from "../../station/StationContext";
import { Quiet } from "../common";
import "./Offer.css";

export default function Offer() {
  const s = useStation();
  const { offerId = "", episodeId } = useParams();
  const loc = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const offer = useOffer(offerId, s.studio ? null : s.id);
  const agreements = useAgreements(s.id, !s.studio);
  const onTerms = loc.pathname.endsWith("/terms");
  useShellOptions({ context: "Syndication market" });

  if (offer.isLoading) return <Quiet />;
  if (offer.error || !offer.data) return <Quietly role="alert">{offer.error?.message ?? "That program isn't offered."}</Quietly>;
  const o = offer.data;
  const mine = o.maker.id === s.id;
  // The maker edits its terms at /terms (offering 02.1).
  if (onTerms && mine) return <OfferForm programId={o.program.id} offer={o} />;

  const carrying = agreements.data?.carrying.find((a) => a.offerId === o.id && !a.endsAt) ?? null;
  const back = `${s.base}/market/offers/${o.id}`;
  return (
    <>
      <ProgramPage offer={o} carrying={carrying} initialTerm={(params.get("term") as CarriageTerm | null) ?? null} />
      {onTerms && <ChooseTerms offer={o} initialTerm={(params.get("term") as CarriageTerm | null) ?? carrying?.term ?? null} onClose={() => navigate(back)} />}
      {episodeId && <PreviewEpisode offer={o} episodeId={episodeId} action={<MainAction offer={o} carrying={carrying} term={carrying?.term ?? o.defaultTerm ?? o.termsOffered[0]!} inModal />} onClose={() => navigate(back)} />}
    </>
  );
}

/** The dead-air slot the main button offers: an exact fit. */
function exactGap(o: OfferDetailX): FitSlotX | null {
  return o.fit?.find((f) => f.reason === "dead_air" && f.exact && f.startsAt) ?? null;
}

function ProgramPage({ offer: o, carrying, initialTerm }: { offer: OfferDetailX; carrying: AgreementX | null; initialTerm: CarriageTerm | null }) {
  const s = useStation();
  const mine = o.maker.id === s.id;
  const [term, setTerm] = useState<CarriageTerm>(initialTerm && o.termsOffered.includes(initialTerm) ? initialTerm : carrying?.term ?? o.defaultTerm ?? o.termsOffered[0]!);
  const deals = dealLines(o, "short");
  const fit = o.fit ?? [];
  const rows = carrierRows(o.carriedBy, s.station, (iso) => monthName(iso));
  const callSign = s.station.callSign ?? s.station.name;
  return (
    <div className="cc-mk-offer">
      <div className="cc-mk-offer__head">
        <ProgramCard offer={o} size="lg" bottom={o.makerKind === "catalog" ? "Opencast catalog" : makerName(o.maker)} className="cc-mk-offer__card" />
        <div className="cc-mk-offer__about">
          <span className="cc-mk-offer__from">
            <MakerLine offer={o} named swatch base={s.base} />
          </span>
          <h1 className="cc-mk-offer__h">
            {o.program.title}
            {mine && <Tag className="cc-mk-offer__yours">Yours</Tag>}
          </h1>
          {o.program.description && <p className="cc-mk-offer__p">{o.program.description}</p>}
          <div className="cc-mk-offer__meta">
            <span>{formatLine(o.program)}</span>
            {o.program.category && <span>{o.program.category}</span>}
            {o.makerKind !== "catalog" && <span>Made by {o.maker.callSign ?? o.maker.name}</span>}
            <span>
              Carried by {o.carriers} {o.carriers === 1 ? "station" : "stations"}
            </span>
          </div>
        </div>
        {fit.length > 0 && (
          <section className="cc-mk-fitbox" aria-labelledby="cc-mk-fitbox-h">
            <h2 id="cc-mk-fitbox-h" className="cc-mk-fitbox__h">
              {fit.some((f) => f.reason === "dead_air") ? `Fits ${callSign} tonight` : `Fits ${callSign}'s schedule`}
            </h2>
            {fit.map((f, i) => (
              <div key={i} className="cc-mk-fitbox__row">
                <div>
                  <b>{f.reason === "dead_air" && f.startsAt && f.endsAt ? clockRange(f.startsAt, f.endsAt, { timeZone: STATION_TZ }) : f.title}</b>
                  <small>{fitReason(f)}</small>
                </div>
                {f.exact ? <Tag variant="next">Exact fit</Tag> : <span />}
              </div>
            ))}
          </section>
        )}
      </div>

      <div className="cc-mk-offer__split">
        <div className="cc-mk-offer__main">
          <SectionTop first title="Episodes" sub="Preview any of them" />
          {o.episodes.length === 0 && <Quietly>No episodes yet.</Quietly>}
          <ul className="cc-mk-eps">
            {o.episodes.map((e) => (
              <li key={e.id} className="cc-mk-ep">
                <span className="cc-mk-ep__n">{e.episodeNumber ?? ""}</span>
                <TitleCard colour={o.program.colour ?? o.maker.colour ?? "#26345A"} title={e.episodeNumber != null ? `Ep. ${e.episodeNumber}` : o.program.title} decorative className="cc-mk-ep__tc" />
                <div className="cc-mk-ep__words">
                  <b>{e.title}</b>
                  {e.firstAiredAt && <small>{firstAired(e.firstAiredAt, e.firstAiredOn?.callSign ?? null, e === o.episodes[0])}</small>}
                </div>
                <span className="cc-mk-ep__d">{e.durationMs != null ? duration(e.durationMs) : ""}</span>
                <Button size="sm" icon="play" href={`${s.base}/market/offers/${o.id}/preview/${e.id}`} aria-label={`Preview ${e.title}`}>
                  Preview
                </Button>
              </li>
            ))}
          </ul>
          <SectionTop title="Also carried by" sub="Stations can see this; viewers see a count" />
          {rows.length === 0 && <Quietly>No station carries it yet.</Quietly>}
          <dl className="cc-mk-carried">
            {rows.map((r) => (
              <div key={r.key} className="cc-mk-carried__row">
                <dt>
                  <b>{r.title}</b>
                  {r.detail && <small>{r.detail}</small>}
                </dt>
                <dd>{r.you ? "You" : ""}</dd>
              </div>
            ))}
          </dl>
        </div>

        <aside className="cc-mk-offer__side" aria-label="Deals">
          <SectionTop first title="Deals" />
          <ChoiceList variant="term" label="Deal" value={term} onChange={setTerm} options={deals.map((d) => ({ value: d.term, title: d.title, helper: d.helper, end: d.price }))} />
          <KeyValueList
            className="cc-mk-offer__kv"
            items={[
              ...(o.program.rightsNote ? [{ label: "Rights", value: o.program.rightsNote }] : []),
              { label: "Airings per episode", value: airingsText(o) },
              ...(o.program.live ? [{ label: "Airs", value: o.liveOnly ? "Live only" : "Live or later" }] : []),
              { label: "Carriers", value: approvalText(o, s.id) },
              { label: "Ending it", value: noticeText(o.noticeDays) }
            ]}
          />
          <MainAction offer={o} carrying={carrying} term={term} />
        </aside>
      </div>
    </div>
  );
}

function fitReason(f: FitSlotX): string {
  if (f.reason === "dead_air") {
    const len = f.startsAt && f.endsAt ? Date.parse(f.endsAt) - Date.parse(f.startsAt) : 0;
    return `Dead air right now. ${lengthText(len)}`;
  }
  return f.reason === "library_repeats" ? "Library repeats" : "A weak slot, from your audience";
}

/** "First aired September 19 on HALL" for the latest, "First aired September 12" after it. */
function firstAired(iso: string, callSign: string | null, withStation: boolean): string {
  const d = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: STATION_TZ }).format(new Date(iso));
  return `First aired ${d}${withStation && callSign ? ` on ${callSign}` : ""}`;
}

/** What the station can do with it: carry it into tonight's gap, choose terms, choose a slot, or (its own) edit terms. */
function MainAction({ offer: o, carrying, term, inModal }: { offer: OfferDetailX; carrying: AgreementX | null; term: CarriageTerm; inModal?: boolean }) {
  const s: StationState = useStation();
  const navigate = useNavigate();
  const carryIntoGap = useCarryIntoGap();
  const block = !inModal;
  if (o.maker.id === s.id) {
    return (
      <div className="cc-mk-offer__acts">
        {s.can("programming") && (
          <Button variant="primary" block={block} href={`${s.base}/market/offers/${o.id}/terms`}>
            Edit terms
          </Button>
        )}
        <Button block={block} href={`${s.base}/market/offers/${o.id}/carriers`}>
          Carriers
        </Button>
      </div>
    );
  }
  if (s.studio || !s.can("programming")) return null;
  if (o.status === "withdrawn") return <p className="cc-mk-offer__note">No longer offered to new carriers.</p>;
  if (s.station.band === "radio" && !o.radioBandAllowed && !(o.program.format?.bands ?? []).includes("radio"))
    return <p className="cc-mk-offer__note">{o.maker.callSign ?? o.maker.name} doesn't offer it to radio band stations.</p>;
  const gap = exactGap(o);
  if (gap?.startsAt && (carrying || o.approval === "any_station")) {
    const t = carrying?.term ?? term;
    return (
      <Button variant="primary" block={block} onClick={() => carryIntoGap(o.program.title, gapPlan(o.id, s.id, t, gap.startsAt!, s.station.band === "radio"), gap.startsAt!)}>
        Carry it tonight at {clock(gap.startsAt, { timeZone: STATION_TZ })}
      </Button>
    );
  }
  if (carrying)
    return (
      <Button variant="primary" block={block} onClick={() => navigate(`${s.base}/log/place/${o.id}?term=${carrying.term}`)}>
        Choose a slot
      </Button>
    );
  return (
    <Button variant="primary" block={block} onClick={() => navigate(`${s.base}/market/offers/${o.id}/terms?term=${term}`)}>
      Choose terms
    </Button>
  );
}
