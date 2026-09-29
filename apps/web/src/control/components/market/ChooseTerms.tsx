// B.2 Choose terms: the maker's band, the deals in a sentence each with the price on the right
// ($0.00 shown), then the three lines that are the whole agreement. On the phone, a sheet.

import { useState } from "react";
import { useNavigate } from "react-router";
import type { CarriageTerm } from "@opencast/contracts";
import { Button, ChoiceList, duration, KeyValueList, Modal, Sheet, StationBand } from "@opencast/ui";
import type { OfferDetailX } from "../../api/ext/market";
import { useIsPhone } from "../../layout/shell";
import { useStation } from "../../station/StationContext";
import { airingsText, dealLines, formatLine, makerName, noticeText, stationWords } from "./words";
import "./ChooseTerms.css";

export function ChooseTerms({ offer: o, initialTerm, onClose }: { offer: OfferDetailX; initialTerm: CarriageTerm | null; onClose: () => void }) {
  const s = useStation();
  const phone = useIsPhone();
  const navigate = useNavigate();
  const [term, setTerm] = useState<CarriageTerm>(initialTerm && o.termsOffered.includes(initialTerm) ? initialTerm : o.defaultTerm ?? o.termsOffered[0]!);
  const band =
    o.maker.channel && o.maker.callSign ? (
      <StationBand channel={o.maker.channel} callSign={o.maker.callSign} colour={o.maker.colour ?? "#26345A"} name={o.program.title} place={formatLine(o.program)} />
    ) : undefined;
  const firstEpisode = o.episodes.find((e) => e.previewUrl) ?? o.episodes[0];
  const footer = (
    <>
      <Button variant="primary" disabled={!s.can("programming") || o.status !== "offered"} onClick={() => navigate(`${s.base}/log/place/${o.id}?term=${term}`)}>
        Choose a slot
      </Button>
      {firstEpisode && <Button onClick={() => navigate(`${s.base}/market/offers/${o.id}/preview/${firstEpisode.id}`)}>Preview an episode</Button>}
    </>
  );
  const body = (
    <div className="cc-mk-terms">
      <p className="cc-mk-terms__lede">Each hour has {duration(o.breakMsPerHour ?? 240_000)} of breaks. How they're shared depends on the terms.</p>
      <ChoiceList variant="term" label="Terms" value={term} onChange={setTerm} options={dealLines(o, "long").map((d) => ({ value: d.term, title: d.title, helper: d.helper, end: d.price }))} />
      <KeyValueList
        className="cc-mk-terms__kv"
        items={[
          { label: "Airings per episode", value: airingsText(o) },
          { label: "What viewers see", value: `Carried from ${o.makerKind === "catalog" ? "the Opencast catalog" : stationWords(o.maker)}` },
          { label: "Ending it", value: noticeText(o.noticeDays, true) }
        ]}
      />
    </div>
  );
  const head = band ? { stationBand: band, label: `${o.program.title}, from ${makerName(o.maker)}` } : { title: o.program.title, eyebrow: `From ${makerName(o.maker)}` };
  return phone ? (
    <Sheet open onClose={onClose} {...head} footer={footer}>
      {body}
    </Sheet>
  ) : (
    <Modal open onClose={onClose} width={540} {...head} footer={footer}>
      {body}
    </Modal>
  );
}
