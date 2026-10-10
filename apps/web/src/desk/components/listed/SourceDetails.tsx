// An external station's details (follow-up Phase 6; the page's row opens it, ?source=<id>): how it
// plays and the evidence it may (the terms page and the day it was checked, the written permission
// as recorded, or the public basis), where "what's on" comes from, the address it plays from, the
// stream right now, and its outages over the last 90 days. A listing waiting for its evidence offers
// Record evidence. A215: its changes next to its outages, the permissions recorded before that don't
// cover its address now, "Change" and "Take off the dial for good"; one taken off offers "Put back
// on the list". A241: a schedule entered by hand, compactly ("Mon–Fri 6:00–9:00 pm: City Council"),
// where it was checked and the dates it skips; a webpage with no event data says so, and offers
// entering the schedule by hand. A248: a spreadsheet: what was read (the summary, the tab, the zone
// and why, the cells skipped), its link or uploaded file, and a Google Sheet that isn't public.
import type { ReactNode } from "react";
import { networkApi, type ListedSource } from "@opencast/contracts";
import { Button, KeyValueList, Modal, type KeyValueRow } from "@opencast/ui";
import { useApi } from "../../../api/hooks";
import { deskPath } from "../../../areas";
import { useNow } from "../../../lib/clock";
import { dateAtTime, dayMonth, localDate } from "../../lib/dates";
import { ErrorLine } from "../../pages/common";
import { channelWords, guideCadence, guideProblem, guideSize, guideSummary } from "./guides";
import { browserNote, changeWords, familyLine, FORMAT_LABELS, nativeOnlyNote, NO_EVENT_DATA, needsEvidence, nowWords, outageWords, PLAYS_LABELS, playsDetail, playsOf, removedWords, scheduleWords, shortDate, sourceDetail, transportLine } from "./external";
import { weekLines } from "./manual";
import { datesPassed, fileWords, NOT_PUBLIC_HELP, sheetSummary, skippedWords, tabWords, ZONE_FROM_WORDS, zoneShort, zonesNamedWords } from "./sheets";
import { channelText } from "./SourceStatus";
import "./SourceDetails.css";

const Link = ({ href }: { href: string }) => (
  <a className="nd-src__link" href={href} target="_blank" rel="noopener noreferrer">
    {href}
  </a>
);

function evidenceRows(s: ListedSource, tz: string): KeyValueRow[] {
  const e = s.evidence;
  if (playsOf(s) === "embed") {
    return [
      { title: "Their terms", detail: s.embedTerms === "allowed" ? "Allow embedding" : "Unclear" },
      {
        title: "Terms page",
        detail: e?.termsUrl ? (
          <>
            <Link href={e.termsUrl} />
            {e.termsCheckedOn ? `, checked ${shortDate(e.termsCheckedOn, tz)}` : ", not checked yet"}
          </>
        ) : (
          "Not recorded yet"
        )
      }
    ];
  }
  const p = e?.permission;
  if (p) {
    return [
      { title: "Their written permission", detail: `${p.grantedBy}, ${shortDate(p.grantedOn, tz)}` },
      { title: "Where it's kept", detail: p.documentUrl ? <>{p.evidence}. <Link href={p.documentUrl} /></> : p.evidence },
      { title: "The stream it covers", detail: <span className="nd-mono nd-src__addr">{p.streamUrl}</span> },
      { title: "Recorded", detail: `${p.recordedBy ? `By ${p.recordedBy}, ` : ""}${dateAtTime(p.recordedAt, tz)}. Recorded once, never edited` }
    ];
  }
  if (e?.publicBasis) return [{ title: "Clearly public", detail: e.publicBasis }];
  return [{ title: "Their permission", detail: s.earlierPermissions?.length ? "Not recorded yet for this address" : "Not recorded yet" }];
}

/** A215: written permissions recorded before, for another address: kept as they were. */
function earlierRows(s: ListedSource, tz: string): KeyValueRow[] {
  return (s.earlierPermissions ?? []).map((p) => ({
    title: "Earlier permission",
    detail: (
      <>
        {`${p.grantedBy}, ${shortDate(p.grantedOn, tz)}, for `}
        <span className="nd-mono nd-src__addr">{p.streamUrl}</span>
        {". Kept, never edited"}
      </>
    )
  }));
}

