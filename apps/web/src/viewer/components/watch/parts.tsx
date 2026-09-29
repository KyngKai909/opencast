// The pieces the tuned-in page shows on the web and the phone: what's on (title, time, where it's
// carried from), the three things a viewer can do for a station, tonight's schedule, and the
// member line next to Pledge.

import { useSearchParams } from "react-router";
import { Button, LiveText, Notice, ScheduleList, Tag, clock, clockRange, cx } from "@opencast/ui";
import { MARKET_TZ, useNow } from "../../../lib/clock";
import type { AiringX, StationPageX } from "../../api/ext";
import { useViewerActions } from "../../data/viewer";
import { useOverlayParams } from "./overlay";
import { PresetButton } from "./usePresetButton";
import { carriedText, scheduleLine } from "./lines";
import { callSignOf, identText, tonightRows } from "./logic";
import type { WatchData } from "./useWatch";

/** The title and its line: "8:30 – 9:00 pm  Carried from REEL 24.1" (the link opens the carried-from modal). */
export function NowTitle({ w, size = "web" }: { w: WatchData; size?: "web" | "phone" }) {
  const { open } = useOverlayParams();
  const row = w.row;
  const now = w.now;
  if (!row) return null;
  if (!now) {
    // When it's back: the stream's sign-off or the dial's off air (G9), else its next airing.
    const back = w.backAt ?? (row.next ?? w.page.data?.upNext.find((x) => x.kind !== "off_air") ?? null)?.startsAt ?? null;
    return (
      <>
        <h2 className={cx("vw-w-title", size === "phone" && "vw-w-title--phone")}>Off air</h2>
        {back && (
          <div className="vw-w-meta">
            <span>
              {identText(row.station)} signs on again at <span className="oc-mono">{clock(back, { timeZone: MARKET_TZ })}</span>.
            </span>
          </div>
        )}
      </>
    );
  }
  const carried = carriedText(now);
  return (
    <>
      <h2 className={cx("vw-w-title", size === "phone" && "vw-w-title--phone")}>{now.title}</h2>
      <div className="vw-w-meta">
        <span className="oc-mono">{clockRange(now.startsAt, now.endsAt, { separator: "–", timeZone: MARKET_TZ })}</span>
        {carried && now.programId ? (
          <button type="button" className="vw-w-link" onClick={() => open({ modal: "carried", program: now.programId! })}>
            {carried}
          </button>
        ) : carried ? (
          <span>{carried}</span>
        ) : now.live ? (
          <LiveText />
        ) : null}
        {now.kind === "listed" && <Tag variant="listed">Listed</Tag>}
      </div>
    </>
  );
}

/** Save it, pledge, share. */
export function Actions({ w, className }: { w: WatchData; className?: string }) {
  const { open } = useOverlayParams();
  const st = w.row?.station;
  if (!st) return null;
  const cs = callSignOf(st);
  const share = () => open({ modal: "share", station: cs, ...(w.now?.logEntryId ? { airing: w.now.logEntryId } : {}) }, ["airing"]);
  return (
    <div className={cx("vw-w-acts", st.kind === "listed" && "vw-w-acts--two", className)}>
      <PresetButton station={st} size="sm" />
      {/* A listed city stream isn't run on Opencast: there's no one to pledge to here. */}
      {st.kind !== "listed" && (
        <Button variant="ghost" size="sm" onClick={() => open({ modal: "pledge", station: cs })}>
          Pledge
        </Button>
      )}
      <Button variant="ghost" size="sm" icon="share" onClick={share}>
        Share
      </Button>
    </div>
  );
}

/** "On BEAT tonight": the tally edge on the program on air. */
export function Tonight({ w, before }: { w: WatchData; before: number }) {
  const now = useNow(30_000);
  const st = w.row?.station;
  if (!st) return null;
  const heading = `On ${st.callSign ?? st.name} tonight`;
  if (w.page.isLoading)
    return (
      <div className="vw-w-sched" aria-busy="true">
        <h4 className="oc-schedule__h">{heading}</h4>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="vw-quiet-row" />
        ))}
      </div>
    );
  if (w.page.isError) return <p className="vw-w-error">{w.page.error.message}</p>;
  const schedule = w.page.data?.schedule ?? [w.page.data?.now, ...(w.page.data?.upNext ?? [])].filter((a): a is AiringX => !!a);
  const rows = tonightRows(schedule, now, { before, timeZone: MARKET_TZ });
  if (!rows.length) return null;
  return (
    <ScheduleList
      className="vw-w-sched"
      heading={heading}
      now={now}
      timeZone={MARKET_TZ}
      items={rows.map((a) => ({ id: a.logEntryId ?? a.listedAiringId ?? a.startsAt, start: a.startsAt, end: a.endsAt, title: a.title, subtitle: scheduleLine(a) }))}
    />
  );
}

/** "Inland Beat is supported by 214 members and by local underwriters. Pledge": only next to Pledge, hidden at 0. */
export function MembersLine({ w, className }: { w: WatchData; className?: string }) {
  const { open } = useOverlayParams();
  const page: StationPageX | undefined = w.page.data;
  const n = page?.members ?? 0;
  if (!page || n <= 0) return null;
  return (
    <p className={cx("vw-w-members", className)}>
      {page.station.name} is supported by {n.toLocaleString("en-US")} {n === 1 ? "member" : "members"} and by local underwriters.{" "}
      <Button variant="text" onClick={() => open({ modal: "pledge", station: callSignOf(page.station) })}>
        Pledge
      </Button>
    </p>
  );
}

/**
 * A shared link to an airing (`?airing=`): the link tunes in if it's on, and offers a reminder if
 * it isn't yet (home 07.1).
 */
export function SharedAiring({ w }: { w: WatchData }) {
  const [params, setParams] = useSearchParams();
  const { remind } = useViewerActions();
  const now = useNow(30_000);
  const id = params.get("airing");
  const st = w.row?.station;
  const all = w.page.data?.schedule ?? [];
  if (!id || !st || params.get("modal")) return null;
  const a = all.find((x) => x.logEntryId === id || x.listedAiringId === id);
  if (!a || (Date.parse(a.startsAt) <= now.getTime() && now.getTime() < Date.parse(a.endsAt))) return null;
  const dismiss = () =>
    setParams(
      (p) => {
        p.delete("airing");
        return p;
      },
      { replace: true }
    );
  if (Date.parse(a.endsAt) <= now.getTime())
    return (
      <Notice tone="plain" className="vw-w-shared" title={`${a.title} has ended.`} action={<Button variant="ghost" size="sm" onClick={dismiss}>OK</Button>}>
        {` ${identText(st)} is on now.`}
      </Notice>
    );
  return (
    <Notice
      tone="plain"
      icon="bell"
      className="vw-w-shared"
      title={a.title}
      action={
        <Button variant="ghost" size="sm" onClick={() => (remind({ airing: a, station: st }), dismiss())}>
          Remind me
        </Button>
      }
    >
      {` starts at ${clock(a.startsAt, { timeZone: MARKET_TZ })} on ${identText(st)}.`}
    </Notice>
  );
}
