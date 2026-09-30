// 05.1 External sources and the catalog (reworked in follow-up Phase 6): the stations on the
// market's dial that play the source's own stream, each with how it plays and why it may, where
// "what's on" comes from, and whether its stream is up right now (hidden from the dial while it's
// down); and Opencast's own catalog station, from the board. ?source=<id> opens a listing's details
// and history; ?add=1 opens List a source, and ?add=1&lead=<creatorId> fills it from a pipeline lead.

import { useState } from "react";
import { useSearchParams } from "react-router";
import { type ListedSource, networkApi } from "@opencast/contracts";
import { Button, ControlTitle, KeyValueList, Table, type Column } from "@opencast/ui";
import { useApi } from "../../api/hooks";
import { DEFAULT_TZ, useNow } from "../../lib/clock";
import { controlHref } from "../components/board/SlotDetail";
import { ListSource } from "../components/listed/ListSource";
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

export default function Listed() {
  const { market, loading } = useMarket();
  const [params, setParams] = useSearchParams();
  const now = useNow(60_000);
  const [recording, setRecording] = useState<string | null>(null);
  const sources = useApi(networkApi.listListedSources, { query: { marketId: market?.id } }, { enabled: !!market });
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
  const rows = listedOrder(sources.data ?? []);
  const chosen = rows.find((s) => s.id === params.get("source")) ?? null;
  const recordFor = rows.find((s) => s.id === recording) ?? null;
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
  return (
    <>
      <ControlTitle
        title="External sources"
        description={`Stations on the ${market.name} dial that play the source's own stream. No playout, no spots.`}
        end={
          <Button variant="primary" size="sm" icon="plus" onClick={() => setParams((p) => (p.set("add", "1"), p))}>
            List a source
          </Button>
        }
      />
      {rows.length ? (
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
      {chosen && !recordFor && (
        <SourceDetails
          key={chosen.id}
          source={chosen}
          timeZone={tz}
          onClose={() => select(null)}
          onRecord={() => setRecording(chosen.id)}
        />
      )}
      {recordFor && <RecordEvidence source={recordFor} onClose={() => setRecording(null)} />}
      {adding && (
        <ListSource
          market={market}
          onClose={closeAdd}
          prefill={lead?.lead ? { name: lead.displayName, description: lead.description ?? undefined, streamUrl: lead.lead.streamUrl, plays: "stream_link", creatorId: lead.id } : undefined}
        />
      )}
    </>
  );
}
