// Settings, Notifications (biz-settings 04.1): what this person hears about this business, grouped
// by where it comes from. Spots about to pause shows a lock, not a toggle: it can't be turned off.
// Everyone sets their own, viewers included (they start with only the weekly summary).

import { useState } from "react";
import { notificationsApi, spotsApi, type NoticeKind, type NotificationPrefs } from "@opencast/contracts";
import { Toggle, ToggleLock } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { keyFor, useApi, useApiMutation } from "../../api/hooks";
import type { BusinessState } from "../../business/BusinessContext";
import { Quiet } from "../../pages/common";
import { warnLine } from "./format";
import "./common.css";
import "./NotifyConnections.css";

interface Pref {
  key: NoticeKind;
  title: string;
  detail?: string;
}

export function notificationGroups(warnDays: number[]): { title: string; rows: Pref[] }[] {
  return [
    {
      title: "Money",
      rows: [
        { key: "low_balance", title: "Spots about to pause", detail: `${warnLine(warnDays)}. Always on` },
        { key: "spot_paused", title: "A spot paused, budget spent" }
      ]
    },
    {
      title: "Stations",
      rows: [
        { key: "spot_added", title: "A station added your spot" },
        { key: "sponsorship_answered", title: "Sponsorship answered" },
        { key: "order_update", title: "Production order updates", detail: "Quotes and deliveries" }
      ]
    },
    {
      title: "Results",
      rows: [
        { key: "weekly_summary", title: "Weekly summary", detail: "Monday morning" },
        { key: "code_used", title: "Every code used" }
      ]
    }
  ];
}

export function NotificationsSection({ b }: { b: BusinessState }) {
  const query = { scope: "business", scopeId: b.id };
  const prefs = useApi(notificationsApi.getPrefs, { query });
  const biz = useApi(spotsApi.getBusiness, { params: { businessId: b.id } });
  const qc = useQueryClient();
  const set = useApiMutation(notificationsApi.setPrefs, { invalidates: [notificationsApi.getPrefs] });
  const [error, setError] = useState<string | null>(null);

  if (prefs.isLoading) return <Quiet />;
  if (!prefs.data) return <p className="bz-error" role="alert">{(prefs.error as Error | null)?.message ?? "Something went wrong. Try again."}</p>;
  const { alwaysOn } = prefs.data;
  const current = prefs.data.prefs;

  const toggle = (key: string, on: boolean) => {
    setError(null);
    const next: NotificationPrefs = { ...current, [key]: { push: on, email: on } };
    qc.setQueryData([...keyFor(notificationsApi.getPrefs, { query }), 0], { ...prefs.data, prefs: next });
    set.mutate(
      { body: { scope: "business", scopeId: b.id, prefs: { [key]: next[key]! } } },
      {
        onError: (e) => {
          setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
          void prefs.refetch();
        }
      }
    );
  };

  return (
    <div className="bz-notif">
      {notificationGroups(biz.data?.warnDays ?? [3, 1]).map((g) => (
        <section key={g.title} aria-labelledby={`bz-notif-${g.title}`}>
          <div className="bz-sec-top">
            <h4 className="bz-sec-top__h" id={`bz-notif-${g.title}`}>
              {g.title}
            </h4>
          </div>
          {g.rows.map((r) => {
            const locked = (alwaysOn as string[]).includes(r.key);
            const on = locked || !!(current[r.key]?.push || current[r.key]?.email);
            return (
              <div key={r.key} className="bz-row bz-notif__row">
                <div>
                  <b id={`bz-pref-${r.key}`}>{r.title}</b>
                  {r.detail && <small>{r.detail}</small>}
                </div>
                {locked ? <ToggleLock label={`${r.title}: always on`} /> : <Toggle checked={on} aria-labelledby={`bz-pref-${r.key}`} onChange={(v) => toggle(r.key, v)} />}
              </div>
            );
          })}
        </section>
      ))}
      {error && (
        <p className="bz-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
