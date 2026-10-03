// Settings, Breaks (station-settings 02.1; A246: the Schedule's Break rules tab, moved as it was): when breaks come and how long they run, what fills
// every break in order (a bumper into and out of the break and the station ID fixed; A143), how
// often spots, the credit, bumpers and the station ID air (the cadence, added 2026-09-29; no frame
// draws it: rows like the frame's "Length"), the
// hourly cap against broadcast TV, the same spot's limit, categories BEAT never airs, the backup
// rotation, and "Ads from partners" (a backfill for time still open: only a flag until the backend
// supports it). Owners and operators change it. A242 (2026-10-02): signing off and on, beside the
// station ID's cadence: the sequence (closer, off-air card, off air, opener, then the station ID if
// the station says so), "Air the station ID after the opener" and "Open each broadcast day with the
// opener", both off by default (no frame draws them: rows like the frame's Ads from partners).
// A243 (2026-10-02): the ladder's two bumper rows are the bumper sequences ("Opening the break",
// "Closing the break"), each a row of roles with its own "How often" (SequenceBuilder), and
// "Between programs" under the ladder; the Bumpers row leaves "How often".

import { useState, type DragEvent, type KeyboardEvent } from "react";
import { libraryApi, SPOT_CATEGORIES, spotsApi, stationsApi, type BreakCadences, type BreakRule, type BumperRole, type PositionRule } from "@opencast/contracts";
import { Button, ChipRow, LogCode, Segmented, Toggle } from "@opencast/ui";
import { duration } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useApi, useApiMutation, keyFor } from "../../../../api/hooks";
import { ApiError } from "../../../../api/client";
import type { StationState } from "../../../station/StationContext";
import { Quiet } from "../../../pages/common";
import {
  CADENCE_PARTS,
  cadenceDetail,
  cadenceFromKey,
  cadenceKey,
  cadenceOf,
  cadenceOptions,
  capCells,
  capMinutes,
  ladder,
  ladderWithPartners,
  moveFill,
  placeFill,
  ruleLabel,
  TV_MINUTES_PER_HOUR,
  exampleLine,
  POSITION_WORDS,
  roleSupply,
  sequencesOf,
  upNextTwice,
  type FillCode,
  type SequencePosition
} from "../breakRule";
import { now as clockNow } from "../../../../lib/clock";
import { SequenceBuilder } from "./SequenceBuilder";
import { noMoreThan, perHour } from "../format";
import { ValueSelect } from "../ValueSelect";
import "./common.css";
import "./BreaksSection.css";

type Mode = BreakRule["mode"];

const LENGTHS = [60, 90, 120, 150, 180, 240].map((s) => ({ value: s * 1000, label: duration(s * 1000) }));
const CAPS = Array.from({ length: 16 }, (_, i) => (i + 1) * 30_000).map((v) => ({ value: v, label: duration(v) }));
const SAME_SPOT = [1, 2, 3, 4].map((n) => ({ value: n, label: perHour(n) }));

/** The break rule's lede (station-settings 02.1); A246: under the Schedule's Break rules tab. */
export function breaksLede(cs: string): string {
  return `Applied to every break ${cs} airs, including breaks inside carried programs where ${cs} sells the time.`;
}

