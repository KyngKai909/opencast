// B.3 Place it in the log (/log/place/:offerId?term=cash, the rail's Program log): the week, with
// the new slot outlined and what it replaces struck through; the six facts; a second airing the
// terms allow (never a fourth); Carry, confirmed with a toast and Undo instead of a modal.

import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { CARRIAGE_REQUEST_LABELS, catalogApi, logApi, type CarriageTerm, type LogEntry, type Slot } from "@opencast/contracts";
import { Button, clock, clockRange, ControlTitle, duration, KeyValueList, Toggle, useToast } from "@opencast/ui";
import { call } from "../../../api/client";
import { useApi } from "../../../api/hooks";
import type { OfferDetailX } from "../../api/ext/market";
import { useAgreements, useOffer, useRefreshMarket } from "../../components/market/api";
import { carry, useDelayedSend } from "../../components/market/carry";
import { Quietly } from "../../components/market/parts";
import { addDays, atLocal, dayName, localDate, localSlot, monthDay, shortDay, weekdayOf, whenWords } from "../../components/market/time";
import { stationWords, termDetail, termNames } from "../../components/market/words";
import { useShellOptions } from "../../layout/shell";
import { now, STATION_TZ } from "../../../lib/clock";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../common";
import "./PlaceInLog.css";
import { stationLabel } from "../../station/slug";

const HALF = 30 * 60_000;
const WORDS = ["Nothing", "One", "Two", "Three", "Four", "Five", "Six"];

/** "8:00" to minutes after midnight, and back. */
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** "Two reruns", "One program", "Nothing". */
export function replacesWords(entries: Pick<LogEntry, "localNote" | "title">[]): string {
  if (!entries.length) return "Nothing";
  const reruns = entries.every((e) => /repeat|rerun/i.test(e.localNote ?? ""));
  const n = entries.length;
  const count = WORDS[n] ?? String(n);
  return `${count} ${reruns ? (n === 1 ? "rerun" : "reruns") : n === 1 ? "program" : "programs"}`;
}

/** "Your break time": all of it under cash, what's left after the maker's share otherwise. */
function breakTime(o: OfferDetailX, term: CarriageTerm): string {
  const all = o.breakMsPerHour ?? 240_000;
  const maker = term === "barter" ? (o.barterMakerMsPerHour ?? 0) : term === "cash_plus_barter" ? (o.cashPlusBarter?.makerMsPerHour ?? 0) : 0;
  return maker ? `${duration(all - maker)} of ${duration(all)} an hour` : `All ${duration(all)} an hour`;
}

