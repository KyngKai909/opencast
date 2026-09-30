// desk-catalog 02, a series and its items: its episodes and, inside each, the items it's built from
// (year, rights basis, length, who checked it). An item that fails comes out of every episode it's
// in and those episodes are rebuilt; the note says so. On the right: the offer and what was rebuilt.
// Below: every item with its check, and Add an item.
import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { catalogShelfApi, type EpisodeView, type ShelfItemRow } from "@opencast/contracts";
import { Button, ControlTitle, KeyValueList, Table, Tag, duration, useToast, type Column } from "@opencast/ui";
import { useApi, useApiMutation } from "../../api/hooks";
import { useMarket } from "../layout/market";
import { DEFAULT_TZ } from "../../lib/clock";
import { dayMonth } from "../lib/dates";
import { checkedBy, episodeSub, itemTag, rebuildWords, removalNote, seriesDescription } from "../components/shelf/shelf";
import { AddItem, EpisodeEditor } from "../components/shelf/ShelfForms";
import { Crumb, ErrorLine, errorText, NotFound, Quiet, SecTop } from "./common";
import { deskPath } from "../../areas";
import "./Catalog.css";

type EpItem = EpisodeView["items"][number];

export default function CatalogSeries() {
  const { seriesId = "" } = useParams();
  const { slug } = useMarket();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const series = useApi(catalogShelfApi.getSeries, { params: { seriesId } });
  const shelf = useApi(catalogShelfApi.getShelf, {});
  const rebuild = useApiMutation(catalogShelfApi.rebuildEpisodes, { invalidates: [catalogShelfApi.getSeries, catalogShelfApi.getShelf] });
  const [editing, setEditing] = useState<{ number: number; current?: string[] } | null>(null);
  if (series.isLoading) return <Quiet />;
  if (series.error && (series.error as { status?: number }).status === 404) return <NotFound />;
  if (series.error || !series.data) return <ErrorLine error={series.error} />;
  const s = series.data;
  const tz = DEFAULT_TZ;
  const date = (iso: string) => dayMonth(iso, tz, { short: true });
  const chosen = Number(params.get("ep")) || s.episodes.at(-1)?.number;
  const ep = s.episodes.find((e) => e.number === chosen) ?? s.episodes[0];
  const itemHref = (id: string) => deskPath(`/markets/${slug}/catalog/items/${id}`);

  const doRebuild = async () => {
    try {
      const r = await rebuild.mutateAsync({ params: { seriesId } });
      toast.show({ message: rebuildWords(r as never, () => "Now").replace(/^Now: /, "") });
    } catch (e) {
      toast.show({ message: errorText(e) });
    }
  };

  const epColumns: Column<EpItem>[] = [
    { key: "n", header: <span className="oc-sr-only">Order</span>, width: "32px", cell: (i) => <span className="nd-it__n">{i.position ?? "–"}</span> },
    {
      key: "item",
      header: "Item",
      cell: (i) => (
        <a className={`nd-items-link nd-it__t${i.removedAt ? " nd-it--out" : ""}`} href={itemHref(i.itemId)}>
          <b>{i.title}</b>
          <small>{i.removedAt ? `${i.publishedYear ?? ""}. ${i.removedReason ?? "Taken out"}`.replace(/^\. /, "") : i.source}</small>
        </a>
      )
    },
    { key: "basis", header: "Rights basis", width: "190px", cell: (i) => <span className={i.removedAt ? "nd-it--out" : undefined}>{i.removedAt ? "Not free to air" : i.basisLine}</span> },
    { key: "len", header: "Length", width: "60px", align: "end", cell: (i) => <span className="nd-it__d">{i.lengthMs ? duration(i.lengthMs) : ""}</span> },
    { key: "checked", header: "Checked", width: "110px", cell: (i) => (i.removedAt ? <span className="nd-it__removed">Removed {date(i.removedAt)}</span> : <span className="nd-it__checked">{i.checkedBy.join(", ")}</span>) }
  ];

  const itemColumns: Column<ShelfItemRow>[] = [
    {
      key: "item",
      header: "Item",
      cell: (i) => (
        <a className="nd-items-link nd-it__t" href={itemHref(i.id)}>
          <b>{i.title}</b>
          <small>{i.source}</small>
        </a>
      )
    },
    { key: "basis", header: "Rights basis", width: "220px", cell: (i) => i.basisLine },
    { key: "checked", header: "Checked by", width: "130px", cell: (i) => <span className="nd-it__checked">{checkedBy(i) || "Not yet"}</span> },
    {
      key: "state",
      header: "Check",
      width: "130px",
      align: "end",
      cell: (i) => {
        const t = itemTag(i);
        return <Tag variant={t.variant}>{t.text}</Tag>;
      }
    }
  ];

  const note = ep ? removalNote(ep, (iso) => dayMonth(iso, tz)) : null;
  const carriers = s.offer.carriers.length || s.carriers;
  return (
    <>
      <Crumb href={deskPath(`/markets/${slug}/catalog`)} label="Catalog" here={s.title} />
      <ControlTitle
        title={s.title}
        description={seriesDescription(s)}
        end={
          s.canEdit ? (
            <Button size="sm" onClick={() => void doRebuild()} disabled={rebuild.isPending}>
              Rebuild episodes
            </Button>
          ) : undefined
        }
      />
      <div className="nd-split">
        <div>
          {ep ? (
            <>
              <SecTop title={`Episode ${ep.number}`} sub={episodeSub(ep)} first end={ep.status === "ready" ? undefined : <Tag variant="standby">{ep.status === "draft" ? "Not built yet" : ep.status === "composing" ? "Building" : "Couldn't build"}</Tag>} />
              <Table label={`Episode ${ep.number}`} columns={epColumns} rows={ep.items} rowKey={(i) => i.itemId} rowPadding={9} />
              {note && <p className="nd-note">{note}</p>}
              {s.episodes.length > 1 && (
                <nav className="nd-ep-pick" aria-label="Episodes">
                  {s.episodes.map((e) => (
                    <Button key={e.id} size="sm" variant={e.number === ep.number ? "primary" : "ghost"} aria-current={e.number === ep.number ? "true" : undefined} onClick={() => setParams((p) => (p.set("ep", String(e.number)), p), { replace: true })}>
                      {e.number}
                    </Button>
                  ))}
                </nav>
              )}
            </>
          ) : (
            <>
              <SecTop title="Episodes" first />
              <p className="nd-note">No episodes yet. Items checked by two people go into episodes.</p>
            </>
          )}
          <SecTop
            title="Items"
            sub={`${s.items.length} ${s.items.length === 1 ? "item" : "items"}, each with its own rights record`}
            end={
              s.canEdit ? (
                <>
                  <Button size="sm" onClick={() => setEditing({ number: (s.episodes.at(-1)?.number ?? 0) + 1 })}>
                    New episode
                  </Button>
                  {ep && (
                    <Button size="sm" onClick={() => setEditing({ number: ep.number, current: ep.items.filter((i) => i.position !== null).map((i) => i.itemId) })}>
                      Change episode {ep.number}
                    </Button>
                  )}
                  <Button variant="primary" size="sm" icon="plus" onClick={() => setParams((p) => (p.set("add", "1"), p))}>
                    Add an item
                  </Button>
                </>
              ) : undefined
            }
          />
          {s.items.length ? <Table label="Items" columns={itemColumns} rows={s.items} rowKey={(i) => i.id} rowPadding={9} /> : <p className="nd-note">No items yet.</p>}
        </div>
        <div className="nd-pane">
          <h4>The offer</h4>
          <KeyValueList
            items={[
              { label: "Stations pay", value: "Nothing" },
              { label: "Break time", value: "All the station's, except 1 credit an hour" },
              { label: "That credit", value: "Made possible by Clear" },
              { label: "Airings", value: "Any, no window" },
              { label: "Carried by", value: carriers ? `${carriers} ${carriers === 1 ? "station" : "stations"}${s.offer.carrierMarkets ? `, ${s.offer.carrierMarkets} ${s.offer.carrierMarkets === 1 ? "market" : "markets"}` : ""}` : s.offer.offered ? "Nobody yet" : "Not offered yet" }
            ]}
          />
          <h4 className="nd-pane__h4">Rebuilt</h4>
          {s.rebuilds.length ? (
            <ul className="nd-rebuilds">
              {s.rebuilds.slice(0, 5).map((r) => (
                <li key={r.id}>{rebuildWords(r, date)}</li>
              ))}
            </ul>
          ) : (
            <p className="nd-note">Nothing yet. An episode is rebuilt when an item in it fails, and only what changed is prepared again.</p>
          )}
          <p className="nd-note">Watch numbers are totals across stations, never one station's audience, the same as makers see.</p>
        </div>
      </div>
      {params.get("add") === "1" && <AddItem series={shelf.data?.series ?? []} seriesId={s.id} marketSlug={slug} onClose={() => setParams((p) => (p.delete("add"), p), { replace: true })} />}
      {editing && <EpisodeEditor seriesId={s.id} items={s.items} number={editing.number} current={editing.current} onClose={() => setEditing(null)} />}
    </>
  );
}