/** A248: what was read from its spreadsheet, and the file uploaded. */
function sheetRows(s: ListedSource, tz: string, now: Date): KeyValueRow[] {
  const sc = s.schedule;
  const sheet = sc?.sheet;
  const rows: KeyValueRow[] = [];
  if (sheet) {
    const skipped = skippedWords(sheet);
    const passed = datesPassed(sheet, localDate(now, tz), sc?.source === "file");
    rows.push({ title: "What was read", detail: `${sheetSummary(sheet)}. ${sc?.source === "file" ? "Read when it was uploaded" : `Last read ${dateAtTime(sheet.readAt, tz)}`}` });
    const tab = tabWords(sheet);
    if (tab) rows.push({ title: "Tab", detail: tab });
    rows.push({ title: "Times in", detail: [`${zoneShort(sheet.timeZone)}: ${ZONE_FROM_WORDS[sheet.timeZoneFrom]}`, zonesNamedWords(sheet)].filter(Boolean).join(". ") });
    if (passed) rows.push({ title: "Nothing to come", detail: passed });
    if (skipped) {
      rows.push({
        title: skipped.title,
        detail: (
          <ul className="nd-src__week" aria-label="Skipped">
            {skipped.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )
      });
    }
  }
  if (sc?.source === "file" && sc.file) rows.push({ title: "Spreadsheet file", detail: fileWords(sc.file, dayMonth(sc.file.uploadedAt, tz, { short: true })) });
  return rows;
}

function scheduleRows(s: ListedSource, tz: string, now: Date): KeyValueRow[] {
  const w = scheduleWords({ ...s, waiting: null });
  const sc = s.schedule;
  const rows: KeyValueRow[] = [{ title: w.text, detail: w.detail }];
  // A241: the week entered by hand, a slot a line, and the dates it doesn't air.
  const week = weekLines(s);
  if (week.length) {
    rows.push({
      title: "Every week",
      detail: (
        <ul className="nd-src__week" aria-label="Every week">
          {week.map((x) => (
            <li key={x.text}>
              {x.text}
              {x.description ? <span className="nd-src__about">. {x.description}</span> : null}
            </li>
          ))}
        </ul>
      )
    });
  }
  if (sc?.source === "manual" && sc.skipDates?.length) rows.push({ title: "Doesn't air on", detail: sc.skipDates.map((d) => shortDate(d, tz)).join(", ") });
  rows.push(...sheetRows(s, tz, now));
  if ((sc?.source === "guide_data" || sc?.source === "manual") && sc.checkedAgainst) {
    rows.push({ title: "Checked against", detail: <>{<Link href={sc.checkedAgainst} />}{sc.checkedOn ? `, ${shortDate(sc.checkedOn, tz)}` : ""}</> });
  }
  if (sc?.source !== "none" && sc?.source !== "manual" && sc?.source !== "file" && s.calendarUrl) {
    rows.push({ title: sc?.source === "guide_data" ? "Guide data address" : sc?.format === "webpage" ? "Schedule page" : sc?.format === "sheet" ? "Spreadsheet link" : "Feed address", detail: <Link href={s.calendarUrl} /> });
    if (sc?.format && sc.format !== "sheet") rows.push({ title: "Format", detail: FORMAT_LABELS[sc.format] });
  }
  // A249: what was read from its XMLTV guide: the channel, of how many, its size, how often.
  const g = sc?.guide;
  if (g && s.calendarUrl) {
    if (g.channel) rows.push({ title: "Channel in the guide", detail: `${channelWords(g)}${g.channels > 1 ? `, one of ${g.channels.toLocaleString("en-US")} channels` : ""}` });
    rows.push({ title: "What was read", detail: `${g.channel ? `${guideSummary(g)}. ` : ""}${guideSize(g)}. Last read ${dateAtTime(g.readAt, tz)}${g.unchangedAt ? `; not changed since, at ${dateAtTime(g.unchangedAt, tz)}` : ""}` });
    rows.push({ title: "How often", detail: guideCadence(g) });
  }
  return rows;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="nd-src__sec">
      <h3 className="nd-src__h">{title}</h3>
      {children}
    </section>
  );
}