export default function PlaceInLog() {
  const s = useStation();
  const toast = useToast();
  const send = useDelayedSend();
  const refresh = useRefreshMarket();
  const { offerId = "" } = useParams();
  const [params] = useSearchParams();
  const offer = useOffer(offerId, s.id);
  const agreements = useAgreements(s.id, !s.studio);
  const today = localDate(now());
  const first = addDays(today, 1);
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
  const at = params.get("at");
  const [slot, setSlot] = useState<{ date: string; time: string }>(() => (at ? { date: localDate(at), time: localSlot(at).time } : { date: first, time: "20:00" }));
  const [second, setSecond] = useState(false);
  const [asked, setAsked] = useState(false);
  const [placed, setPlaced] = useState(false);
  const from = atLocal(first, "00:00").toISOString();
  const to = atLocal(addDays(first, 7), "06:00").toISOString();
  const log = useApi(logApi.getLog, { params: { stationId: s.id }, query: { from, to } }, { enabled: !s.studio, retry: false });
  useShellOptions({ context: "Program log" });

  const o = offer.data;
  const carrying = agreements.data?.carrying.find((a) => a.offerId === offerId && !a.endsAt) ?? null;
  const term = (carrying?.term ?? (params.get("term") as CarriageTerm | null) ?? o?.defaultTerm ?? o?.termsOffered[0] ?? "cash") as CarriageTerm;
  const lengthMs = o?.program.format?.episodeLengthMs ?? o?.episodes[0]?.durationMs ?? 60 * 60_000;
  const blocks = Math.max(1, Math.ceil(lengthMs / HALF));
  const start = atLocal(slot.date, slot.time);
  const end = new Date(start.getTime() + blocks * HALF);
  const secondDate = addDays(slot.date, 3);
  const secondTime = "22:00";
  const entries = log.data?.entries ?? [];
  const replaced = useMemo(() => entries.filter((e) => Date.parse(e.startsAt) < end.getTime() && Date.parse(e.endsAt) > start.getTime()), [entries, start.getTime(), end.getTime()]);

  if (offer.isLoading) return <Quiet />;
  if (offer.error || !o) return <Quietly role="alert">{offer.error?.message ?? "That program isn't offered."}</Quietly>;
  if (s.studio) return <Quietly>Studios don't broadcast, so there's no log to place it in.</Quietly>;
  if (!o.termsOffered.includes(term) && !carrying) return <Quietly role="alert">That deal isn't offered.</Quietly>;

  const maker = stationLabel(o.maker);
  const makerWords = o.makerKind === "catalog" ? "the Opencast catalog" : stationWords(o.maker);
  const detail = termDetail(o, term, s.id);
  const termsWords = `${termNames([term])}${detail ? `, ${detail}` : ""}`;
  const allowed = o.airingsPerEpisode;
  const offerSecond = !carrying && (allowed == null || allowed >= 2);
  const series = o.program.format?.kind !== "one_off";
  const needsApproval = !carrying && o.approval === "i_approve";

  // The grid's rows: half an hour before the slot to an hour after it.
  const firstRow = toMin(slot.time) - 30;
  const rows = Array.from({ length: blocks + 3 }, (_, i) => toTime(firstRow + i * 30));
  const inCell = (date: string, time: string) => {
    const a = atLocal(date, time).getTime();
    return entries.filter((e) => Date.parse(e.startsAt) >= a && Date.parse(e.startsAt) < a + HALF);
  };
  const newIndex = (date: string, time: string) => {
    if (date !== slot.date) return -1;
    const i = (toMin(time) - toMin(slot.time)) / 30;
    return i >= 0 && i < blocks ? i : -1;
  };

  const place = () => {
    if (!s.can("programming")) return;
    const main: Slot = { weekday: weekdayOf(slot.date), time: slot.time };
    const extra: Slot = { weekday: weekdayOf(secondDate), time: secondTime };
    const plan = { offerId: o.id, carrierStationId: s.id, term, slots: second && offerSecond ? [main, extra] : [main], repeatSlots: second && offerSecond ? [extra] : [], startsOn: slot.date, weeks: 4, replaceExisting: true, audioOnly: s.station.band === "radio" && !(o.program.format?.bands ?? []).includes("radio") };
    if (needsApproval) {
      // Asking goes now; Undo withdraws the request while the maker hasn't answered it (C4).
      carry(plan)
        .then((r) => {
          setAsked(true);
          refresh();
          toast.show({
            message: `${maker} has your request. ${o.program.title} goes in your log when they approve it.`,
            onUndo: () =>
              void call(catalogApi.withdrawRequest, { params: { requestId: r.id } })
                .then(() => {
                  setAsked(false);
                  refresh();
                })
                .catch((e: unknown) => toast.show({ message: e instanceof Error ? e.message : "Something went wrong. Try again." }))
          });
        })
        .catch((e: unknown) => toast.show({ message: e instanceof Error ? e.message : "Something went wrong. Try again." }));
      return;
    }
    const when = slot.date === first ? "tomorrow" : slot.date <= addDays(today, 6) ? dayName(weekdayOf(slot.date)) : monthDay(slot.date);
    setPlaced(true);
    send(
      `${o.program.title} is in your log from ${when} at ${clock(start, { timeZone: STATION_TZ })}`,
      async () => {
        await carry(plan);
        refresh();
      },
      (m) => {
        setPlaced(false);
        toast.show({ message: m });
      },
      () => setPlaced(false)
    );
  };

  return (
    <div className="cc-mk-place">
      <ControlTitle title={`Place ${o.program.title}`} description={`Choose when it airs on ${s.label}. ${termNames([term])} terms${detail ? `, ${detail}` : ""}.`} />
      <div className="cc-mk-place__split">
        <div className="cc-mk-week" role="table" aria-label={`The week from ${shortDay(first)}`}>
          <div role="row" className="cc-mk-week__row">
            <span role="columnheader" className="cc-mk-week__wh" aria-label="Time" />
            {days.map((d) => (
              <span key={d} role="columnheader" className={`cc-mk-week__wh${d === slot.date ? " cc-mk-week__wh--on" : ""}`}>
                {shortDay(d)}
              </span>
            ))}
          </div>
          {rows.map((t) => (
            <div key={t} role="row" className="cc-mk-week__row">
              <span role="rowheader" className="cc-mk-week__tm">
                {clock(atLocal(first, t), { timeZone: STATION_TZ, suffix: false })}
              </span>
              {days.map((d) => {
                const here = inCell(d, t);
                const ni = newIndex(d, t);
                const label = `${dayName(weekdayOf(d))} ${clock(atLocal(d, t), { timeZone: STATION_TZ })}${here.length ? `, ${here.map((e) => e.title).join(", ")}` : ""}`;
                return (
                  <span key={d} role="cell" className="cc-mk-week__cl">
                    <button type="button" className="cc-mk-week__pick" aria-label={`Air it ${label}`} aria-pressed={d === slot.date && t === slot.time} onClick={() => setSlot({ date: d, time: t })}>
                      {ni >= 0 ? (
                        <span className="cc-mk-week__it cc-mk-week__it--new">
                          {ni === 0 ? (
                            <>
                              <b>{o.program.title}</b>
                              <span className="cc-mk-week__q">Carried from {maker}</span>
                            </>
                          ) : (
                            <span className="cc-mk-week__q">{o.program.title}, continued</span>
                          )}
                          {here.map((e) => (
                            <span key={e.id} className="cc-mk-week__rep">
                              {e.title}
                              {/repeat|rerun/i.test(e.localNote ?? "") ? " rerun" : ""}
                            </span>
                          ))}
                        </span>
                      ) : (
                        here.map((e) => (
                          <span key={e.id} className={`cc-mk-week__it${e.kind === "live" ? " cc-mk-week__it--live" : ""}`}>
                            {e.title}
                            {e.carriedFrom ? `, from ${stationLabel(e.carriedFrom)}` : ""}
                          </span>
                        ))
                      )}
                    </button>
                  </span>
                );
              })}
            </div>
          ))}
          {log.error && (
            <p className="cc-mk-place__quiet" role="alert">
              {log.error.message}
            </p>
          )}
        </div>

        <aside className="cc-mk-place__pane" aria-labelledby="cc-mk-place-h">
          <h2 id="cc-mk-place-h" className="cc-mk-place__h4">
            {dayName(weekdayOf(slot.date))}s, {clockRange(start, end, { timeZone: STATION_TZ })}
          </h2>
          <KeyValueList
            className="cc-mk-place__kv"
            items={[
              { label: "Starts", value: whenWords(slot.date, today) },
              { label: "Repeats", value: series ? "Weekly" : "Once" },
              { label: "Episodes", value: series ? "Next unaired, in order" : "The one" },
              { label: "Replaces", value: replacesWords(replaced) },
              { label: "Terms", value: termsWords },
              { label: "Your break time", value: breakTime(o, term) }
            ]}
          />
          {offerSecond && series && (
            <div className="cc-mk-place__second">
              <div>
                <b id="cc-mk-place-second">
                  Also air it {dayName(weekdayOf(secondDate))} at {clock(atLocal(secondDate, secondTime), { timeZone: STATION_TZ })}
                </b>
                <small>{allowed == null ? `The second airing, within ${o.windowDays} days` : `The second of its ${allowed} allowed airings`}</small>
              </div>
              <Toggle checked={second} onChange={setSecond} aria-labelledby="cc-mk-place-second" />
            </div>
          )}
          <Button variant="primary" block onClick={place} disabled={!s.can("programming") || asked || placed || o.status !== "offered"}>
            {asked ? CARRIAGE_REQUEST_LABELS.asked.carrier : `Carry ${o.program.title}`}
          </Button>
          <p className="cc-mk-place__note">
            {needsApproval
              ? `${maker} approves each station. It goes in your log when they do, and appears in your listings as "Carried from ${makerWords}".`
              : `${maker} is told, and it appears in your listings as "Carried from ${makerWords}".`}
          </p>
        </aside>
      </div>
    </div>
  );
}
