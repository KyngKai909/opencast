// The Schedule's Break rules tab (A246 phase 3; opencast-schedule 05, "Break rules, with a
// preview"), from station settings' Breaks (station-settings 02.1). Everything on the page is one
// draft, saved together with "Save break rules" (or put back with Reset); leaving with unsaved
// changes asks first. At the top, every break drawn to scale in air order, then between programs.
// Below, how often each part airs as chips (spots, the credit, bumpers, the station ID, which
// can't be never, and Up next, S20's own cadence), "What can air in your breaks" (blocked
// categories, the backup rotation in Money, the fill order, ads from partners), timing and limits
// as tiles, the bumper order (A243's sequences), and signing off and on (A242). On the right, the
// next hour rebuilt with the draft before it's saved (`previewBreakRule`), what the rule applies
// to, and the blocks with their own bumper order.
//
// The Bumpers chips set the opening and closing sequences' cadence together; Up next's chips set
// `cadence.upNext` alone and never the between-programs sequence (decision 5). The length tile
// says what's true for the mode: after every program, a break is the time its program leaves.

import { useState, type ReactNode } from "react";
import { blocksApi, libraryApi, logApi, SPOT_CATEGORIES, spotsApi, stationsApi, type BreakCadence, type BreakRule, type BumperRole, type PositionRule } from "@opencast/contracts";
import { BreakStrip, Button, ChipRow, Toggle, useToast } from "@opencast/ui";
import { duration } from "@opencast/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi, keyFor } from "../../../../api/hooks";
import { ApiError, call } from "../../../../api/client";
import type { StationState } from "../../../station/StationContext";
import { Quiet } from "../../../pages/common";
import {
  cadenceFromChoice,
  CHIP_PARTS,
  chipCadence,
  choiceOf,
  choiceOptions,
  fillOrder,
  N_PROGRAMS,
  POSITION_WORDS,
  recipeOf,
  roleSupply,
  ruleLabel,
  sameRule,
  sequencesOf,
  upNextHome,
  upNextTwice,
  withChipCadence,
  type CadenceChoice,
  type ChipPart,
  type SequencePosition
} from "../breakRule";
import { now as clockNow } from "../../../../lib/clock";
import { SequenceBuilder } from "./SequenceBuilder";
import { BreakPreview } from "./BreakPreview";
import { useLeaveGuard } from "./useLeaveGuard";
import { perHour } from "../format";
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

/** The recipe's line under its heading: true for the mode chosen (after every program, a break is the time its program leaves). */
export function recipeLine(rule: Pick<BreakRule, "mode" | "lengthMs">): string {
  const scale = `Drawn to scale for a ${duration(rule.lengthMs).replace(/^:/, "0:")} break`;
  if (rule.mode === "after_every_program") return `${scale}. After every program, a break is the time its program leaves, so most run shorter or longer`;
  if (rule.mode === "none") return `${scale}, cued from the booth`;
  return scale;
}

/** What the length tile says it's for, in the mode chosen. */
export function lengthLine(mode: Mode): string {
  if (mode === "after_every_program") return "Breaks cued live, and between repeats. The rest are the time a program leaves";
  if (mode === "none") return "Breaks cued from the booth";
  return "Every break. Live programs cue their own";
}

