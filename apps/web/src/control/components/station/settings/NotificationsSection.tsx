// Settings, Notifications (station-settings 05.1): what this person hears about this station.
// Per person, per station. Dead air coming shows a lock, not a toggle: it can't be turned off.

import { notificationsApi, type NotificationPrefs } from "@opencast/contracts";
import { Toggle, ToggleLock } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApi, useApiMutation, keyFor } from "../../../../api/hooks";
import { ApiError } from "../../../../api/client";
import { SIGNED_ON_OFF } from "../../../api/ext/station";
import type { StationState } from "../../../station/StationContext";
import { Quiet } from "../../../pages/common";
import "./common.css";
import "./NotificationsSection.css";

interface Pref {
  key: string;
  title: string;
  detail?: string;
  /** Hosts hear only about their own blocks (station-settings 05 note). */
  forHosts?: boolean;
}

export const NOTIFICATION_GROUPS: { title: string; rows: Pref[] }[] = [
  {
    title: "On air",
    rows: [
      { key: "dead_air_warning", title: "Dead air coming", detail: "30 and 12 minutes before a gap. Always on", forHosts: true },
      { key: "signal_lost", title: "Signal lost", detail: "A live source drops for more than a minute", forHosts: true },
      { key: SIGNED_ON_OFF, title: "Signed on, signed off", detail: "When anyone on the team does it" }
    ]
  },
  {
    title: "Spots and money",
    rows: [
      { key: "spot_paused", title: "A spot paused", detail: "With how much open time it leaves" },
      { key: "weekly_summary", title: "Weekly earnings", detail: "Monday morning" }
    ]
  },
  {
    title: "Carriage",
    rows: [
      { key: "carriage_request", title: "A station wants to carry you" },
      { key: "carried_program_changed", title: "A program you carry changes", detail: "Terms, schedule or an ending notice" }
    ]
  }
];

/** The groups a role sees: a host only the rows for their own blocks; a studio, which doesn't broadcast, nothing about going out. */
export function groupsFor(role: StationState["role"], studio = false) {
  return NOTIFICATION_GROUPS.filter((g) => !studio || g.title !== "On air")
    .map((g) => ({ ...g, rows: g.rows.filter((r) => role !== "host" || r.forHosts) }))
    .filter((g) => g.rows.length);
}

export function NotificationsSection({ s }: { s: StationState }) {
  const query = { scope: "station", scopeId: s.id };
  const prefs = useApi(notificationsApi.getPrefs, { query });
  const qc = useQueryClient();
  const set = useApiMutation(notificationsApi.setPrefs, { invalidates: [notificationsApi.getPrefs] });
  const [error, setError] = useState<string | null>(null);

  if (prefs.isLoading) return <Quiet />;
  if (!prefs.data) return <p className="cc-error" role="alert">{(prefs.error as Error | null)?.message ?? "Something went wrong. Try again."}</p>;
  const { alwaysOn } = prefs.data;
  const current = prefs.data.prefs;

  const toggle = (key: string, on: boolean) => {
    setError(null);
    const next: NotificationPrefs = { ...current, [key]: { push: on, email: current[key]?.email ?? false } };
    qc.setQueryData([...keyFor(notificationsApi.getPrefs, { query }), 0], { ...prefs.data, prefs: next });
    set.mutate(
      { body: { scope: "station", scopeId: s.id, prefs: { [key]: next[key]! } } },
      {
        onError: (e) => {
          setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
          void prefs.refetch();
        }
      }
    );
  };

  return (
    <div className="cc-notif">
      {groupsFor(s.role, s.studio).map((g) => (
        <section key={g.title} aria-labelledby={`cc-notif-${g.title}`}>
          <h4 className="cc-notif__h" id={`cc-notif-${g.title}`}>
            {g.title}
          </h4>
          {g.rows.map((r) => {
            const locked = (alwaysOn as string[]).includes(r.key);
            const on = locked || !!current[r.key]?.push;
            return (
              <div key={r.key} className="cc-row cc-notif__row">
                <div>
                  <b id={`cc-pref-${r.key}`}>{r.title}</b>
                  {r.detail && <small>{r.detail}</small>}
                </div>
                {locked ? <ToggleLock label={`${r.title}: always on`} /> : <Toggle checked={on} aria-labelledby={`cc-pref-${r.key}`} onChange={(v) => toggle(r.key, v)} />}
              </div>
            );
          })}
        </section>
      ))}
      {error && (
        <p className="cc-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
