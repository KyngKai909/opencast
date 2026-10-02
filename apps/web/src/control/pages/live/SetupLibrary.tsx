// A.2 Library, setup step 2 (/setup/:stationId/library), with A.3 "Can BEAT air Crate Session
// 03?" as a pane over it (?rights=:itemId). Continue always works (changed 2026-09-29): any setup
// step can be passed, and only signing on checks what's needed. Without a station ID of its own,
// the station airs a generated one, shown here as a read-only row.

import { useNavigate, useParams, useSearchParams } from "react-router";
import { libraryApi, stationsApi } from "@opencast/contracts";
import { Button, ControlFoot, ControlTitle } from "@opencast/ui";
import { useApi } from "../../../api/hooks";
import { useIsPhone } from "../../layout/shell";
import { useMyStations } from "../../station/StationContext";
import { GeneratedStationIdRow, LibrarySummary, LibraryTable, RightsPane, UploadDrop } from "../../components/live/LibraryParts";
import { Quiet } from "../common";
import "./SetupLibrary.css";
import { controlPath } from "../../../areas";

export default function SetupLibrary() {
  const { stationId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const setup = useApi(stationsApi.getSetup, { params: { stationId } }, { retry: false });
  const mine = useMyStations().find((m) => m.station.id === stationId);
  const lib = useApi(
    libraryApi.getLibrary,
    { params: { stationId }, query: {} },
    { refetchInterval: (q) => (q.state.data?.items.some((i) => i.status === "preparing") ? 2000 : false) }
  );
  if (setup.isLoading || lib.isLoading) return <Quiet />;
  const st = setup.data?.station ?? mine?.station;
  const name = st?.callSign ?? st?.name ?? "your station";
  const items = lib.data?.items ?? [];
  const rightsItem = items.find((i) => i.id === params.get("rights")) ?? null;
  const generated = lib.data?.generatedStationId ?? null;
  const colour = st?.colour ?? "#8C3B7A";

  return (
    <div className="cc-setup-lib">
      <ControlTitle
        title="Library"
        description={
          <span className="cc-setup-lib__lede">
            Everything {name} can put on air. Each item is prepared for air when it arrives, and each needs its type set and its rights confirmed.
          </span>
        }
      />
      <UploadDrop stationId={stationId} />
      {lib.isError && <p role="alert">{lib.error.message}</p>}
      {items.length > 0 && <LibrarySummary items={items} />}
      <LibraryTable
        items={items}
        colour={colour}
        label="Library"
        onRights={(i) => setParams((p) => (p.set("rights", i.id), p))}
        empty="Nothing here yet. Drop your first programs and a station ID above."
      />
      {generated && <GeneratedStationIdRow generated={generated} callSign={name} colour={colour} radio={st?.band === "radio"} phone={phone} />}
      <ControlFoot note="Signing on needs at least one program on the log. Without a station ID of your own, the generated one airs.">
        <Button href={controlPath(`/setup/${stationId}/station`)}>Back</Button>
        <Button variant="primary" onClick={() => navigate(controlPath(`/setup/${stationId}/log`))}>
          Continue to program log
        </Button>
      </ControlFoot>
      <RightsPane item={rightsItem} callSign={name} phone={phone} onClose={() => setParams((p) => (p.delete("rights"), p), { replace: true })} />
    </div>
  );
}