/** "Late Crate Nights uses its own bumper order during the block." */
export function ownOrderLine(names: string[]): string | null {
  if (!names.length) return null;
  if (names.length === 1) return `${names[0]} uses its own bumper order during the block.`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} use their own bumper order during their blocks.`;
}

export function BreaksSection({ s, head }: { s: StationState; head?: (go: (to: string) => void) => ReactNode }) {
  const cs = s.label;
  const params = { stationId: s.id };
  const rule = useApi(stationsApi.getBreakRule, { params });
  const rotations = useApi(spotsApi.getRotations, { params }, { retry: false });
  // A243: what fills each bumper role (counted under each chip, and the recipe's lengths).
  const bumpers = useApi(libraryApi.getLibrary, { params, query: { code: "BMP" } }, { retry: false });
  // S17: the categories a station can block, from the API (the same list as the constant).
  const categories = useApi(spotsApi.listSpotCategories, {}, { staleTime: Infinity, retry: false });
  // A244: blocks with their own bumper order, named under the preview.
  const blocks = useApi(blocksApi.listBlocks, { params }, { retry: false });
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = s.can("programming");
  const [edits, setEdits] = useState<BreakRule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saved = rule.data;
  const dirty = !!(edits && saved && !sameRule(edits, saved));
  const guard = useLeaveGuard(dirty, () => setEdits(null), { title: "Leave without saving?", subtitle: "Your changes to the break rules haven't been saved. Leaving drops them." });
  const save = useMutation({
    mutationFn: (body: BreakRule) => call(stationsApi.setBreakRule, { params, body }),
    onSuccess: (next) => {
      qc.setQueryData([...keyFor(stationsApi.getBreakRule, { params }), 0], next);
      setEdits(null);
      setError(null);
      // The log and the avails read the rule: they rebuild.
      for (const e of [spotsApi.getAvails, logApi.getLog]) void qc.invalidateQueries({ queryKey: [e.method, e.path] });
      toast.show({ message: "Break rules saved." });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.")
  });

  if (rule.isLoading) return <Quiet />;
  if (!saved) return <p className="cc-error" role="alert">{(rule.error as Error | null)?.message ?? "Something went wrong. Try again."}</p>;
  const r = edits ?? saved;
  const change = (next: (r: BreakRule) => BreakRule) => {
    setError(null);
    setEdits((e) => next(e ?? saved));
  };
  const patch = (p: Partial<BreakRule>) => change((x) => ({ ...x, ...p }));

  const at = clockNow();
  const items = bumpers.data?.items ?? [];
  const supply = (role: BumperRole) => (bumpers.isLoading ? " " : roleSupply(items, role, at));
  const seq = sequencesOf(r);
  const recipe = recipeOf(r, items, at);
  const blockable = (categories.data ?? SPOT_CATEGORIES).filter((c) => c.blockable).map((c) => c.name);
  // A category blocked before the list changed stays, so it can be unblocked.
  const never = [...blockable, ...r.blockedCategories.filter((c) => !blockable.includes(c))];
  const backups = rotations.data?.backup.spots ?? [];
  const backupNames = [...new Set(backups.map((b) => b.business))].join(", ");
  const every = r.everyMinutes ?? 30;
  const modes: { value: Mode; label: string }[] = [
    { value: "after_every_program", label: ruleLabel("after_every_program", null) },
    { value: "every_n_minutes", label: ruleLabel("every_n_minutes", every) },
    { value: "none", label: ruleLabel("none", null) }
  ];
  const setSequence = (position: SequencePosition, next: PositionRule) =>
    change((x) => {
      const bumperSequences = { ...sequencesOf(x), [position]: next };
      const open = bumperSequences.open;
      return { ...x, bumperSequences, cadence: { ...x.cadence!, bumpers: open.every === "n_programs" ? { every: open.every, n: open.n } : { every: open.every } } };
    });
  const ownOrder = ownOrderLine((blocks.data?.blocks ?? []).filter((b) => b.sequences).map((b) => b.name));
  const spotsFirst = fillOrder(r.fillOrder).indexOf("SPT") < fillOrder(r.fillOrder).indexOf("UND");
  const upNextOwn = !!r.cadence?.upNext;
  const anyUpNext = (["open", "close", "between"] as const).some((p) => seq[p].roles.includes("up_next")) || (upNextOwn && r.cadence?.upNext?.every !== "never");

  return (
    <div className="cc-rules">
      {head?.(guard.go)}
      <p className="cc-sch__lede">{breaksLede(cs)}</p>
      {!canEdit && <p className="cc-readonly">Only owners and operators change the break rule.</p>}
      <div className="cc-rules__grid">
        <div className="cc-rules__main">
          <section className="cc-recipe" aria-labelledby="cc-recipe-h">
            <h2 className="cc-recipe__h" id="cc-recipe-h">
              Every break, in air order
            </h2>
            <p className="cc-recipe__sub">{recipeLine(r)}</p>
            <BreakStrip variant="big" parts={recipe.inBreak} className="cc-recipe__strip" />
            {/* On the phone the strip's parts are too narrow for their words: they're listed under it. */}
            <p className="cc-recipe__legend" aria-hidden="true">
              {recipe.inBreak.map((p) => `${p.label} ${p.detail}`).join(" · ")}
            </p>
            {recipe.between.length > 0 && (
              <p className="cc-recipe__after">
                Then between programs
                {recipe.between.map((p, i) => (
                  <span key={i} className={`cc-recipe__chip oc-brk--${p.kind}`}>
                    {p.label} {p.detail}
                  </span>
                ))}
                <span>Outside the break, so partner ads never replace it</span>
              </p>
            )}
          </section>

          <div className="cc-cad" role="group" aria-label="How often each part airs">
            {CHIP_PARTS.map(({ part, kind, title, detail }) => (
              <CadenceRow
                key={part}
                part={part}
                kind={kind}
                title={title}
                detail={part === "upNext" ? upNextLine(r) : detail}
                cadence={chipCadence(r, part)}
                disabled={!canEdit}
                onChange={(c) => change((x) => withChipCadence(x, part, c))}
              />
            ))}
          </div>

          <section className="cc-rules__sec" aria-labelledby="cc-can-air">
            <h2 className="cc-rules__h" id="cc-can-air">
              What can air in your breaks
            </h2>
            <div className="cc-cad cc-cad--two">
              <div className="cc-cad__r">
                <div>
                  <b>Never on {cs}</b>
                  <small>Spots in these categories don't reach your market</small>
                </div>
                <ChipRow
                  multiple
                  strike
                  layout="wrap"
                  label={`Never on ${cs}`}
                  value={r.blockedCategories}
                  options={never.map((c) => ({ value: c, label: c, disabled: !canEdit }))}
                  onChange={(blockedCategories) => patch({ blockedCategories })}
                />
              </div>
              <div className="cc-cad__r">
                <div>
                  <b>Backup rotation</b>
                  <small>When a spot pauses</small>
                </div>
                <span className="cc-cad__val">
                  {rotations.isLoading ? " " : rotations.error ? (rotations.error as Error).message : backupNames || "No backups yet"}
                  {s.can("spots") && (
                    <a className="cc-cad__link" href={`${s.base}/spot-market/rotation?show=backup`}>
                      Open the rotation
                    </a>
                  )}
                </span>
              </div>
              <div className="cc-cad__r">
                <div>
                  <b>Fill order</b>
                  <small>Your spots and the credit, inside each break</small>
                </div>
                <ChipRow<"spots" | "credit">
                  layout="wrap"
                  size="sm"
                  label="Fill order"
                  value={spotsFirst ? "spots" : "credit"}
                  options={[
                    { value: "spots", label: "Spots, then the credit", disabled: !canEdit },
                    { value: "credit", label: "The credit, then spots", disabled: !canEdit }
                  ]}
                  onChange={(v) => patch({ fillOrder: v === "spots" ? ["SPT", "UND", "BMP", "SID"] : ["UND", "SPT", "BMP", "SID"] })}
                />
              </div>
              <div className="cc-cad__r">
                <div>
                  <b>Ads from partners</b>
                  <small>Only time still open. Paid later</small>
                </div>
                <ChipRow<"on" | "off">
                  layout="wrap"
                  size="sm"
                  label="Ads from partners"
                  value={r.adsFromPartners ? "on" : "off"}
                  options={[
                    { value: "on", label: "On", disabled: !canEdit },
                    { value: "off", label: "Off", disabled: !canEdit }
                  ]}
                  onChange={(v) => patch({ adsFromPartners: v === "on" })}
                />
              </div>
            </div>
          </section>

          <div className="cc-timing" role="group" aria-label="Timing and limits">
            <div className="cc-timing__t cc-timing__t--words">
              <small>Breaks come</small>
              <ValueSelect label="Breaks come" value={r.mode} options={modes} disabled={!canEdit} onChange={(mode) => patch({ mode, everyMinutes: mode === "every_n_minutes" ? every : null })} />
            </div>
            <div className="cc-timing__t">
              <small>Length</small>
              <ValueSelect label="Break length" value={r.lengthMs} options={LENGTHS} disabled={!canEdit} onChange={(lengthMs) => patch({ lengthMs })} />
              <span className="cc-timing__note">{lengthLine(r.mode)}</span>
            </div>
            <div className="cc-timing__t">
              <small>Spot time per hour</small>
              <ValueSelect label="Spot time per hour" value={r.spotMsPerHour} options={CAPS} disabled={!canEdit} onChange={(spotMsPerHour) => patch({ spotMsPerHour })} />
            </div>
            <div className="cc-timing__t">
              <small>Same spot per hour</small>
              <ValueSelect label="The same spot, at most" value={r.sameSpotPerHour} options={SAME_SPOT} disabled={!canEdit} onChange={(sameSpotPerHour) => patch({ sameSpotPerHour })} />
            </div>
          </div>

          <section className="cc-rules__sec" aria-labelledby="cc-order-h">
            <h2 className="cc-rules__h" id="cc-order-h">
              The bumper order
            </h2>
            <p className="cc-rules__sub">{upNextOwn ? "Which bumpers air, in order. Up next goes by its own choice above; here it only sets its place" : "Which bumpers air, in order, and how often each place airs them"}</p>
            {(["open", "close", "between"] as const).map((position) => (
              <div className="cc-rules__seq" key={position}>
                <div>
                  <b>{POSITION_WORDS[position].title}</b>
                  <small>{POSITION_WORDS[position].detail.replace(/\.$/, "")}</small>
                </div>
                <SequenceBuilder position={position} title={POSITION_WORDS[position].title} rule={seq[position]} onChange={(next) => setSequence(position, next)} supply={supply} disabled={!canEdit} />
              </div>
            ))}
            {anyUpNext && <p className="cc-breaks__note">Up next names the next program on your log, as the guide shows it.</p>}
            {upNextTwice(seq) && <p className="cc-breaks__note">Up next airs once a break. Here it only airs if it isn't earlier in the break.</p>}
          </section>

          <section className="cc-rules__sec" aria-labelledby="cc-sign-h">
            <div className="cc-sec-top">
              <h2 className="cc-rules__h" id="cc-sign-h">
                Signing off and on
              </h2>
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
              <Toggle checked={!!r.stationIdAfterOpener} aria-labelledby="cc-sid-after" disabled={!canEdit} onChange={(stationIdAfterOpener) => patch({ stationIdAfterOpener })} />
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
              <Toggle checked={!!r.dailyOpener} aria-labelledby="cc-daily-opener" disabled={!canEdit} onChange={(dailyOpener) => patch({ dailyOpener })} />
            </div>
          </section>
        </div>

        <aside className="cc-rules__side" aria-label="Preview and save">
          <BreakPreview stationId={s.id} rule={r} dirty={dirty} now={at.getTime()} />
          <p className="cc-applies">
            Everything on this page saves together. Applies to breaks not yet filled. Breaks in the next 20 minutes keep what they have.
            {ownOrder && (
              <>
                {" "}
                <OwnOrder line={ownOrder} />
              </>
            )}
          </p>
          {canEdit && (
            <div className="cc-rules__save">
              <Button size="sm" disabled={!dirty || save.isPending} onClick={() => (setEdits(null), setError(null))}>
                Reset
              </Button>
              <Button size="sm" variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(r)}>
                {save.isPending ? "Saving…" : "Save break rules"}
              </Button>
              <span className="cc-rules__state" aria-live="polite">
                {dirty ? "Unsaved changes" : ""}
              </span>
            </div>
          )}
          {error && (
            <p className="cc-error" role="alert">
              {error}
            </p>
          )}
        </aside>
      </div>
      {guard.dialog}
    </div>
  );
}

/** The blocks' names in bold, as the reference draws "Late Crate Nights uses its own bumper order". */
function OwnOrder({ line }: { line: string }) {
  const m = /^(.*?) (uses its own|use their own)(.*)$/.exec(line);
  if (!m) return <>{line}</>;
  return (
    <>
      <b>{m[1]}</b> {m[2]}
      {m[3]}
    </>
  );
}

/** Up next's line: where it airs, by its own cadence or its place in a sequence. */
function upNextLine(r: BreakRule): string {
  const home = upNextHome(sequencesOf(r));
  return home === "between" ? "Between programs" : home === "open" ? "In the break, as it opens" : "In the break, as it closes";
}

/** One part's chips: every break, after each program, every N programs (N chosen beside it), once an hour, never. */
function CadenceRow({ part, kind, title, detail, cadence, disabled, onChange }: { part: ChipPart; kind: string; title: string; detail: string; cadence: BreakCadence | null; disabled: boolean; onChange: (c: BreakCadence) => void }) {
  const n = cadence?.n ?? 2;
  const choice: CadenceChoice | "" = cadence ? choiceOf(cadence) : "";
  return (
    <div className="cc-cad__r" data-part={part}>
      <span className={`cc-cad__sw oc-brk--${kind}`} aria-hidden="true" />
      <div>
        <b>{title}</b>
        <small>{detail}</small>
      </div>
      <div className="cc-cad__chips">
        <ChipRow<CadenceChoice>
          layout="wrap"
          size="sm"
          label={`How often: ${title}`}
          value={choice as CadenceChoice}
          options={choiceOptions(part, n).map((o) => ({ ...o, disabled: disabled || o.disabled }))}
          onChange={(v) => onChange(cadenceFromChoice(v, n))}
          className="cc-cad__set"
        />
        {choice === "n" && <ValueSelect label={`How many programs: ${title}`} value={n} options={N_PROGRAMS.map((x) => ({ value: x, label: `${x} programs` }))} disabled={disabled} onChange={(x) => onChange({ every: "n_programs", n: x })} />}
        {part === "bumpers" && !cadence && <small className="cc-cad__note">Opening and closing differ. Set each in the bumper order below</small>}
      </div>
    </div>
  );
}
