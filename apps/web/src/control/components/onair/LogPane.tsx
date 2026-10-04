// A246: the Day view's pane (opencast-schedule 01, 02). With nothing picked, "Tonight at a glance"
// (programs, breaks, spots placed, open time and where it goes, barter owed to makers), the recent
// changes, and the next break. A break picked: what's in it in air order, as a strip scaled by
// length and as a list saying whose time each part is ("REEL's barter", "From the backup
// rotation"), "Spots, placed at 10:09 pm" before spots are placed, and why it's built that way, with
// a link to Break rules. A program picked: its details. A block's label picked: the block.

import type { ReactNode } from "react";
import { Link } from "react-router";
import type { BlockSpan, BreakRow, BreakRule, BreakSlot, LogEntry } from "@opencast/contracts";
import { BreakStrip, Button, breakKindClass, clock, clockRange, minutesText, type BreakKind } from "@opencast/ui";
import { STATION_TZ } from "../../../lib/clock";
import { spanSummary } from "../live/blocks";
import { cadenceOf, longWords, sequencesOf, timingWords } from "../station/breakRule";
import { breakKindOf, breakOwner, breakParts, rowLength, spotsPending, spotsPlacedAt, type Glance, type RowBlock } from "./dayRows";
import { entrySource } from "./rundown";
import { spanText } from "./time";

const t = (s: string) => Date.parse(s);

/** How often, in a sentence's words: "every break", "once an hour", "after every 2 programs". */
function often(c: { every: string; n?: number }): string {
  switch (c.every) {
    case "break":
      return "every break";
    case "program":
      return "after every program";
    case "n_programs":
      return `after every ${c.n ?? 2} programs`;
    case "hour":
      return "once an hour";
    default:
      return "never";
  }
}

/**
 * Why a break is built the way it is, from the break rule (and the block it's in, the program it's
 * in): "Breaks come after every program. Bumpers open every break; the credit airs once an hour."
 */
export function whyLine(slot: BreakSlot, rule: BreakRule | undefined, opts: { owner: string | null; block: RowBlock | null; cuedIn?: string | null }): string {
  const parts: string[] = [];
  const barter = slot.producerShareMs;
  if (barter && opts.owner) parts.push(`${opts.owner}'s ${rowLength(barter)} is the maker's time under barter.`);
  if (slot.origin === "cued_live") parts.push(`Cued from the booth${opts.cuedIn ? ` during ${opts.cuedIn}` : ""}.`);
  if (rule) {
    // A247: every N programs, any minutes, clock times; inside long programs too.
    if (slot.origin === "rule") parts.push(rule.mode === "none" ? "Breaks are cued from the booth." : `Breaks come ${timingWords(rule)}.`);
    const long = slot.origin !== "cued_live" ? longWords(rule) : null;
    if (long) parts.push(long);
    const c = cadenceOf(rule);
    const seq = sequencesOf(rule);
    const how = [
      seq.open.every === "never" ? "no bumpers open the break" : `bumpers open ${often(seq.open)}`,
      c.spots.every !== "break" ? `spots air ${often(c.spots)}` : null,
      c.underwriting.every === "never" ? null : `the credit airs ${often(c.underwriting)}`,
      c.stationId.every !== "break" ? `the station ID airs ${often(c.stationId)}` : null,
      // S20: Up next with its own cadence.
      rule.cadence?.upNext ? (rule.cadence.upNext.every === "never" ? "up next is off" : `up next airs ${often(rule.cadence.upNext)}`) : null,
      opts.block ? `during ${opts.block.name}, its bumper and ID replace the station's` : null
    ].filter((w): w is string => !!w);
    if (how.length) parts.push(`${how.join("; ").replace(/^./, (x) => x.toUpperCase())}.`);
  }
  return parts.join(" ");
}

const POSITION: Record<string, string> = { open: "Into the break", close: "Out of the break", between: "Between programs", boundary: "Where the block starts or ends" };

