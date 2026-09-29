// Settings, Breaks (station-settings 02.1): when breaks come and how long they run, what fills
// every break in order (the station ID fixed last), the hourly cap against broadcast TV, the same
// spot's limit, categories BEAT never airs, the backup rotation, and "Ads from partners" (a
// backfill for time still open: only a flag until the backend supports it). Owners and operators change it.

import { useState, type DragEvent, type KeyboardEvent } from "react";
import { spotsApi, stationsApi, type BreakRule } from "@opencast/contracts";
import { Button, ChipRow, LogCode, Segmented, Toggle } from "@opencast/ui";
import { duration } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useApi, useApiMutation, keyFor } from "../../../../api/hooks";
import { ApiError } from "../../../../api/client";
import { SPOT_CATEGORIES } from "../../../api/ext/station";
import type { StationState } from "../../../station/StationContext";
import { Quiet } from "../../../pages/common";
import { capCells, capMinutes, ladderWithPartners, moveFill, placeFill, ruleLabel, TV_MINUTES_PER_HOUR, type FillCode } from "../breakRule";
import { noMoreThan, perHour } from "../format";
import { ValueSelect } from "../ValueSelect";
import "./common.css";
import "./BreaksSection.css";

type Mode = BreakRule["mode"];

const LENGTHS = [60, 90, 120, 150, 180, 240].map((s) => ({ value: s * 1000, label: duration(s * 1000) }));
const CAPS = Array.from({ length: 16 }, (_, i) => (i + 1) * 30_000).map((v) => ({ value: v, label: duration(v) }));
const SAME_SPOT = [1, 2, 3, 4].map((n) => ({ value: n, label: perHour(n) }));

