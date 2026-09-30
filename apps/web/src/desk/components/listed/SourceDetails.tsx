// An external station's details (follow-up Phase 6; the page's row opens it, ?source=<id>): how it
// plays and the evidence it may (the terms page and the day it was checked, the written permission
// as recorded, or the public basis), where "what's on" comes from, the address it plays from, the
// stream right now, and its outages over the last 90 days. A listing waiting for its evidence offers
// Record evidence.
import type { ReactNode } from "react";
import { networkApi, type ListedSource } from "@opencast/contracts";
import { Button, KeyValueList, Modal, type KeyValueRow } from "@opencast/ui";
import { useApi } from "../../../api/hooks";
import { deskPath } from "../../../areas";
import { useNow } from "../../../lib/clock";
import { dateAtTime } from "../../lib/dates";
import { ErrorLine } from "../../pages/common";
import { needsEvidence, nowWords, outageWords, PLAYS_LABELS, playsDetail, playsOf, scheduleWords, shortDate, sourceDetail } from "./external";
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
  return [{ title: "Their permission", detail: "Not recorded yet" }];
}

function scheduleRows(s: ListedSource, tz: string): KeyValueRow[] {
  const w = scheduleWords({ ...s, waiting: null });
  const sc = s.schedule;
  const rows: KeyValueRow[] = [{ title: w.text, detail: w.detail }];
  if (sc?.source === "guide_data" && sc.checkedAgainst) {
    rows.push({ title: "Checked against", detail: <>{<Link href={sc.checkedAgainst} />}{sc.checkedOn ? `, ${shortDate(sc.checkedOn, tz)}` : ""}</> });
  }
  if (sc?.source !== "none" && s.calendarUrl) rows.push({ title: sc?.source === "guide_data" ? "Guide data address" : "Feed address", detail: <Link href={s.calendarUrl} /> });
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

export function SourceDetails({ source: s, timeZone: tz, onClose, onRecord }: { source: ListedSource; timeZone: string; onClose: () => void; onRecord: () => void }) {
  const now = useNow(60_000);
  const outages = useApi(networkApi.listExternalOutages, { params: { sourceId: s.id } });
  const ch = channelText(s);
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
      subtitle={[ch ?? "Not on the dial", sourceDetail(s)].filter(Boolean).join(". ")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {needsEvidence(s) && (
            <Button variant="primary" onClick={onRecord}>
              Record evidence
            </Button>
          )}
        </>
      }
    >
      <Section title="How it plays">
        <KeyValueList
          variant="rows"
          items={[
            { title: PLAYS_LABELS[playsOf(s)], detail: playsDetail(s, tz) || null },
            ...evidenceRows(s, tz),
            { title: playsOf(s) === "embed" ? "Their player's address" : "Stream address", detail: <span className="nd-mono nd-src__addr">{s.streamUrl}</span> }
          ]}
        />
        {held && (
          <p className="nd-src__note">
            It waits until Settings allows {held}. <a href={deskPath("/settings/rules")}>Open the rules</a>
          </p>
        )}
      </Section>
      <Section title="What's on">
        <KeyValueList variant="rows" items={scheduleRows(s, tz)} />
      </Section>
      <Section title="Right now">
        <KeyValueList variant="rows" items={[{ title: right.text === "Not on the dial" ? "Not checked while it's off the dial" : right.text, detail: right.detail ? `${right.detail}. ${checked}` : checked }]} />
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
    </Modal>
  );
}
