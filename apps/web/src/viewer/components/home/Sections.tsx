// Home's blocks under the dial (01.1, 02.1): Carried widely, Coming up live, and the radio band.

import { accountsApi } from "@opencast/contracts";
import { Button, LiveText, TitleCard, clock } from "@opencast/ui";
import type { DialX, DialRowX } from "../../api/ext";
import { useApi } from "../../../api/hooks";
import { useAuth } from "../../../auth/AuthProvider";
import { useViewerActions } from "../../data/viewer";
import { useDevice } from "../../device/store";
import { carriedWhere, dayLabel, identText, stationsText, upStationLine } from "./logic";
import { StationRow } from "./MarketDial";
import { useAppLink } from "./nav";
import "./Sections.css";

type Carried = NonNullable<DialX["carriedWidely"]>[number];
type Up = NonNullable<DialX["comingUpLive"]>[number];

/** Programs other stations choose to air: maker, carrier count, where it's on here. */
export function CarriedWidely({ items, phone, timeZone }: { items: Carried[]; phone: boolean; timeZone: string }) {
  const link = useAppLink();
  if (items.length === 0) return null;
  return (
    <section className={phone ? "vw-sec vw-sec--phone" : "vw-sec"} aria-labelledby="vw-carried-h">
      <div className="vw-sec-h">
        <h3 id="vw-carried-h">Carried widely</h3>
        {!phone && <span className="vw-sec-h__sub">Programs other stations choose to air</span>}
      </div>
      <div className={phone ? "vw-carried vw-carried--strip" : "vw-carried"}>
        {items.map((c) => {
          const from = identText(c.maker);
          const where = carriedWhere(c.where, c.maker.id, timeZone);
          return (
            <a key={c.program.id} className="vw-carried__item" {...link(`/program/${c.program.id}`)}>
              <TitleCard colour={c.maker.colour ?? "#33507A"} title={c.program.title} bottom={`From ${from}`} size="lg" decorative />
              <b>{c.program.title}</b>
              <span className="vw-carried__from">
                From {from}, carried by {stationsText(c.carriers)}
              </span>
              {where && (
                <span className="vw-carried__where">
                  {where.live && <LiveText />}
                  {where.text}
                </span>
              )}
            </a>
          );
        })}
      </div>
    </section>
  );
}

/** Reminders already set, by airing: the account's, or this device's while signed out. */
function useRemindedIds(): Set<string> {
  const auth = useAuth();
  const device = useDevice();
  const list = useApi(accountsApi.listReminders, {}, { enabled: auth.signedIn });
  const ids = new Set<string>();
  if (auth.signedIn) for (const r of list.data ?? []) [r.airing.logEntryId, r.airing.listedAiringId].forEach((x) => x && ids.add(x));
  else for (const r of device.reminders) [r.logEntryId, r.listedAiringId].forEach((x) => x && ids.add(x));
  return ids;
}

/** Live programs coming up in the market, with Remind me (a toast with Undo; sign-in if needed). */
export function ComingUpLive({ items, phone, now, timeZone }: { items: Up[]; phone: boolean; now: Date; timeZone: string }) {
  const { remind } = useViewerActions();
  const reminded = useRemindedIds();
  if (items.length === 0) return null;
  return (
    <section className={phone ? "vw-sec vw-sec--phone" : "vw-sec vw-sec--flush"} aria-labelledby="vw-up-h">
      <div className="vw-sec-h">
        <h3 id="vw-up-h">Coming up live</h3>
      </div>
      <div className="vw-up">
        {items.map((u) => {
          const id = u.airing.listedAiringId ?? u.airing.logEntryId;
          const set = !!id && reminded.has(id);
          return (
            <div key={id ?? `${u.station.id}${u.airing.startsAt}`} className="vw-up__row">
              <span className="vw-up__when">
                {dayLabel(u.airing.startsAt, now, timeZone)}
                <br />
                {clock(u.airing.startsAt, { timeZone })}
              </span>
              <div className="vw-up__what">
                <b>{u.airing.title}</b>
                <small>{upStationLine(u.station, u.listed)}</small>
              </div>
              {set ? (
                <Button variant="ghost" size="sm" set icon="check" aria-disabled="true" aria-label={`Reminder set for ${u.airing.title}`}>
                  {phone ? "Set" : "Reminder set"}
                </Button>
              ) : (
                <Button variant="ghost" size="sm" icon={phone ? undefined : "bell"} aria-label={`Remind me: ${u.airing.title}, ${identText(u.station)}`} onClick={() => remind({ airing: u.airing, station: u.station })}>
                  {phone ? "Remind" : "Remind me"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Home's radio band block (web): the market's radio stations in frequency order. */
export function RadioBlock({ rows, now, timeZone }: { rows: DialRowX[]; now: Date; timeZone: string }) {
  if (rows.length === 0) return null;
  return (
    <section className="vw-sec vw-sec--flush" aria-labelledby="vw-radio-h">
      <div className="vw-sec-h">
        <h3 id="vw-radio-h">Radio band</h3>
        <span className="vw-sec-h__sub">{stationsText(rows.length)}</span>
      </div>
      <div className="vw-radio4" role="group" aria-label="Radio band">
        {rows.map((r) => (
          <StationRow key={r.station.id} row={r} variant="radio" at={now} timeZone={timeZone} />
        ))}
      </div>
    </section>
  );
}
