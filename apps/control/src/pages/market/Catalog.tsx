// Market 05.1 the Opencast catalog (/market/catalog): Opencast's own restored public-domain
// programming, free to every station with one underwriting credit an hour. Rights are checked once,
// so each program lists its source. Licensed catalogs come later (open question 13): shown, not offered.

import { useSearchParams } from "react-router";
import { Segmented, TitleCard } from "@opencast/ui";
import { useBrowse } from "../../components/market/api";
import { bandsOf } from "../../components/market/browse";
import { ProgramCard, Quietly } from "../../components/market/parts";
import { formatLine } from "../../components/market/words";
import { useShellOptions } from "../../layout/shell";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../common";
import "./Catalog.css";

type Band = "all" | "tv" | "radio";

export default function Catalog() {
  const s = useStation();
  const [params, setParams] = useSearchParams();
  const band = (["tv", "radio"].includes(params.get("band") ?? "") ? params.get("band") : "all") as Band;
  const offers = useBrowse({ forStation: s.studio ? undefined : s.id, makerKind: "catalog" });
  useShellOptions({ context: "Opencast catalog" });
  if (offers.isLoading) return <Quiet />;
  if (offers.error) return <Quietly role="alert">{offers.error.message}</Quietly>;
  const all = offers.data ?? [];
  const shown = all.filter((o) => band === "all" || bandsOf(o).includes(band));
  const underwriter = all.find((o) => o.underwriter)?.underwriter ?? null;
  const setBand = (b: Band) =>
    setParams(
      (p) => {
        if (b === "all") p.delete("band");
        else p.set("band", b);
        return p;
      },
      { replace: true }
    );
  return (
    <div className="cc-mk-cat">
      <div className="cc-mk-cat__band">
        <div>
          <h1 className="cc-mk-cat__h">Opencast catalog</h1>
          <p className="cc-mk-cat__p">Programming Opencast restores, packages and offers to every station at no cost. Rights are checked by Opencast, item by item.</p>
        </div>
        {underwriter && (
          <div className="cc-mk-cat__by">
            Made possible by<b>{underwriter}</b>
          </div>
        )}
      </div>
      <div className="cc-mk-cat__bar">
        <span>
          {all.length} series, 1 coming
        </span>
        <Segmented
          label="Band"
          value={band}
          onChange={setBand}
          options={[
            { value: "all", label: "All" },
            { value: "tv", label: "TV band" },
            { value: "radio", label: "Radio band" }
          ]}
        />
      </div>
      <ul className="cc-mk-cat__grid">
        {shown.map((o) => {
          const bands = bandsOf(o);
          const bandWords = bands.length === 1 ? (bands[0] === "radio" ? "Radio band" : "TV band") : "TV and radio band";
          return (
            <li key={o.id} className="cc-mk-cat__item">
              <a href={`${s.base}/market/offers/${o.id}`} className="cc-mk-cat__link">
                <ProgramCard offer={o} size="lg" bottom="Opencast catalog" className="cc-mk-cat__tc" />
                <b>{o.program.title}</b>
              </a>
              <small>
                {formatLine(o.program, { band: false })}. {bandWords}, {o.carriers} {o.carriers === 1 ? "station" : "stations"}
              </small>
              {o.program.rightsNote && <div className="cc-mk-cat__src">{o.program.rightsNote}</div>}
            </li>
          );
        })}
        {band === "all" && (
          <li className="cc-mk-cat__item cc-mk-cat__item--later" aria-label="Licensed catalogs, coming later">
            <TitleCard colour={all[0]?.maker.colour ?? "#26345A"} title="Licensed catalogs" bottom="Opencast catalog" size="lg" decorative className="cc-mk-cat__tc" />
            <b>Licensed catalogs</b>
            <small>Coming later. Not yet offered</small>
            <div className="cc-mk-cat__src">Revenue share with rights holders</div>
          </li>
        )}
      </ul>
      {!shown.length && <Quietly>Nothing on this band yet.</Quietly>}
    </div>
  );
}