export function BreaksSection({ s }: { s: StationState }) {
  const cs = s.station.callSign ?? s.station.name;
  const params = { stationId: s.id };
  const rule = useApi(stationsApi.getBreakRule, { params });
  const rotations = useApi(spotsApi.getRotations, { params }, { retry: false });
  const qc = useQueryClient();
  const set = useApiMutation(stationsApi.setBreakRule, { invalidates: [stationsApi.getBreakRule, spotsApi.getAvails] });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<FillCode | null>(null);
  const [said, setSaid] = useState("");
  const canEdit = s.can("programming");

  if (rule.isLoading) return <Quiet />;
  if (!rule.data) return <p className="cc-error" role="alert">{(rule.error as Error | null)?.message ?? "Something went wrong. Try again."}</p>;
  const r = rule.data;

  const change = (patch: Partial<BreakRule>) => {
    const next = { ...r, ...patch };
    setError(null);
    // Show the change at once; the API's answer replaces it.
    qc.setQueryData([...keyFor(stationsApi.getBreakRule, { params }), 0], next);
    set.mutate(
      { params, body: next },
      {
        onError: (e) => {
          setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
          void rule.refetch();
        }
      }
    );
  };

  const rows = ladderWithPartners(r);
  const fills = rows.filter((x) => !x.partner);
  const every = r.everyMinutes ?? 30;
  const modes: { value: Mode; label: string }[] = [
    { value: "after_every_program", label: ruleLabel("after_every_program", null) },
    { value: "every_n_minutes", label: ruleLabel("every_n_minutes", every) },
    { value: "none", label: ruleLabel("none", null) }
  ];

  const move = (code: FillCode, delta: -1 | 1) => {
    const next = moveFill(r.fillOrder, code, delta);
    if (next.join() === r.fillOrder.join()) return;
    change({ fillOrder: next });
    setSaid(`${fills.find((x) => x.code === code)!.title}, now ${next.indexOf(code) + 1} of ${next.length}`);
  };
  const onKey = (e: KeyboardEvent<HTMLLIElement>, code: FillCode) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      move(code, e.key === "ArrowUp" ? -1 : 1);
      // Keep focus on the row that moved.
      requestAnimationFrame(() => document.getElementById(`cc-fill-${code}`)?.focus());
    }
  };
  const onDrop = (e: DragEvent<HTMLLIElement>, index: number | null) => {
    if (index === null) return;
    e.preventDefault();
    if (dragging) change({ fillOrder: placeFill(r.fillOrder, dragging, index) });
    setDragging(null);
  };

  const backups = rotations.data?.backup.spots ?? [];
  const backupNames = [...new Set(backups.map((b) => b.business))].join(", ");

  return (
    <div className="cc-breaks">
      <div className="cc-breaks__col">
        {!canEdit && <p className="cc-readonly">Only owners and operators change the break rule.</p>}
        <div className="cc-sec-top">
          <h4 className="cc-sec-top__h">When</h4>
        </div>
        <div className="cc-row cc-breaks__rule">
          <b id="cc-break-rule">Break rule</b>
          <Segmented<Mode>
            label="Break rule"
            size="md"
            value={r.mode}
            options={modes.map((m) => ({ ...m, disabled: !canEdit }))}
            onChange={(mode) => change({ mode, everyMinutes: mode === "every_n_minutes" ? every : null })}
          />
        </div>
        <div className="cc-row">
          <div>
            <b>Length</b>
            <small>Live programs cue their own</small>
          </div>
          <ValueSelect label="Break length" value={r.lengthMs} options={LENGTHS} disabled={!canEdit} onChange={(lengthMs) => change({ lengthMs })} />
        </div>

        <div className="cc-sec-top cc-sec-top--gap">
          <h4 className="cc-sec-top__h">In every break, in this order</h4>
          {canEdit && <span className="cc-sec-top__end" id="cc-fill-help">Drag to reorder</span>}
        </div>
        <ol className="cc-ladder" aria-label="In every break, in this order">
          {rows.map((row) => {
            const fixed = row.partner || row.code === "SID" || !canEdit;
            const code = row.code as FillCode;
            return (
              <li
                key={row.partner ? "partners" : row.code}
                id={row.partner ? "cc-fill-partners" : `cc-fill-${row.code}`}
                className={[dragging === code && !row.partner ? "cc-lad cc-lad--dragging" : "cc-lad", row.partner && !r.adsFromPartners ? "cc-lad--off" : ""].filter(Boolean).join(" ")}
                draggable={!fixed}
                tabIndex={fixed ? undefined : 0}
                aria-describedby={fixed ? undefined : "cc-fill-help cc-fill-keys"}
                onDragStart={(e) => {
                  setDragging(code);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => dragging && !row.partner && row.code !== "SID" && e.preventDefault()}
                onDrop={(e) => onDrop(e, row.fillIndex)}
                onKeyDown={fixed ? undefined : (e) => onKey(e, code)}
              >
                <span className="cc-lad__n">{row.n}</span>
                <LogCode code={row.code} className={row.partner && !r.adsFromPartners ? "cc-lad__code--off" : undefined} />
                <span>
                  {row.title}
                  <small>{row.detail}</small>
                </span>
                <span className="cc-lad__t">{row.time}</span>
              </li>
            );
          })}
        </ol>
        <span className="oc-sr-only" id="cc-fill-keys">
          Or move it with the up and down arrow keys.
        </span>
        <span className="oc-sr-only" aria-live="polite">
          {said}
        </span>
      </div>

      <div className="cc-breaks__col">
        <div className="cc-sec-top">
          <h4 className="cc-sec-top__h">How much advertising</h4>
        </div>
        <div className="cc-row cc-breaks__cap">
          <div>
            <b>Spot time per hour</b>
            <small>
              Broadcast TV runs about {TV_MINUTES_PER_HOUR} minutes an hour. {cs} runs at most {capMinutes(r.spotMsPerHour)}.
            </small>
            <div className="cc-cap" aria-hidden="true">
              {capCells(r.spotMsPerHour).map((f, i) => (
                <i key={i} className={f ? "cc-cap__f" : undefined} />
              ))}
            </div>
            <div className="cc-cap__legend" aria-hidden="true">
              <span>
                {cs}, {capMinutes(r.spotMsPerHour)} min
              </span>
              <span>Broadcast TV, about {TV_MINUTES_PER_HOUR}</span>
            </div>
          </div>
          <ValueSelect label="Spot time per hour" value={r.spotMsPerHour} options={CAPS} disabled={!canEdit} onChange={(spotMsPerHour) => change({ spotMsPerHour })} />
        </div>
        <div className="cc-row">
          <div>
            <b>The same spot</b>
            <small>{noMoreThan(r.sameSpotPerHour)}</small>
          </div>
          <ValueSelect label="The same spot, at most" value={r.sameSpotPerHour} options={SAME_SPOT} disabled={!canEdit} onChange={(sameSpotPerHour) => change({ sameSpotPerHour })} />
        </div>

        <div className="cc-sec-top cc-sec-top--gap cc-breaks__never">
          <h4 className="cc-sec-top__h">Never on {cs}</h4>
          <span className="cc-sec-top__sub">Spots in these categories don't appear in your spot market</span>
        </div>
        <div className="cc-breaks__chips">
          <ChipRow
            multiple
            strike
            layout="wrap"
            label={`Never on ${cs}`}
            value={r.blockedCategories}
            options={SPOT_CATEGORIES.map((c) => ({ value: c, label: c, disabled: !canEdit }))}
            onChange={(blockedCategories) => change({ blockedCategories })}
          />
        </div>

        <div className="cc-sec-top cc-sec-top--gap">
          <h4 className="cc-sec-top__h">When a spot pauses</h4>
        </div>
        <div className="cc-row">
          <div>
            <b>Backup rotation</b>
            <small>{rotations.isLoading ? " " : rotations.error ? (rotations.error as Error).message : backupNames || "No backups yet"}</small>
          </div>
          {s.can("spots") && (
            <Button size="sm" href={`${s.base}/breaks?rotation=backup`}>
              Edit
            </Button>
          )}
        </div>
        <div className="cc-row">
          <div>
            <b>If the backups run out too</b>
            <small>Ads from partners if they're on, then bumpers</small>
          </div>
        </div>

        <div className="cc-sec-top cc-sec-top--gap">
          <h4 className="cc-sec-top__h" id="cc-partners">
            Ads from partners
          </h4>
          <span className="cc-sec-top__end">
            <Toggle checked={!!r.adsFromPartners} aria-labelledby="cc-partners" disabled={!canEdit} onChange={(adsFromPartners) => change({ adsFromPartners })} />
          </span>
        </div>
        <div className="cc-row">
          <div>
            <b>Fills only time you haven't</b>
            <small>After your rotation, backups and thank-you credit. Your hourly cap and blocked categories still apply</small>
          </div>
        </div>
        <div className="cc-row">
          <div>
            <b>You don't pick these ads</b>
            <small>They come from ad exchanges, and viewers may each see a different one</small>
          </div>
        </div>
        <div className="cc-row">
          <div>
            <b>Paid when partners pay</b>
            <small>Usually 30 to 90 days after airing, and not held in advance like spot market money</small>
          </div>
        </div>
        {error && (
          <p className="cc-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
