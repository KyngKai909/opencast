// 05.1 External sources and the catalog (reworked in follow-up Phase 6): the stations on the
// market's dial that play the source's own stream, each with how it plays and why it may, where
// "what's on" comes from, and whether its stream is up right now (hidden from the dial while it's
// down); and Opencast's own catalog station, from the board. ?source=<id> opens a listing's details
// and history; ?add=1 opens List a source, and ?add=1&lead=<creatorId> fills it from a pipeline lead.
// A215: a listing's details offer Change and Take off the dial for good; ?show=removed lists the ones
// taken off the dial, each with Put back on the list.

import { useState } from "react";
import { useSearchParams } from "react-router";
import { type ListedSource, networkApi } from "@opencast/contracts";
import { Button, ControlTitle, KeyValueList, Lines, Segmented, Table, type Column } from "@opencast/ui";
import { useApi } from "../../api/hooks";
import { DEFAULT_TZ, useNow } from "../../lib/clock";
import { controlHref } from "../components/board/SlotDetail";
import { needsEvidence, PLAYS_LABELS, playsOf, removedWords } from "../components/listed/external";
import { ListSource } from "../components/listed/ListSource";
import { RemoveListing, RestoreListing } from "../components/listed/OffTheDial";
import { RecordEvidence } from "../components/listed/RecordEvidence";
import { SourceDetails } from "../components/listed/SourceDetails";
import { channelCell, channelText, nowCell, playsCell, scheduleCell, sourceCell } from "../components/listed/SourceStatus";
import { useMarket } from "../layout/market";
import { ErrorLine, NotFound, Quiet, SecTop } from "./common";
import "./Listed.css";

/** On the dial first, by channel; then the ones not on the dial, by name. */
export function listedOrder(rows: readonly ListedSource[]): ListedSource[] {
  const n = (s: ListedSource) => (channelText(s) ? Number(s.station.channel) : Infinity);
  return [...rows].sort((a, b) => n(a) - n(b) || a.name.localeCompare(b.name));
}

/** A dialog over the page; `source` when it opens with a listing just saved (before the list is read again). */
type Dialog = { kind: "record" | "change" | "remove" | "restore"; id: string; source?: ListedSource; byHand?: boolean } | null;

