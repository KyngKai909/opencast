// 05.1 City streams and the catalog: the public streams listed on the market's dial (listed, not
// restreamed), whether their calendar syncs and their terms allow embedding; and Opencast's own
// catalog station, from the board.

import { useSearchParams } from "react-router";
import { networkApi, type ListedSource } from "@opencast/contracts";
import { Button, ControlTitle, KeyValueList, Lines, Table, type Column } from "@opencast/ui";
import { useApi } from "../../api/hooks";
import { MarketBoardX } from "../api/ext";
import { controlHref } from "../components/board/SlotDetail";
import { ListSource } from "../components/listed/ListSource";
import { channelText, embeddingCell, listingsCell } from "../components/listed/SourceStatus";
import { useMarket } from "../layout/market";
import { ErrorLine, NotFound, Quiet, SecTop } from "./common";
import "./Listed.css";

/** Listed first, by channel; then the ones not on the dial yet, by name. */
export function listedOrder(rows: readonly ListedSource[]): ListedSource[] {
  const n = (s: ListedSource) => (channelText(s) ? Number(s.station.channel) : Infinity);
  return [...rows].sort((a, b) => n(a) - n(b) || a.name.localeCompare(b.name));
}

export default function Listed() {
  const { market, loading } = useMarket();
  const [params, setParams] = useSearchParams();
  const sources = useApi(networkApi.listListedSources, { query: { marketId: market?.id } }, { enabled: !!market });
  const tv = useApi(networkApi.getBoard, { params: { marketSlug: market?.slug ?? "" }, query: { band: "tv" } }, { schema: MarketBoardX, enabled: !!market });
  if (loading || sources.isLoading) return <Quiet />;
  if (!market) return <NotFound />;
  if (sources.error) return <ErrorLine error={sources.error} />;
  const catalog = tv.data?.slots.find((s) => s.state === "catalog")?.stations[0];
  const columns: Column<ListedSource>[] = [
    { key: "source", header: "Source", cell: (s) => <Lines title={s.name} detail={s.description} /> },
    { key: "channel", header: "Channel", width: "150px", cell: (s) => (channelText(s) ? <span className="nd-mono nd-listed__ch">{channelText(s)}</span> : <span className="nd-ok__quiet">Not listed</span>) },
    { key: "listings", header: "Listings", width: "170px", cell: listingsCell },
    { key: "embedding", header: "Embedding", width: "110px", cell: embeddingCell }
  ];
  const adding = params.get("add") === "1";
  return (
    <>
      <ControlTitle
        title="Listed sources"
        description={`Public streams on the ${market.name} dial. Viewers get the source's own player.`}
        end={
          <Button variant="primary" size="sm" icon="plus" onClick={() => setParams((p) => (p.set("add", "1"), p))}>
            List a source
          </Button>
        }
      />
      {sources.data?.length ? (
        <Table label="Listed sources" columns={columns} rows={listedOrder(sources.data)} rowKey={(s) => s.id} rowPadding={11} className="nd-listed" />
      ) : (
        <p className="nd-listed__empty">No public streams listed in the {market.name} yet.</p>
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
      {adding && <ListSource market={market} onClose={() => setParams((p) => (p.delete("add"), p), { replace: true })} />}
    </>
  );
}
