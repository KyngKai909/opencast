// desk-pages 01, Rights claims: every claim on every station, and what's due next. Opencast's side
// of the rights system stations see in master control. The figures, then Open / Closed / By
// station. Open and Closed list each claim with its station, program, claimant, state, next
// deadline and carriers; selecting one shows its timeline, where it reached, the evidence, a way to
// write to the station, and (rights reviewers and admins) the outcome. A market lead sees their own
// markets' claims. ?tab=closed|stations picks the tab; ?claim=<id> the claim.

import { useState } from "react";
import { useSearchParams } from "react-router";
import { trustApi, type DeskClaim, type DeskClaims, type DeskClaimStation } from "@opencast/contracts";
import { Button, ChoiceList, ControlTitle, KeyValueList, Lines, Modal, Segmented, StatRow, Table, Tag, Timeline, useToast, type Column } from "@opencast/ui";
import { ApiError } from "../../api/client";
import { useApi, useApiMutation } from "../../api/hooks";
import { DEFAULT_TZ, useNow } from "../../lib/clock";
import {
  basisWords,
  callSignOf,
  carrierLine,
  claimLine,
  claimStats,
  messageHref,
  nextText,
  outcomeChoices,
  outcomeToast,
  paneNote,
  programLine,
  shortDayTime,
  stateTag,
  stationLabel,
  standingTag,
  timelineItems
} from "../components/claims/claims";
import { ErrorLine, errorText, Quiet } from "./common";
import { deskPath } from "../../areas";
import "./Catalog.css";
import "./Claims.css";

type Tab = "open" | "closed" | "stations";
const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "stations", label: "By station" }
];

export default function Claims() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "closed" ? "closed" : params.get("tab") === "stations" ? "stations" : "open";
  const list = useApi(trustApi.listDeskClaims, {});
  const setTab = (t: Tab) =>
    setParams((p) => {
      if (t === "open") p.delete("tab");
      else p.set("tab", t);
      p.delete("claim");
      return p;
    });
  return (
    <>
      <ControlTitle title="Rights claims" description="Claims against programs on any station, and the answers." end={<Segmented label="Show" size="sm" options={TABS} value={tab} onChange={setTab} />} />
      {list.isLoading ? <Quiet /> : list.error || !list.data ? <ErrorLine error={list.error} /> : <ClaimsBody d={list.data} tab={tab} />}
    </>
  );
}

function ClaimsBody({ d, tab }: { d: DeskClaims; tab: Tab }) {
  return (
    <>
      <StatRow size="sm" className="nd-cov" stats={claimStats(d)} />
      {tab === "stations" ? <ByStation d={d} /> : <ClaimList d={d} phase={tab} />}
    </>
  );
}

function ClaimList({ d, phase }: { d: DeskClaims; phase: "open" | "closed" }) {
  const [params, setParams] = useSearchParams();
  const tz = DEFAULT_TZ;
  const rows = d.claims.filter((c) => c.phase === phase);
  const chosen = rows.find((c) => c.id === params.get("claim")) ?? rows[0] ?? null;
  const columns: Column<DeskClaim>[] = [
    { key: "sw", header: <span className="oc-sr-only">Station colour</span>, width: "6px", cell: (c) => <span className="nd-claims__sw" style={{ background: c.station.colour ?? "var(--ink-30)" }} aria-hidden="true" /> },
    { key: "claim", header: "Program and claim", cell: (c) => <Lines title={programLine(c)} detail={claimLine(c)} /> },
    {
      key: "state",
      header: "State",
      width: "150px",
      cell: (c) => {
        const t = stateTag(c);
        return <Tag variant={t.variant}>{t.text}</Tag>;
      }
    },
    { key: "next", header: "Next", width: "176px", cell: (c) => <span className="nd-claims__due">{nextText(c, tz)}</span> },
    { key: "carriers", header: "Carriers", width: "72px", align: "end", cell: (c) => <span className="nd-claims__due">{c.carriers.length}</span> }
  ];
  if (!rows.length) {
    return <p className="nd-claims__empty">{phase === "open" ? "No open claims. When a rights holder files one, it shows here with the date it's due." : "No closed claims yet."}</p>;
  }
  return (
    <div className="nd-split nd-split--wide">
      <Table
        label={phase === "open" ? "Open claims" : "Closed claims"}
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        rowPadding={11}
        gap={14}
        className="nd-claims"
        selectedKey={chosen?.id}
        onSelect={(c) =>
          setParams(
            (p) => {
              p.set("claim", c.id);
              return p;
            },
            { replace: true }
          )
        }
      />
      {chosen && <ClaimPane c={chosen} canResolve={d.canResolve} key={chosen.id} />}
    </div>
  );
}

