// tv 03.2 the options for a later program ("/guide/options/:airingId", nested over the guide, so
// Back returns to the same cell): Remind me (on this TV and your phone), Switch me over at 9:00,
// Tune to BEAT now, About Inland Beat. Reminders need an account: signed out, Remind me and Switch
// me over hand off to signing in on the phone, and the reminder is set once it's done.

import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router";
import { accountsApi } from "@opencast/contracts";
import { usePlayer } from "@opencast/player";
import type { ApiError } from "../../api/client";
import { useApi, useApiMutation } from "../../api/hooks";
import { MARKET_TZ, useNow } from "../../lib/clock";
import { callSignLabel, stationAddress } from "../../lib/stationRef";
import { useCommandLayer } from "../../tv/commands";
import { focusKey, FocusContext, useTvFocusable } from "../../tv/focus";
import { useSignedIn } from "../../tv/data";
import { TvButton } from "../../components/guide/TvButton";
import {
  holdReminder,
  optionsWhen,
  reminderAction,
  reminderFor,
  reminderTarget,
  remindText,
  switchText,
  takeHeldReminder,
  tuneDetail,
  type ReminderAction
} from "../../components/guide/optionsLogic";
import type { GuideOutlet } from "./Guide";
import "./GuideOptions.css";

export default function GuideOptions() {
  const { airingId = "" } = useParams();
  const key = decodeURIComponent(airingId);
  const { model, find } = useOutletContext<GuideOutlet>();
  const navigate = useNavigate();
  const found = find(key);

  // An id the guide doesn't have (it moved on, or a stale address): back to the guide.
  useEffect(() => {
    if (model && (!found || !found.cell.airing)) navigate("/guide", { replace: true });
  }, [model, found, navigate]);

  if (!found?.cell.airing) return null;
  return <Options cellKey={key} found={found} />;
}

function Options({ cellKey, found }: { cellKey: string; found: NonNullable<ReturnType<GuideOutlet["find"]>> }) {
  const { cell, row } = found;
  const airing = cell.airing!;
  const station = row.station;
  const navigate = useNavigate();
  const [player, engine] = usePlayer();
  const now = useNow(30_000);
  const signedIn = useSignedIn();
  const [signIn, setSignIn] = useState<null | { switchMeOver: boolean }>(null);

  const reminders = useApi(accountsApi.listReminders, {}, { enabled: signedIn });
  const reminder = reminderFor(reminders.data, airing);
  const target = reminderTarget(airing);
  const inv = { invalidates: [accountsApi.listReminders] };
  const add = useApiMutation(accountsApi.addReminder, inv);
  const update = useApiMutation(accountsApi.updateReminder, inv);
  const remove = useApiMutation(accountsApi.removeReminder, inv);
  const busy = add.isPending || update.isPending || remove.isPending;
  const failed = (add.error ?? update.error ?? remove.error) as ApiError | null;

  const run = (a: ReminderAction) => {
    if (a.kind === "signIn") return setSignIn({ switchMeOver: false });
    if (a.kind === "add") {
      if (target) add.mutate({ body: { ...target, switchMeOver: a.switchMeOver } });
    } else if (a.kind === "update") update.mutate({ params: { reminderId: a.reminderId }, body: { switchMeOver: a.switchMeOver } });
    else remove.mutate({ params: { reminderId: a.reminderId } });
  };

  // Back from signing in on the phone: set the reminder that was asked for.
  useEffect(() => {
    if (!signedIn || !target) return;
    const held = takeHeldReminder(cellKey);
    if (held) add.mutate({ body: { ...target, switchMeOver: held.switchMeOver } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, cellKey]);

  const dialRow = player.channels.find((c) => c.station.id === station.id);
  // "RIVC 15.2" for a station sharing its call sign, so the family's streams are told apart.
  const call = callSignLabel(station);
  const remind = remindText(reminder);
  const sw = switchText(reminder, airing.startsAt, MARKET_TZ);

  // Back: the guide, on the same cell (TV mode's own close would go to "/guide/options").
  useCommandLayer((c) => {
    if (c.type !== "back") return false;
    if (signIn) setSignIn(null);
    else navigate("/guide", { replace: true });
    return true;
  });

  const box = useTvFocusable({ focusKey: "tvg-options", trackChildren: true, isFocusBoundary: true, focusable: true });
  // The primary is focused when the dialog opens, and again when the panel changes.
  useEffect(() => {
    const t = setTimeout(() => focusKey("tvg-primary"), 0);
    return () => clearTimeout(t);
  }, [signIn]);

  return (
    <FocusContext.Provider value={box.focusKey}>
      <div ref={box.ref} className="tvg-dlg" role="dialog" aria-modal="true" aria-labelledby="tvg-dlg-title">
        <div className="tvg-dlg__when oc-mono">{optionsWhen(airing.startsAt, station, now, MARKET_TZ)}</div>
        <h3 id="tvg-dlg-title" className="tvg-dlg__title">
          {airing.title}
        </h3>
        {signIn && <p className="tvg-dlg__line">Reminders are kept with your account. Sign in on your phone, and this one is set for you.</p>}
        {/* The first two buttons stay mounted when the sign-in panel swaps in, so focus never
            lands on a button that's gone (Norigin would move it to the dialog 300 ms later). */}
        <TvButton
          focusKey="tvg-primary"
          primary
          label={signIn ? "Sign in on your phone" : remind.label}
          detail={signIn ? null : remind.detail}
          busy={busy}
          onSelect={() => {
            if (signIn) {
              holdReminder(cellKey, signIn.switchMeOver);
              // Welcome's Back returns here (`from`); after signing in it should come back too (`then`).
              const here = `/guide/options/${encodeURIComponent(cellKey)}`;
              navigate("/welcome", { state: { from: here, then: here } });
            } else run(reminderAction("remind", reminder, signedIn));
          }}
        />
        <TvButton
          focusKey="tvg-second"
          label={signIn ? "Not now" : sw.label}
          detail={signIn ? null : sw.detail}
          busy={busy}
          onSelect={() => {
            if (signIn) return setSignIn(null);
            const a = reminderAction("switch", reminder, signedIn);
            if (a.kind === "signIn") setSignIn({ switchMeOver: true });
            else run(a);
          }}
        />
        {!signIn && (
          <>
            <TvButton
              focusKey="tvg-tune"
              label={`Tune to ${call} now`}
              detail={tuneDetail(dialRow?.now?.title, dialRow?.onAir, dialRow?.station.kind === "listed" ? dialRow.external?.source : null)}
              onSelect={() => {
                if (station.id !== player.currentId) void engine.tune(station.id, { input: "app" });
                navigate("/", { replace: true });
              }}
            />
            <TvButton
              focusKey="tvg-about"
              label={`About ${station.name}`}
              onSelect={() => navigate(`/about/${encodeURIComponent(stationAddress(station))}`, { state: { from: `/guide/options/${encodeURIComponent(cellKey)}` } })}
            />
            {failed && (
              <p className="tvg-dlg__error" role="alert">
                {failed.message}
              </p>
            )}
          </>
        )}
      </div>
    </FocusContext.Provider>
  );
}