/** One part of a break in the pane's list: what it is, whose time, how long. */
export function breakItem(r: BreakRow, slot: BreakSlot, opts: { owner: string | null; now: number; toMarket: boolean; rule?: BreakRule }): { kind: BreakKind; title: string; detail: string | null; lengthMs: number } {
  const kind = breakKindOf(r);
  const own = r.block ? `${r.block.name}'s own` : null;
  switch (kind) {
    case "bumper":
      return { kind, title: r.title, detail: [r.element ? POSITION[r.element.position] : null, own].filter(Boolean).join(". ") || r.note, lengthMs: r.lengthMs };
    case "upnext":
      return { kind, title: r.title, detail: r.element?.announces ? `Up next: ${r.element.announces.title}, ${clock(r.element.announces.startsAt, { timeZone: STATION_TZ })}` : "Up next", lengthMs: r.lengthMs };
    case "spots":
      return { kind, title: r.title, detail: r.whose === "backup" ? "From the backup rotation" : "From the main rotation", lengthMs: r.lengthMs };
    case "barter":
      return { kind, title: r.title, detail: opts.owner ? `${opts.owner}'s barter` : (r.note ?? "The maker's barter"), lengthMs: r.lengthMs };
    case "credit":
      return { kind, title: "Thank-you credit", detail: opts.rule ? `${r.title}. ${often(cadenceOf(opts.rule).underwriting).replace(/^./, (x) => x.toUpperCase())}` : r.title, lengthMs: r.lengthMs };
    case "id":
      return { kind, title: r.title, detail: r.block ? "Where the station ID airs, during the block" : "Last in the break", lengthMs: r.lengthMs };
    default: {
      const len = rowLength(r.lengthMs);
      if (spotsPending(slot, opts.now))
        return { kind, title: `Spots, placed at ${clock(spotsPlacedAt(slot), { timeZone: STATION_TZ })}`, detail: opts.toMarket ? `From the main rotation. ${len} open to the spot market until then` : `From the main rotation. ${len} holds on the station ID slate until then`, lengthMs: r.lengthMs };
      return { kind, title: "Open", detail: r.note ?? (opts.toMarket ? "Open to the spot market" : "Holds on the station ID slate"), lengthMs: r.lengthMs };
    }
  }
}

export interface BreakPaneProps {
  slot: BreakSlot;
  entries: LogEntry[];
  block: RowBlock | null;
  rule: BreakRule | undefined;
  now: number;
  base: string | null;
  /** "Next break, 8:59:20 pm" in the glance; "Break, 10:29:10 pm" picked. */
  heading: string;
  onClose?: () => void;
  /** The glance's next break: the strip and why, without the list. */
  brief?: boolean;
}

