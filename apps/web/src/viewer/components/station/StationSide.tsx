// The station page's side column: who runs it (About), what it carries from other stations, what
// it makes that others carry, and who makes it possible. The carriage count is the only measure of
// a station a viewer sees; the member count is the only other number. On the phone it sits under
// the schedule, what it carries first, with the carried slots shortened to "From REEL".

import type { ReactNode } from "react";
import { KeyValueList } from "@opencast/ui";
import type { StationPageFull } from "../../api/ext/station";
import { useLink } from "./actions";
import { carriedByText } from "./program";
import { monthYear } from "./when";
import "./Station.css";

export function SecTop({ title, sub, end, level = 3 }: { title: ReactNode; sub?: ReactNode; end?: ReactNode; level?: 2 | 3 }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className="vw-sec-top">
      <H>{title}</H>
      {sub != null && <span className="vw-sec-top__sub">{sub}</span>}
      {end != null && <span className="vw-sec-top__end">{end}</span>}
    </div>
  );
}

export function StationSide({ page, marketName, phone }: { page: StationPageFull; marketName: string | null; phone?: boolean }) {
  const link = useLink();
  const listed = page.station.kind === "listed";
  const facts = [
    marketName ? { label: "Market", value: marketName } : null,
    page.onDialSince ? { label: "On the dial since", value: monthYear(page.onDialSince) } : null,
    page.members ? { label: "Members", value: String(page.members) } : null
  ].filter((x): x is { label: string; value: string } => !!x);
  const carries = page.carries ?? [];
  const madeHere = page.madeHere ?? [];
  const credits = page.madePossibleBy ?? [];
  const about = (
    <section aria-labelledby="vw-about">
      <SecTop title={<span id="vw-about">About</span>} />
      {page.claimable && !page.claimable.claimed && <p className="vw-side__p vw-side__run">Run by Opencast for {page.claimable.runFor}</p>}
      {listed && <p className="vw-side__p">Listed from the city's stream</p>}
      {page.about && <p className="vw-side__p">{page.about}</p>}
      {facts.length > 0 && <KeyValueList className="vw-side__kv" items={facts} />}
    </section>
  );
  // On the phone the column sits under the schedule, and what it carries comes first (05.1).
  return (
    <>
      {!phone && about}
      {carries.length > 0 && (
        <section aria-labelledby="vw-carries">
          <SecTop title={<span id="vw-carries">Carries</span>} sub={phone ? undefined : "From other stations"} />
          <ul className="vw-lk-list">
            {carries.map((c, i) => (
              <li key={i} className="vw-lk">
                <span className="vw-lk__ch oc-mono">{c.from.channel}</span>
                <div>
                  {c.program.id ? (
                    <a className="vw-lk__title" {...link(`/program/${c.program.id}`)}>
                      {c.program.title}
                    </a>
                  ) : (
                    <b className="vw-lk__title">{c.program.title}</b>
                  )}
                  <small>{phone || !c.slot ? `From ${c.from.callSign ?? c.from.name}` : `From ${c.from.callSign ?? c.from.name}, ${c.slot}`}</small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {madeHere.length > 0 && (
        <section aria-labelledby="vw-made-here">
          <SecTop title={<span id="vw-made-here">Made here, carried elsewhere</span>} />
          <ul className="vw-lk-list">
            {madeHere.map((m) => (
              <li key={m.program.id} className="vw-lk">
                <span className="vw-lk__ch oc-mono">{page.station.channel}</span>
                <div>
                  <a className="vw-lk__title" {...link(`/program/${m.program.id}`)}>
                    {m.program.title}
                  </a>
                  <small>{carriedByText(m.carriers)}</small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {credits.length > 0 && (
        <section aria-labelledby="vw-possible">
          <SecTop title={<span id="vw-possible">Made possible by</span>} />
          <ul className="vw-und-list">
            {credits.map((c, i) => (
              <li key={i} className="vw-und">
                {c.text}
              </li>
            ))}
          </ul>
        </section>
      )}
      {phone && about}
    </>
  );
}