export function BreaksSection({ s }: { s: StationState }) {
  const cs = s.label;
  const params = { stationId: s.id };
  const rule = useApi(stationsApi.getBreakRule, { params });
  const rotations = useApi(spotsApi.getRotations, { params }, { retry: false });
  // A243: what fills each bumper role (counted under each chip).
  const bumpers = useApi(libraryApi.getLibrary, { params, query: { code: "BMP" } }, { retry: false });
  // S17: the categories a station can block, from the API (the same list as the constant).
  const categories = useApi(spotsApi.listSpotCategories, {}, { staleTime: Infinity, retry: false });
  const qc = useQueryClient();
  const set = useApiMutation(stationsApi.setBreakRule, { invalidates: [stationsApi.getBreakRule, spotsApi.getAvails] });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<FillCode | null>(null);
  const [said, setSaid] = useState("");
  const canEdit = s.can("programming");

  if (rule.isLoading) return <Quiet />;
  if (!rule.data) return <p className="cc-error" role="alert">{(rule.error as Error | null)?.message ?? "Something went wrong. Try again."}</p>;
  const r = rule.data;
  const blockable = (categories.data ?? SPOT_CATEGORIES).filter((c) => c.blockable).map((c) => c.name);
  // A category blocked before the list changed stays, so it can be unblocked.
  const never = [...blockable, ...r.blockedCategories.filter((c) => !blockable.includes(c))];

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
  const cadence = cadenceOf(r);
  // A243: the bumper sequences; `cadence.bumpers` follows the opening one's.
  const seq = sequencesOf(r);
  const items = bumpers.data?.items ?? [];
  const at = clockNow();
  const supply = (role: BumperRole) => (bumpers.isLoading ? " " : roleSupply(items, role, at));
  const setSequence = (position: SequencePosition, next: PositionRule) => {
    const bumperSequences = { ...seq, [position]: next };
    const open = bumperSequences.open;
    change({ bumperSequences, cadence: { ...cadence, bumpers: open.every === "n_programs" ? { every: open.every, n: open.n } : { every: open.every } } as BreakCadences });
  };
  const sequenceAt: Record<string, SequencePosition> = { "BMP-in": "open", BMP: "close" };
  const anyUpNext = (["open", "close", "between"] as const).some((p) => seq[p].roles.includes("up_next"));
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
    const moved = ladder({ ...r, fillOrder: next });
    setSaid(`${fills.find((x) => x.code === code)!.title}, now ${moved.findIndex((x) => x.key === code) + 1} of ${moved.length}`);
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
            // The bumpers (into and out of the break) and the station ID have their places.
            const fixed = row.partner || row.fillIndex === null || !canEdit;
            const code = row.code as FillCode;
            const position = row.partner ? undefined : sequenceAt[row.key];
            return (
              <li
                key={row.key}
                id={`cc-fill-${row.key}`}
                className={[dragging === code && !row.partner ? "cc-lad cc-lad--dragging" : "cc-lad", row.partner && !r.adsFromPartners ? "cc-lad--off" : "", position ? "cc-lad--seq" : ""].filter(Boolean).join(" ")}
                draggable={!fixed}
                tabIndex={fixed ? undefined : 0}
                aria-describedby={fixed ? undefined : "cc-fill-help cc-fill-keys"}
                onDragStart={(e) => {
                  setDragging(code);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => dragging && row.fillIndex !== null && e.preventDefault()}
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
                {position && <SequenceBuilder position={position} title={POSITION_WORDS[position].title} rule={seq[position]} onChange={(next) => setSequence(position, next)} supply={supply} disabled={!canEdit} />}
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

        <div className="cc-sec-top cc-sec-top--gap">
          <h4 className="cc-sec-top__h">Between programs</h4>
          <span className="cc-sec-top__sub">{POSITION_WORDS.between.detail}</span>
        </div>
        <SequenceBuilder position="between" title="Between programs" rule={seq.between} onChange={(next) => setSequence("between", next)} supply={supply} disabled={!canEdit} />
        {anyUpNext && <p className="cc-breaks__note">Up next names the next program on your log, as the guide shows it.</p>}
        {upNextTwice(seq) && <p className="cc-breaks__note">Up next airs once a break. Here it only airs if it isn't earlier in the break.</p>}
        <p className="cc-breaks__example">{exampleLine(r, items, at)}</p>

        <div className="cc-sec-top cc-sec-top--gap">
          <h4 className="cc-sec-top__h">How often</h4>
          <span className="cc-sec-top__sub">Open time always airs your station ID and bumpers</span>
        </div>
        {CADENCE_PARTS.map(({ part, title }) => {
          const c = cadence[part];
          return (
            <div className="cc-row" key={part}>
              <div>
                <b>{title}</b>
                <small>{cadenceDetail(part, c)}</small>
              </div>
              <ValueSelect
                label={`How often: ${title}`}
                value={cadenceKey(c)}
                options={cadenceOptions(part)}
                disabled={!canEdit}
                onChange={(key) => change({ cadence: { ...cadence, [part]: cadenceFromKey(key) } as BreakCadences })}
              />
            </div>
          );
        })}

        <div className="cc-sec-top cc-sec-top--gap">
          <h4 className="cc-sec-top__h">Signing off and on</h4>
          <a className="cc-sec-top__end" href={`${s.base}/library/openers`}>
            Openers and closers
          </a>
        </div>
        <p className="cc-breaks__seq" aria-label="When you sign off and back on">
          Closer → Off-air card → off air → Opener → {r.stationIdAfterOpener ? "Station ID" : "(Station ID)"} → first program
        </p>
        <div className="cc-row">
          <div>
            <b id="cc-sid-after">Air the station ID after the opener</b>
            <small>{r.stationIdAfterOpener ? "Both air as you sign back on, ending as the first program starts" : "Off: the opener takes the station ID's place as you sign back on"}</small>
          </div>
          <Toggle checked={!!r.stationIdAfterOpener} aria-labelledby="cc-sid-after" disabled={!canEdit} onChange={(stationIdAfterOpener) => change({ stationIdAfterOpener })} />
        </div>
        <div className="cc-row">
          <div>
            <b id="cc-daily-opener">Open each broadcast day with the opener</b>
            <small>
              {r.dailyOpener
                ? `For a channel that never signs off: at the first program after 6:00 am, where the station ID would air. ${cs} never cuts into a program for it`
                : "For a channel that never signs off. Off: the opener airs only when you sign back on"}
            </small>
          </div>
          <Toggle checked={!!r.dailyOpener} aria-labelledby="cc-daily-opener" disabled={!canEdit} onChange={(dailyOpener) => change({ dailyOpener })} />
        </div>
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
            options={never.map((c) => ({ value: c, label: c, disabled: !canEdit }))}
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
            <Button size="sm" href={`${s.base}/spot-market/rotation?show=backup`}>
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