/** A break: its strip, its parts in air order with whose time each is, and why. */
export function BreakPane({ slot, entries, block, rule, now, base, heading, onClose, brief }: BreakPaneProps) {
  const owner = breakOwner(slot, entries);
  const toMarket = rule?.openTimeTo === "spot_market";
  const inside = entries.find((e) => t(e.startsAt) < t(slot.startsAt) && t(slot.startsAt) < t(e.endsAt));
  const sub = [slot.context, rowLength(slot.lengthMs), block ? `Inside ${block.name}` : null].filter(Boolean).join(". ");
  const rows = slot.rows ?? [];
  const items = rows.filter((r) => !((r.element && !r.element.fits) || (r.block && !r.block.fits))).map((r) => breakItem(r, slot, { owner, now, toMarket, rule }));
  const missed = rows.filter((r) => (r.element && !r.element.fits) || (r.block && !r.block.fits));
  const Heading = brief ? "h3" : "h2";
  return (
    <section className="cc-bpane" aria-label={heading}>
      <div className="cc-log__hrow">
        <Heading className="cc-pane__h">{heading}</Heading>
        {onClose && (
          <Button variant="text" size="sm" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
      <p className="cc-pane__sub">{sub}</p>
      <BreakStrip parts={breakParts(slot, owner)} className="cc-bpane__strip" />
      {!brief && (
        <ul className="cc-blst" aria-label="In air order">
          {items.map((it, i) => (
            <li key={i}>
              <span className={`cc-blst__sw ${breakKindClass(it.kind)}`} aria-hidden="true" />
              <div>
                <b>{it.title}</b>
                {it.detail && <small>{it.detail}</small>}
              </div>
              <span className="cc-blst__m">{rowLength(it.lengthMs)}</span>
            </li>
          ))}
          {missed.map((r, i) => (
            <li key={`m${i}`} className="cc-blst__missed">
              <span className="cc-blst__sw" aria-hidden="true" />
              <div>
                <b>Didn't fit: {r.title}</b>
              </div>
              <span className="cc-blst__m" />
            </li>
          ))}
        </ul>
      )}
      <p className="cc-why">
        {whyLine(slot, rule, { owner, block, cuedIn: inside?.title ?? null })}{" "}
        {base && (
          <Link to={`${base}/schedule/rules`} className="cc-log__link">
            Break rules
          </Link>
        )}
      </p>
      {!brief && base && (
        <div className="cc-edit__actions">
          <Button size="sm" href={`${base}/spot-market/rotation`}>
            Spot rotation
          </Button>
          {block && (
            <Button size="sm" href={`${base}/schedule/blocks/${block.blockId}`}>
              Block settings
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

export interface GlancePaneProps {
  title: string;
  glance: Glance;
  toMarket: boolean;
  changes: ReactNode;
  next: ReactNode;
}

/** "Tonight at a glance": the evening and night in numbers, then the recent changes and the next break. */
export function GlancePane({ title, glance, toMarket, changes, next }: GlancePaneProps) {
  return (
    <section className="cc-glance" aria-labelledby="cc-glance-h">
      <h2 className="cc-pane__h" id="cc-glance-h">
        {title}
      </h2>
      <p className="cc-pane__sub">{glance.span}</p>
      <dl className="cc-kv2">
        <div>
          <dt>Programs</dt>
          <dd>{minutesText(glance.programsMs)}</dd>
        </div>
        <div>
          <dt>Breaks</dt>
          <dd>{glance.breaks ? `${glance.breaks}, ${minutesText(glance.breaksMs)} in all` : "None"}</dd>
        </div>
        <div>
          <dt>Spots placed so far</dt>
          <dd>{glance.spots}</dd>
        </div>
        <div>
          <dt>{toMarket ? "Still open, to the spot market" : "Still open, on the station ID slate"}</dt>
          <dd>{rowLength(glance.openMs)}</dd>
        </div>
        <div>
          <dt>Barter time owed to makers</dt>
          <dd>{rowLength(glance.barterMs)}</dd>
        </div>
      </dl>
      {changes}
      {next}
    </section>
  );
}

/** A program picked on the day: when, where it's from, its episode and note, its block. */
export function EntryPane({ entry, block, onEdit, onClose }: { entry: LogEntry; block: Pick<BlockSpan, "name"> | null; onEdit?: () => void; onClose: () => void }) {
  const title = entry.kind === "off_air" ? "Off air" : entry.title;
  return (
    <section className="cc-epane" aria-label={title}>
      <div className="cc-log__hrow">
        <h2 className="cc-pane__h">{title}</h2>
        <Button variant="text" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="cc-pane__sub">{spanText(entry.startsAt, entry.endsAt)}</p>
      <dl className="cc-kv2">
        <div>
          <dt>From</dt>
          <dd>{entrySource(entry)}</dd>
        </div>
        {entry.episodeTitle && (
          <div>
            <dt>Episode</dt>
            <dd>{entry.episodeTitle}</dd>
          </div>
        )}
        {entry.localNote && (
          <div>
            <dt>Note</dt>
            <dd>{entry.localNote}</dd>
          </div>
        )}
        {block && (
          <div>
            <dt>Block</dt>
            <dd>{block.name}</dd>
          </div>
        )}
        <div>
          <dt>Length</dt>
          <dd>{rowLength(t(entry.endsAt) - t(entry.startsAt))}</dd>
        </div>
        {entry.keepTime && (
          <div>
            <dt>Keep at this time</dt>
            <dd>On</dd>
          </div>
        )}
      </dl>
      {onEdit && (
        <div className="cc-edit__actions">
          <Button size="sm" onClick={onEdit}>
            Change it
          </Button>
        </div>
      )}
    </section>
  );
}

/** A244: a programming block's pane: where it airs, what to look at, and changing it. */
export function BlockPane({ span, canEdit, now, base, onChangeTimes, onTakeOff, onClose }: { span: BlockSpan; canEdit: boolean; now: number; base: string | null; onChangeTimes: () => void; onTakeOff: () => void; onClose: () => void }) {
  return (
    <section className="cc-epane" aria-label={span.name}>
      <div className="cc-log__hrow">
        <h2 className="cc-pane__h">
          <span className="cc-log__swatch" style={{ background: span.colour ?? "var(--ink-70)" }} aria-hidden="true" />
          {span.name}
        </h2>
        <Button variant="text" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="cc-pane__sub">
        Block, {clockRange(span.startsAt, span.endsAt, { timeZone: STATION_TZ })}. {spanSummary(span)}
      </p>
      {span.problems.length > 0 && (
        <ul className="cc-edit__warnings" aria-label="To look at">
          {span.problems.map((p) => (
            <li key={p.code + p.message}>{p.message}</li>
          ))}
        </ul>
      )}
      <div className="cc-edit__actions">
        {canEdit && (
          <Button size="sm" onClick={onChangeTimes}>
            Change times
          </Button>
        )}
        {canEdit && t(span.startsAt) > now && (
          <Button size="sm" variant="text" onClick={onTakeOff}>
            Take the block off this day
          </Button>
        )}
        {base && (
          <Button size="sm" variant="text" href={`${base}/schedule/blocks/${span.blockId}`}>
            Edit {span.name}
          </Button>
        )}
      </div>
    </section>
  );
}
