// Small pieces every market page shares: the section heading over a rule (.sec-top), the maker
// line with its swatch (.from) and kind tag (.kind), the amber fit tag (.fit-tag), the market tabs.

import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { Tabs, Tag, TitleCard, type TitleCardSize } from "@opencast/ui";
import type { OfferX } from "../../api/ext/market";
import { useStation } from "../../station/StationContext";
import { makerKindWord, makerName } from "./words";
import "./parts.css";

export function SectionTop({ title, sub, end, first, as: H = "h2" }: { title: ReactNode; sub?: ReactNode; end?: ReactNode; first?: boolean; as?: "h2" | "h3" }) {
  return (
    <div className={`cc-mk-sectop${first ? " cc-mk-sectop--first" : ""}`}>
      <H className="cc-mk-sectop__h">{title}</H>
      {sub != null && <span className="cc-mk-sectop__sub">{sub}</span>}
      {end != null && <span className="cc-mk-sectop__end">{end}</span>}
    </div>
  );
}

/** "From HALL 90.7" with the maker's kind after it. A catalog maker links to the catalog. */
export function MakerLine({ offer, named, swatch, kind = true, base }: { offer: OfferX; named?: boolean; swatch?: boolean; kind?: boolean; base?: string }) {
  const words = `From ${makerName(offer.maker)}${named && offer.makerKind === "station" ? `, ${offer.maker.name}` : ""}`;
  return (
    <span className="cc-mk-from">
      {swatch && <span className="cc-mk-from__sw" style={{ background: offer.maker.colour ?? undefined }} aria-hidden="true" />}
      {offer.makerKind === "catalog" && base ? <a href={`${base}/market/catalog`}>{words}</a> : words}
      {kind && <span className="cc-mk-kind">{makerKindWord(offer.makerKind)}</span>}
    </span>
  );
}

export function FitTag({ children }: { children: ReactNode }) {
  return (
    <Tag variant="next" className="cc-mk-fit-tag">
      {children}
    </Tag>
  );
}

/** The program's title card, in its colour (the maker's, or its catalog shelf's). */
export function ProgramCard({ offer, title, bottom, size, className }: { offer: Pick<OfferX, "program" | "maker">; title?: ReactNode; bottom?: ReactNode; size?: TitleCardSize; className?: string }) {
  return <TitleCard colour={offer.program.colour ?? offer.maker.colour ?? "#26345A"} title={title ?? offer.program.title} bottom={bottom} size={size} decorative className={className} />;
}

export type MarketTab = "browse" | "offered" | "carried";

/** Browse / Offered by BEAT / Carried by BEAT. A studio doesn't carry, so it has no third tab. */
export function MarketTabs({ value, waiting }: { value: MarketTab; waiting?: number }) {
  const s = useStation();
  const navigate = useNavigate();
  const name = s.station.callSign ?? s.station.name;
  const items = [
    { value: "browse" as const, label: "Browse" },
    { value: "offered" as const, label: `Offered by ${name}`, count: waiting || undefined, countLabel: waiting ? `${waiting} waiting` : undefined },
    ...(s.studio ? [] : [{ value: "carried" as const, label: `Carried by ${name}` }])
  ];
  const to: Record<MarketTab, string> = { browse: `${s.base}/market`, offered: `${s.base}/market/offered`, carried: `${s.base}/market/carried` };
  return <Tabs items={items} value={value} onChange={(v) => navigate(to[v])} label="Syndication market" className="cc-mk-tabs" />;
}

/** A quiet line for an empty list or a failed read. */
export function Quietly({ children, role }: { children: ReactNode; role?: "alert" | "status" }) {
  return (
    <p className="cc-mk-quiet" role={role}>
      {children}
    </p>
  );
}