function ClaimPane({ c, canResolve }: { c: DeskClaim; canResolve: boolean }) {
  const now = useNow(60_000);
  const [evidence, setEvidence] = useState(false);
  const [outcome, setOutcome] = useState(false);
  const cs = callSignOf(c.station);
  const mail = messageHref(c);
  return (
    <aside className="nd-pane nd-claims__pane" aria-labelledby="nd-claim-h">
      <h2 className="nd-claims__h" id="nd-claim-h">
        {c.item.title}
      </h2>
      <p className="nd-claims__sub">
        {stationLabel(c.station)}
        {c.kind === "privacy" ? ". Privacy, not copyright" : ""}
      </p>
      <Timeline items={timelineItems(c, DEFAULT_TZ, now)} whenWidth={112} className="nd-claims__tl" />
      {c.carriers.length > 0 && (
        <>
          <h3 className="nd-claims__h3">Carriers</h3>
          <ul className="nd-claims__carriers" aria-label="Carriers">
            {c.carriers.map((k) => (
              <li key={k.station.id}>
                <span className="nd-claims__cs">{stationLabel(k.station)}</span>
                <span className="nd-claims__cl">{carrierLine(k)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="nd-claims__acts">
        <Button variant="ghost" size="sm" onClick={() => setEvidence(true)}>
          See evidence
        </Button>
        {mail ? (
          <Button variant="ghost" size="sm" href={mail}>
            Message {cs}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled>
            Message {cs}
          </Button>
        )}
        {canResolve && c.phase === "open" && (
          <Button variant="ghost" size="sm" onClick={() => setOutcome(true)}>
            Record the outcome
          </Button>
        )}
      </div>
      <p className="nd-claims__note">{paneNote(c)}</p>
      {evidence && <Evidence c={c} onClose={() => setEvidence(false)} />}
      {outcome && <Outcome c={c} onClose={() => setOutcome(false)} />}
    </aside>
  );
}

function rangeText(start: number | null, end: number | null): string | null {
  if (start === null || end === null) return null;
  const t = (ms: number) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  return `${t(start)} to ${t(end)}`;
}

function Evidence({ c, onClose }: { c: DeskClaim; onClose: () => void }) {
  const range = rangeText(c.rangeStartMs, c.rangeEndMs);
  const files = c.attachments.length ? c.attachments : c.answer?.attachmentUrl ? [{ fileName: "The file attached to the answer", url: c.answer.attachmentUrl }] : [];
  const items = [
    { label: "From", value: c.claimantRole ? `${c.claimantName}. ${c.claimantRole}` : c.claimantName },
    { label: "Their contact", value: c.claimantContact },
    { label: "Received", value: shortDayTime(c.receivedAt, DEFAULT_TZ) },
    { label: "What's claimed", value: [range, c.workKind].filter(Boolean).join(", ") || "Not said" },
    { label: "Sworn statement", value: c.swornStatement ? "Included, as the law requires" : "Not included" },
    ...(c.answer ? [{ label: `${callSignOf(c.station)}'s answer`, value: c.answer.note ? `${basisWords(c.answer.basis)}. ${c.answer.note}` : basisWords(c.answer.basis) }] : []),
    ...(files.length
      ? [
          {
            label: files.length === 1 ? "File" : "Files",
            value: (
              <span className="nd-claims__files">
                {files.map((f) => (
                  <a key={f.url} href={f.url} target="_blank" rel="noopener">
                    {f.fileName}
                  </a>
                ))}
              </span>
            )
          }
        ]
      : [])
  ];
  return (
    <Modal
      open
      onClose={onClose}
      width={520}
      title="Evidence"
      subtitle={programLine(c)}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <blockquote className="nd-claims__quote">"{c.claimText}"</blockquote>
      <KeyValueList items={items} />
    </Modal>
  );
}

function Outcome({ c, onClose }: { c: DeskClaim; onClose: () => void }) {
  const toast = useToast();
  const resolve = useApiMutation(trustApi.resolveClaim, { invalidates: [trustApi.listDeskClaims] });
  const [choice, setChoice] = useState<"upheld" | "withdrawn" | "restored" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!choice) return setError("Choose what happened.");
    setError(null);
    try {
      await resolve.mutateAsync({ params: { claimId: c.id }, body: { outcome: choice } });
      toast.show({ message: outcomeToast(c, choice) });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : errorText(e));
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={520}
      title="Record the outcome"
      subtitle={programLine(c)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={resolve.isPending}>
            Record it
          </Button>
        </>
      }
    >
      <ChoiceList label="What happened" options={outcomeChoices(c)} value={choice} onChange={setChoice} />
      {error && (
        <p className="nd-form__error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

function ByStation({ d }: { d: DeskClaims }) {
  const limit = d.rules.repeatLimit;
  const columns: Column<DeskClaimStation>[] = [
    { key: "sw", header: <span className="oc-sr-only">Station colour</span>, width: "6px", cell: (s) => <span className="nd-claims__sw" style={{ background: s.station.colour ?? "var(--ink-30)" }} aria-hidden="true" /> },
    { key: "station", header: "Station", cell: (s) => <Lines title={stationLabel(s.station)} detail={s.station.name} /> },
    { key: "open", header: "Open", width: "70px", align: "end", cell: (s) => <span className="nd-claims__due">{s.open}</span> },
    { key: "closed", header: "Closed", width: "70px", align: "end", cell: (s) => <span className="nd-claims__due">{s.closed}</span> },
    { key: "upheld", header: "Upheld in 12 months", width: "160px", align: "end", cell: (s) => <span className="nd-claims__due">{`${s.upheldLast12Months} of ${limit}`}</span> },
    {
      key: "standing",
      header: "Standing",
      width: "200px",
      align: "end",
      cell: (s) => {
        const t = standingTag(s);
        return <Tag variant={t.variant}>{t.text}</Tag>;
      }
    }
  ];
  return (
    <>
      {d.stations.length ? (
        <Table label="Claims by station" columns={columns} rows={d.stations} rowKey={(s) => s.station.id} rowPadding={11} gap={14} className="nd-claims" />
      ) : (
        <p className="nd-claims__empty">No station has had a claim.</p>
      )}
      <p className="nd-claims__foot">
        Stations with upheld claims are counted against the repeat-infringer policy: {limit} upheld {limit === 1 ? "claim" : "claims"} in 12 months pauses a station's carriage offers. Privacy complaints
        don't count. The number is set in <a href={deskPath("/settings/rules")}>Settings</a>.
      </p>
    </>
  );
}
