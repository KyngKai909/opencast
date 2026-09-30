// desk-catalog 01, the shelf: Opencast's own programs, offered free to every station. How much there
// is and how much airs, then each series with where its rights come from, its episodes, who carries
// it and its state. "Add an item" starts the rights check (03); a row opens the series (02).
import { useSearchParams, useNavigate } from "react-router";
import { catalogShelfApi, type ShelfSeriesRow } from "@opencast/contracts";
import { Button, ControlTitle, StatRow, Table, Tag, TitleCard, type Column } from "@opencast/ui";
import { useApi } from "../../api/hooks";
import { useMarket } from "../layout/market";
import { episodesCell, seriesLine, shelfStats, stateTag } from "../components/shelf/shelf";
import { AddItem, NewSeries } from "../components/shelf/ShelfForms";
import { ErrorLine, Quiet } from "./common";
import { deskPath } from "../../areas";
import "./Held.css";
import "./Catalog.css";

export default function Catalog() {
  const { slug } = useMarket();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const shelf = useApi(catalogShelfApi.getShelf, {});
  if (shelf.isLoading) return <Quiet />;
  if (shelf.error || !shelf.data) return <ErrorLine error={shelf.error} />;
  const s = shelf.data;
  const open = (k: string) => setParams((p) => (p.set(k, "1"), p));
  const close = (k: string) => setParams((p) => (p.delete(k), p), { replace: true });
  const columns: Column<ShelfSeriesRow>[] = [
    { key: "card", header: <span className="oc-sr-only">Title card</span>, width: "112px", cell: (r) => <TitleCard colour={r.colour ?? "#33507A"} title={r.title} decorative /> },
    {
      key: "series",
      header: "Series",
      cell: (r) => (
        <div className={`nd-cat__series${r.state === "coming" ? " nd-cat__coming" : ""}`}>
          <b>{r.title}</b>
          <small>{seriesLine(r)}</small>
        </div>
      )
    },
    {
      key: "basis",
      header: "Rights basis",
      width: "190px",
      cell: (r) => (
        <div className="nd-cat__basis">
          {r.basisLabel}
          {r.basisNote && <small>{r.basisNote}</small>}
        </div>
      )
    },
    {
      key: "episodes",
      header: "Episodes",
      width: "110px",
      align: "end",
      cell: (r) => {
        const e = episodesCell(r);
        return (
          <span className="nd-cat__m">
            {e.value}
            {e.of && <small>{e.of}</small>}
          </span>
        );
      }
    },
    {
      key: "carriers",
      header: "Carried by",
      width: "110px",
      align: "end",
      cell: (r) => (
        <span className="nd-cat__m">
          {r.carriers}
          {r.carriers ? <small> {r.carriers === 1 ? "station" : "stations"}</small> : null}
        </span>
      )
    },
    {
      key: "state",
      header: "State",
      width: "150px",
      align: "end",
      cell: (r) => {
        const t = stateTag(r);
        return <Tag variant={t.variant}>{t.text}</Tag>;
      }
    }
  ];
  return (
    <>
      <ControlTitle
        title="Catalog"
        description="Opencast's own programs, offered free to every station. Made possible by Clear."
        end={
          s.canEdit ? (
            <>
              <Button size="sm" onClick={() => open("series")}>
                New series
              </Button>
              <Button variant="primary" size="sm" icon="plus" onClick={() => open("add")}>
                Add an item
              </Button>
            </>
          ) : undefined
        }
      />
      <StatRow size="sm" className="nd-cov" stats={shelfStats(s)} />
      {s.series.length ? (
        <Table
          label="Catalog series"
          columns={columns}
          rows={s.series}
          rowKey={(r) => r.id}
          rowPadding={11}
          gap={14}
          className="nd-cat"
          onSelect={(r) => navigate(deskPath(`/markets/${slug}/catalog/series/${r.id}`))}
        />
      ) : (
        <p className="nd-cat__empty">Nothing on the shelf yet. Add a series, then its first item.</p>
      )}
      <p className="nd-cat-notes">
        Works published in {s.publicDomain.cutoffYear} or earlier are public domain in the US; sound recordings published in {s.publicDomain.soundRecordingsCutoffYear} or earlier. Both move every January 1 (Settings, Rules).
      </p>
      {params.get("add") === "1" && <AddItem series={s.series} marketSlug={slug} onClose={() => close("add")} />}
      {params.get("series") === "1" && <NewSeries onClose={() => close("series")} />}
    </>
  );
}