export function SourceDetails({
  source: s,
  timeZone: tz,
  onClose,
  onRecord,
  onChange,
  onRemove,
  onRestore,
  onEnterByHand
}: {
  source: ListedSource;
  timeZone: string;
  onClose: () => void;
  onRecord: () => void;
  /** A215: Change, Take off the dial for good, and Put back on the list. */
  onChange?: () => void;
  onRemove?: () => void;
  onRestore?: () => void;
  /** A241: Change, opened on "Enter it by hand" (a webpage with no event data). */
  onEnterByHand?: () => void;
}) {
  const now = useNow(60_000);
  const outages = useApi(networkApi.listExternalOutages, { params: { sourceId: s.id } });
  const changes = useApi(networkApi.listListedChanges, { params: { sourceId: s.id } });
  const ch = channelText(s);
  const gone = removedWords(s, tz, now);
  const right = nowWords({ ...s, waiting: s.waiting === "down" ? null : s.waiting }, now);
  const h = s.health;
  const checked = h?.lastCheckedAt ? `Last checked ${dateAtTime(h.lastCheckedAt, tz)}${h.detail ? `. ${h.detail}` : ""}` : "Checked every minute once it's on the dial";
  const held = s.waiting === "dash_not_played" ? "DASH stream links" : s.waiting === "other_market" ? "other markets' streams" : null;
  return (
    <Modal
      open
      onClose={onClose}
      width={560}
      title={s.name}
      subtitle={[gone ? `${gone.text}. ${gone.detail}` : (ch ?? "Not on the dial"), familyLine(s), sourceDetail(s)].filter(Boolean).join(". ")}
      footer={
        gone ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            {onRestore && (
              <Button variant="primary" onClick={onRestore}>
                Put back on the list
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            {onChange && (
              <Button variant={needsEvidence(s) ? "ghost" : "primary"} onClick={onChange}>
                Change
              </Button>
            )}
            {needsEvidence(s) && (
              <Button variant="primary" onClick={onRecord}>
                Record evidence
              </Button>
            )}
          </>
        )
      }
    >
      <Section title="How it plays">
        <KeyValueList
          variant="rows"
          items={[
            { title: PLAYS_LABELS[playsOf(s)], detail: playsDetail(s, tz) || null },
            // A237: an http:// stream link over https from the source, or through the relay; A238: one
            // whose server blocks browsers, through the relay (with what the check found); A239: one
            // only the native apps can play.
            ...(transportLine(s) ? [{ title: transportLine(s)!, detail: s.relayReason === "cors" ? (s.cors?.detail ?? null) : nativeOnlyNote(s) }] : []),
            ...evidenceRows(s, tz),
            { title: playsOf(s) === "embed" ? "Their player's address" : "Stream address", detail: <span className="nd-mono nd-src__addr">{s.streamUrl}</span> },
            ...earlierRows(s, tz)
          ]}
        />
        {held && (
          <p className="nd-src__note">
            It waits until Settings allows {held}. <a href={deskPath("/settings/rules")}>Open the rules</a>
          </p>
        )}
        {s.waiting === "needs_https" && <p className="nd-src__note">Apps on https can't play an http address. It waits until its source answers over https, or Opencast's secure relay is set up.</p>}
        {browserNote(s) && <p className="nd-src__note">{browserNote(s)}</p>}
      </Section>
      <Section title="What's on">
        <KeyValueList variant="rows" items={scheduleRows(s, tz, now)} />
        {s.calendarSync === "not_public" && !gone && (
          <p className="nd-src__note">
            This Google Sheet isn't public, so it can't be read: what it listed before stays. {NOT_PUBLIC_HELP.replace("check it again", "it's read again within the hour")}
          </p>
        )}
        {guideProblem(s) && !gone && <p className="nd-src__note">{guideProblem(s)}</p>}
        {s.calendarSync === "no_event_data" && s.schedule?.source !== "manual" && !gone && (
          <p className="nd-src__note">
            {NO_EVENT_DATA}{" "}
            {onEnterByHand ? (
              <Button variant="text" size="sm" onClick={onEnterByHand}>
                Enter the schedule by hand instead.
              </Button>
            ) : (
              "Enter the schedule by hand instead."
            )}
          </p>
        )}
      </Section>
      <Section title="Right now">
        {gone ? (
          <KeyValueList variant="rows" items={[{ title: "Not checked, and its schedule isn't read", detail: "It's off the dial, the guide, search and the swipe order. Its records are kept" }]} />
        ) : (
          <KeyValueList variant="rows" items={[{ title: right.text === "Not on the dial" ? "Not checked while it's off the dial" : right.text, detail: right.detail ? `${right.detail}. ${checked}` : checked }]} />
        )}
      </Section>
      <Section title="History">
        {outages.error ? (
          <ErrorLine error={outages.error} />
        ) : outages.data && !outages.data.length ? (
          <p className="nd-src__note">No outages in the last 90 days.</p>
        ) : (
          <ul className="nd-src__history" aria-label="Outages">
            {(outages.data ?? []).map((o) => {
              const w = outageWords(o, tz);
              return (
                <li key={o.id}>
                  <span className="nd-src__when">{w.when}</span>
                  <span>{w.text}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Section title="Changes">
        {changes.error ? (
          <ErrorLine error={changes.error} />
        ) : changes.data && !changes.data.length ? (
          <p className="nd-src__note">No changes since it was listed.</p>
        ) : (
          <ul className="nd-src__history" aria-label="Changes">
            {(changes.data ?? []).map((c) => {
              const w = changeWords(c, tz);
              return (
                <li key={c.id}>
                  <span className="nd-src__when">{w.when}</span>
                  <span className="nd-src__change">{w.text}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      {!gone && onRemove && (
        <Section title="Off the dial for good">
          <p className="nd-src__note nd-src__off">
            It leaves the dial, the guide and search at once, and its checks stop. Its records are kept, and it can be put back on the list.
          </p>
          <Button variant="ghost" size="sm" onClick={onRemove}>
            Take off the dial for good
          </Button>
        </Section>
      )}
    </Modal>
  );
}