export default function Listed() {
  const { market, loading } = useMarket();
  const [params, setParams] = useSearchParams();
  const now = useNow(60_000);
  const [dialog, setDialog] = useState<Dialog>(null);
  const showRemoved = params.get("show") === "removed";
  const sources = useApi(networkApi.listListedSources, { query: { marketId: market?.id } }, { enabled: !!market });
  const removed = useApi(networkApi.listListedSources, { query: { marketId: market?.id, show: "removed" } }, { enabled: !!market });
  const tv = useApi(networkApi.getBoard, { params: { marketSlug: market?.slug ?? "" }, query: { band: "tv" } }, { enabled: !!market });
  const leadId = params.get("lead");
  const creators = useApi(networkApi.listCreators, { query: { marketId: market?.id } }, { enabled: !!market && !!leadId });
  if (loading || sources.isLoading) return <Quiet />;
  if (!market) return <NotFound />;
  if (sources.error) return <ErrorLine error={sources.error} />;
  const tz = market.timezone || DEFAULT_TZ;
  const catalog = tv.data?.slots.find((s) => s.state === "catalog")?.stations[0];
  const columns: Column<ListedSource>[] = [
    { key: "source", header: "Source", cell: sourceCell },
    { key: "channel", header: "Channel", width: "96px", cell: channelCell },
    { key: "plays", header: "How it plays", width: "180px", cell: (s) => playsCell(s, tz) },
    { key: "schedule", header: "What's on", width: "190px", cell: scheduleCell },
    { key: "now", header: "Right now", width: "150px", cell: (s) => nowCell(s, now) }
  ];
  const removedColumns: Column<ListedSource>[] = [
    { key: "source", header: "Source", cell: sourceCell },
    { key: "was", header: "Was on", width: "110px", cell: (s) => <span className="nd-mono nd-listed__ch">{[s.removed?.channel, s.station.callSign].filter(Boolean).join(" ") || "None"}</span> },
    { key: "plays", header: "How it played", width: "150px", cell: (s) => <Lines className="nd-tier" title={PLAYS_LABELS[playsOf(s)]} detail={null} /> },
    {
      key: "off",
      header: "Taken off",
      width: "230px",
      cell: (s) => {
        const w = removedWords(s, tz, now);
        return w ? <Lines title={w.text} detail={w.detail} /> : null;
      }
    },
    {
      key: "back",
      header: "",
      width: "170px",
      align: "end",
      cell: (s) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            setDialog({ kind: "restore", id: s.id });
          }}
        >
          Put back on the list
        </Button>
      )
    }
  ];
  const rows = listedOrder(sources.data ?? []);
  const gone = removed.data ?? [];
  const all = [...rows, ...gone];
  const chosen = all.find((s) => s.id === params.get("source")) ?? null;
  const dialogFor = dialog ? (dialog.source ?? all.find((s) => s.id === dialog.id) ?? null) : null;
  const closeDialog = () => setDialog(null);
  const lead = leadId ? creators.data?.find((c) => c.id === leadId) : undefined;
  // With a lead, the form waits for it so it opens filled in.
  const adding = params.get("add") === "1" && (!leadId || !creators.isLoading);
  const closeAdd = () =>
    setParams(
      (p) => {
        p.delete("add");
        p.delete("lead");
        return p;
      },
      { replace: true }
    );
  const select = (id: string | null) => setParams((p) => (id ? p.set("source", id) : p.delete("source"), p), { replace: true });
  const show = (v: "listed" | "removed") => setParams((p) => (v === "removed" ? p.set("show", "removed") : p.delete("show"), p.delete("source"), p), { replace: true });
  return (
    <>
      <ControlTitle
        title="External sources"
        description={`Stations on the ${market.name} dial that play the source's own stream. No playout, no spots.`}
        end={
          <>
            {(gone.length > 0 || showRemoved) && (
              <Segmented
                label="Show"
                size="sm"
                value={showRemoved ? "removed" : "listed"}
                onChange={show}
                options={[
                  { value: "listed", label: "On the list" },
                  { value: "removed", label: `Taken off the dial${gone.length ? ` (${gone.length})` : ""}` }
                ]}
              />
            )}
            <Button variant="primary" size="sm" icon="plus" onClick={() => setParams((p) => (p.set("add", "1"), p))}>
              List a source
            </Button>
          </>
        }
      />
      {showRemoved ? (
        gone.length ? (
          <Table label="Taken off the dial" columns={removedColumns} rows={gone} rowKey={(s) => s.id} rowPadding={11} className="nd-listed" selectedKey={chosen?.id} onSelect={(s) => select(s.id)} />
        ) : (
          <p className="nd-listed__empty">Nothing in the {market.name} has been taken off the dial.</p>
        )
      ) : rows.length ? (
        <Table label="External sources" columns={columns} rows={rows} rowKey={(s) => s.id} rowPadding={11} className="nd-listed" selectedKey={chosen?.id} onSelect={(s) => select(s.id)} />
      ) : (
        <p className="nd-listed__empty">No external stations in the {market.name} yet.</p>
      )}
      <SecTop title="Opencast catalog station" />
      {catalog ? (
        <KeyValueList
          variant="rows"
          items={[
            {
              title: `${catalog.channel} ${catalog.callSign}, ${catalog.name}`,
              detail: "Filled entirely from the catalog. Made possible by Clear. Also offered to every station for carriage",
              actions: (
                <Button size="sm" href={controlHref(catalog.callSign)} target="_blank" rel="noopener">
                  Open in master control
                </Button>
              )
            },
            { title: `When a local station is ready for ${catalog.channel}`, detail: "The catalog station moves to a free channel so the number can go to someone local" }
          ]}
        />
      ) : (
        <p className="nd-listed__empty">No catalog station in the {market.name} yet.</p>
      )}
      {chosen && !dialogFor && (
        <SourceDetails
          key={chosen.id}
          source={chosen}
          timeZone={tz}
          onClose={() => select(null)}
          onRecord={() => setDialog({ kind: "record", id: chosen.id })}
          onChange={() => setDialog({ kind: "change", id: chosen.id })}
          onEnterByHand={() => setDialog({ kind: "change", id: chosen.id, byHand: true })}
          onRemove={() => setDialog({ kind: "remove", id: chosen.id })}
          onRestore={() => setDialog({ kind: "restore", id: chosen.id })}
        />
      )}
      {dialog?.kind === "record" && dialogFor && <RecordEvidence source={dialogFor} onClose={closeDialog} />}
      {dialog?.kind === "change" && dialogFor && (
        <ListSource
          market={market}
          listings={rows}
          editing={dialogFor}
          startByHand={dialog.byHand}
          onClose={closeDialog}
          // Saved and now waiting for its evidence: straight on to recording it.
          onSaved={(saved) => (needsEvidence(saved) ? setTimeout(() => setDialog({ kind: "record", id: saved.id, source: saved })) : undefined)}
        />
      )}
      {dialog?.kind === "remove" && dialogFor && (
        <RemoveListing
          source={dialogFor}
          timeZone={tz}
          onClose={closeDialog}
          onRemoved={() => {
            closeDialog();
            select(null);
          }}
        />
      )}
      {dialog?.kind === "restore" && dialogFor && (
        <RestoreListing
          source={dialogFor}
          removed={gone}
          timeZone={tz}
          onClose={closeDialog}
          onRestored={() => {
            closeDialog();
            show("listed");
          }}
        />
      )}
      {adding && (
        <ListSource
          market={market}
          listings={rows}
          onClose={closeAdd}
          prefill={lead?.lead ? { name: lead.displayName, description: lead.description ?? undefined, streamUrl: lead.lead.streamUrl, plays: "stream_link", creatorId: lead.id } : undefined}
        />
      )}
    </>
  );
}
