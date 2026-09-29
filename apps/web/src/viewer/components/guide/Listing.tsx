// A program's listing, opened from a guide cell (`?listing=<airing>`): beside the cell on the web
// (a popover, not a centred modal, so you keep your place in the grid), a bottom sheet on the
// phone. Title, time, station, what it is, "Switch me over", and Remind me or Tune in.

import { useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { accountsApi, libraryApi } from "@opencast/contracts";
import { Button, Modal, Sheet, Toggle, clock, clockRange } from "@opencast/ui";
import { call } from "../../../api/client";
import { keyFor, useApi } from "../../../api/hooks";
import type { AiringX, StationIdentX } from "../../api/ext";
import { useAuth } from "../../../auth/AuthProvider";
import { useViewerActions } from "../../data/viewer";
import { setDevice, useDevice } from "../../device/store";
import { useIsPhone } from "../../layout/shell";
import { MARKET_TZ, useNow } from "../../../lib/clock";
import { useTune } from "../../player/PlayerRoot";
import { useQueryClient } from "@tanstack/react-query";
import { useApiAs } from "../watch/overlay";
import { withLive } from "../watch/lines";
import { callSignOf, identText, listingText, stationSlug } from "../watch/logic";
import { listingActions } from "./logic";

const POP_WIDTH = 360;

/** Whether a reminder is for this airing. */
function sameAiring(a: Pick<AiringX, "logEntryId" | "listedAiringId">) {
  return (x: { logEntryId?: string | null; listedAiringId?: string | null }) => (!!a.logEntryId && x.logEntryId === a.logEntryId) || (!!a.listedAiringId && x.listedAiringId === a.listedAiringId);
}

/** The reminder already set for this airing, on the account or on this device. */
function useExistingReminder(a: AiringX) {
  const auth = useAuth();
  const device = useDevice();
  const list = useApi(accountsApi.listReminders, {}, { enabled: auth.signedIn });
  const same = sameAiring(a);
  if (auth.signedIn) {
    const r = list.data?.find((x) => same(x.airing));
    return r ? { id: r.id, switchMeOver: r.switchMeOver, onDevice: false } : null;
  }
  const d = device.reminders.find(same);
  return d ? { id: null, switchMeOver: d.switchMeOver, onDevice: true } : null;
}

function useListingContent({ airing: a, station, onDone }: { airing: AiringX; station: StationIdentX; onDone: () => void }) {
  const now = useNow(30_000);
  const acts = listingActions(a, now);
  const program = useApiAs("watch", libraryApi.getProgram, { params: { programId: a.programId ?? "" } }, libraryApi.getProgram.response, !!a.programId);
  const existing = useExistingReminder(a);
  const [switchOver, setSwitchOver] = useState(false);
  const { remind } = useViewerActions();
  const tune = useTune();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const cs = callSignOf(station);
  // G5: the airing's own description (else its episode's), then the program's.
  const text = listingText(a.note, a.episodeDescription ?? program.data?.description);
  const at = clock(a.startsAt, { timeZone: MARKET_TZ, suffix: false });
  const switchValue = existing ? existing.switchMeOver : switchOver;

  const refresh = () => qc.invalidateQueries({ queryKey: keyFor(accountsApi.listReminders).slice(0, 2) });
  const setSwitch = async (on: boolean) => {
    if (!existing) return setSwitchOver(on);
    if (existing.onDevice) return setDevice((d) => ({ reminders: d.reminders.map((r) => (sameAiring(a)(r) ? { ...r, switchMeOver: on } : r)) }));
    await call(accountsApi.updateReminder, { params: { reminderId: existing.id! }, body: { switchMeOver: on } });
    void refresh();
  };
  const removeReminder = async () => {
    if (!existing) return;
    if (existing.onDevice) return setDevice((d) => ({ reminders: d.reminders.filter((r) => !sameAiring(a)(r)) }));
    await call(accountsApi.removeReminder, { params: { reminderId: existing.id! } });
    void refresh();
  };
  const tuneIn = () => {
    void tune(station.id);
    onDone();
    navigate(`/watch/${stationSlug(station)}`);
  };

  const remindButton = existing ? (
    <Button key="remind" variant="ghost" set icon="check" onClick={removeReminder} aria-label={`Reminder set for ${a.title}. Remove it`}>
      Reminder set
    </Button>
  ) : (
    <Button key="remind" variant={acts.primary === "remind" ? "primary" : "ghost"} icon="bell" onClick={() => remind({ airing: a, station }, switchOver)}>
      Remind me
    </Button>
  );
  const tuneButton = (
    <Button key="tune" variant={acts.primary === "tune" ? "primary" : "ghost"} onClick={tuneIn}>
      Tune in to {cs}
    </Button>
  );

  return {
    eyebrow: (
      <>
        <span className="oc-mono">{clockRange(a.startsAt, a.endsAt, { separator: "–", timeZone: MARKET_TZ })}</span>, {identText(station)}
      </>
    ),
    title: a.title,
    subtitle: text || a.live ? withLive(text, a.live) : undefined,
    body: acts.switchMeOver ? (
      <div className="vw-gl-switch">
        <div>
          <b id={`sw-${a.startsAt}`}>Switch me over at {at}</b>
          <small>If I'm watching something else on Opencast</small>
        </div>
        <Toggle checked={switchValue} onChange={(v) => void setSwitch(v)} aria-labelledby={`sw-${a.startsAt}`} />
      </div>
    ) : null,
    footer: acts.remind ? [remindButton, tuneButton] : [tuneButton]
  };
}

export function GuideListing({ airing, station, onClose }: { airing: AiringX; station: StationIdentX; onClose: () => void }) {
  const phone = useIsPhone();
  const content = useListingContent({ airing, station, onDone: onClose });
  const wrap = useRef<HTMLDivElement>(null);

  // Beside the selected cell: to its right where there's room, else to its left.
  useLayoutEffect(() => {
    if (phone) return;
    const place = () => {
      const el = wrap.current;
      const cell = document.querySelector<HTMLElement>('.vw-guide .oc-guide__p[aria-pressed="true"]');
      const panel = el?.querySelector<HTMLElement>(".oc-modal");
      if (!el || !cell || !panel) return;
      const r = cell.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let x = Math.min(r.right + 12, vw - POP_WIDTH - 16);
      if (x < r.left + 80) x = r.left - POP_WIDTH - 12 >= 16 ? r.left - POP_WIDTH - 12 : Math.max(16, vw - POP_WIDTH - 16);
      const h = panel.offsetHeight;
      const y = Math.max(76, Math.min(r.top - 76, vh - h - 16));
      el.style.setProperty("--vw-pop-x", `${Math.round(x)}px`);
      el.style.setProperty("--vw-pop-y", `${Math.round(y)}px`);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [phone, airing.startsAt, station.id]);

  if (phone)
    return (
      <Sheet open onClose={onClose} eyebrow={content.eyebrow} title={content.title} subtitle={content.subtitle} footer={<>{content.footer}</>}>
        {content.body}
      </Sheet>
    );
  return (
    <div ref={wrap} className="vw-gl-anchor">
      <Modal open onClose={onClose} width={POP_WIDTH} className="vw-gl-pop" eyebrow={content.eyebrow} title={content.title} subtitle={content.subtitle} footer={<>{content.footer}</>}>
        {content.body}
      </Modal>
    </div>
  );
}
