// Offering your programs (follow-up Phase 1, 2026-09-29): how each of the maker's programs did
// across every station that aired it in the last 30 days, added up. Totals only: never a station's
// audience or one airing's. Other stations' airings count together once there are enough of them
// ("3 airings not counted yet" until then), and a program under the minimum audience says "Not
// enough viewers yet". Stations and studios alike, for owners and operators.

import { audienceApi, type MakerProgramWatch } from "@opencast/contracts";
import { Sparkbars } from "@opencast/ui";
import { ApiError } from "../../../api/client";
import { useApi } from "../../../api/hooks";
import { useNow } from "../../../lib/clock";
import { plural } from "../earnings/lines";
import { SectionTop } from "../market/parts";
import { mostLeftText, notCountedText, notForMeText, timeLabelWord, watchTimeText } from "./words";
import "./watch.css";

const DAY = 86_400_000;

/** The window: the last 30 days to the hour, so the query holds still between hours. */
export function lastThirtyDays(t: Date): { from: string; to: string } {
  const to = Math.floor(t.getTime() / 3_600_000) * 3_600_000;
  return { from: new Date(to - 30 * DAY).toISOString(), to: new Date(to).toISOString() };
}

/** "34 airings on 2 stations", on the radio band "Radio band, 27 airings on 1 station". */
export function makerRowDetail(p: Pick<MakerProgramWatch, "band" | "status" | "airings" | "stations">): string {
  const band = p.band === "radio" ? "Radio band" : null;
  const counted = p.status === "shown" ? `${plural(p.airings, "airing")} on ${plural(p.stations, "station")}` : null;
  return [band, counted].filter(Boolean).join(", ");
}

function Stat({ value, caption }: { value: string; caption: string }) {
  return (
    <div className="cc-pwatch__stat">
      <span className="cc-pwatch__v">{value}</span>
      <small>{caption}</small>
    </div>
  );
}

function Row({ p }: { p: MakerProgramWatch }) {
  const detail = makerRowDetail(p);
  const left = notCountedText(p.notCounted.airings);
  const t = p.totals;
  return (
    <li className="cc-pwatch__row">
      <div className="cc-pwatch__prog">
        <b>{p.title}</b>
        {detail && <small>{detail}</small>}
        {left && <small className="cc-pwatch__left">{left}</small>}
      </div>
      {p.status === "shown" && t ? (
        <>
          <Stat value={watchTimeText(t.watchMinutes)} caption={timeLabelWord(p.timeLabel)} />
          <Stat value={t.combinedPeak.toLocaleString("en-US")} caption="Peaks, added up" />
          <Stat value={t.stayedToTheEnd === null ? "–" : `${t.stayedToTheEnd}%`} caption="Stayed to the end" />
          <Sparkbars
            className="cc-pwatch__line"
            values={t.tuneAways}
            caption={
              <>
                {mostLeftText(t.tuneAways)}
                {notForMeText(t.notForMe) && <span className="cc-watch__votes">{notForMeText(t.notForMe)}</span>}
              </>
            }
          />
        </>
      ) : (
        <span className="cc-pwatch__none">{p.note ?? "Not enough viewers yet"}</span>
      )}
    </li>
  );
}

export function ProgramWatch({ stationId }: { stationId: string }) {
  const t = useNow(60_000);
  const win = lastThirtyDays(t);
  const q = useApi(audienceApi.programWatchData, { params: { stationId }, query: win }, { placeholderData: (prev) => prev });
  // An API without the endpoint yet: leave the section out.
  if (q.error instanceof ApiError && q.error.code === "not_available") return null;
  return (
    <section className="cc-pwatch" aria-labelledby="cc-pwatch-h">
      <SectionTop title={<span id="cc-pwatch-h">Across every station</span>} sub="The last 30 days" />
      <p className="cc-pwatch__lead">Every station that aired your programs, added up. Other stations' airings are counted together once there are enough of them, so no station's own audience shows.</p>
      {q.isLoading ? (
        <p className="cc-pwatch__quiet" aria-busy="true">
          Loading…
        </p>
      ) : q.error ? (
        <p className="cc-pwatch__quiet" role="alert">
          {q.error.message}
        </p>
      ) : !q.data?.programs.length ? (
        <p className="cc-pwatch__quiet">None of your programs aired in the last 30 days.</p>
      ) : (
        <ul className="cc-pwatch__list" aria-label="Your programs across every station">
          {q.data.programs.map((p) => (
            <Row key={`${p.programId}-${p.band}`} p={p} />
          ))}
        </ul>
      )}
    </section>
  );
}
