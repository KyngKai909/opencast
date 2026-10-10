// Programming Phase 6, network licences (no frame draws it; it follows the catalog's shelf): what
// Opencast licenses from distributors, ending soonest first, each with what it covers, where it can
// air, where in the world and until when. "New licence" for rights reviewers and admins; a row opens
// the licence and its monthly minutes. Reached from the Catalog page.
import { useNavigate, useSearchParams } from "react-router";
import { licencesApi, type NetworkLicence } from "@opencast/contracts";
import { Button, ControlTitle, Table, Tag, type Column } from "@opencast/ui";
import { useApi } from "../../api/hooks";
import { useMarket } from "../layout/market";
import { coversLine, datesLine, dealLine, outletsLine, stateTag, territoryLine } from "../components/licences/licences";
import { LicenceForm } from "../components/licences/LicenceForm";
import { Crumb, ErrorLine, Quiet } from "./common";
import { deskPath } from "../../areas";
import "./Licences.css";

export default function Licences() {
  const navigate = useNavigate();
  const { slug } = useMarket();
  const [params, setParams] = useSearchParams();
  const licences = useApi(licencesApi.listLicences, {});
  if (licences.isLoading) return <Quiet />;
  if (licences.error || !licences.data) return <ErrorLine error={licences.error} />;
  const columns: Column<NetworkLicence>[] = [
    {
      key: "licensor",
      header: "Licensor",
      cell: (l) => (
        <div>
          <b>{l.licensor}</b>
          <small>{[l.name, coversLine(l)].filter(Boolean).join(". ")}</small>
        </div>
      )
    },
    { key: "outlets", header: "Where it can air", width: "230px", cell: (l) => <span>{outletsLine(l.outlets)}</span> },
    { key: "territory", header: "Territory", width: "120px", cell: (l) => <span className="nd-lic__m">{territoryLine(l)}</span> },
    {
      key: "dates",
      header: "Dates",
      width: "210px",
      cell: (l) => (
        <div>
          <span>{datesLine(l)}</span>
          <small>{dealLine(l.deal)}</small>
        </div>
      )
    },
    {
      key: "state",
      header: "State",
      width: "140px",
      align: "end",
      cell: (l) => {
        const t = stateTag(l);
        return <Tag variant={t.variant}>{t.text}</Tag>;
      }
    }
  ];
  return (
    <>
      <Crumb href={deskPath(`/markets/${slug}/catalog`)} label="Catalog" here="Network licences" />
      <ControlTitle
        title="Network licences"
        description="What Opencast licenses from distributors: where it can air, and until when."
        end={
          <Button variant="primary" size="sm" icon="plus" onClick={() => setParams((p) => (p.set("new", "1"), p))}>
            New licence
          </Button>
        }
      />
      {licences.data.length ? (
        <Table label="Network licences" columns={columns} rows={licences.data} rowKey={(l) => l.id} rowPadding={11} gap={14} className="nd-lic" onSelect={(l) => navigate(deskPath(`/licences/${l.id}`))} />
      ) : (
        <p className="nd-lic__empty">No licences yet. Add one when a distributor's catalog comes onto the shelf.</p>
      )}
      <p className="nd-lic__note">Anything a licence covers is off the air once it ends. Stations airing it see a warning on their log from two weeks before.</p>
      {params.get("new") === "1" && <LicenceForm licence={null} onClose={() => setParams((p) => (p.delete("new"), p), { replace: true })} />}
    </>
  );
}
