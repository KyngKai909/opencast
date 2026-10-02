// A studio's Spot rotation (/:handle/spot-rotation, the studio shell; market 04.1's rail: "Money:
// Spot rotation, Earnings"). Not drawn in the reference: a studio's programs are carried under
// barter, and the break time it keeps in them is filled from this rotation. Built from the same
// rotation editor as a station's, with the market to add from underneath.

import { type MarketSpot } from "@opencast/contracts";
import { Navigate } from "react-router";
import { Button, ControlTitle, Lines, Table, Tag, useToast, type Column } from "@opencast/ui";
import { errorText, useMarket, useRotations, useSetRotation } from "../../components/spots/data";
import { milesText, rateParts, runwayParts, spotLength } from "../../components/spots/format";
import { ErrorLine, SpotThumb } from "../../components/spots/parts";
import { RotationEditor } from "../../components/spots/RotationEditor";
import { useShellOptions } from "../../layout/shell";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../common";
import "./SpotMarket.css";

export default function StudioSpotRotation() {
  const s = useStation();
  // A station's rotation is a tab of its spot market.
  if (!s.studio) return <Navigate to={`${s.base}/spot-market/rotation`} replace />;
  return <StudioRotation />;
}

function StudioRotation() {
  const s = useStation();
  const toast = useToast();
  useShellOptions({ context: "Spot rotation" });
  const rotations = useRotations(s.id);
  const market = useMarket(s.id);
  const set = useSetRotation();
  if (rotations.isLoading || market.isLoading) return <Quiet />;
  if (rotations.error || market.error) return <ErrorLine>{errorText(rotations.error ?? market.error)}</ErrorLine>;
  const main = rotations.data!.main.spots.map((x) => x.spotId);
  const canEdit = s.can("spots");
  const columns: Column<MarketSpot>[] = [
    { key: "thumb", width: "96px", cell: (m) => <SpotThumb spot={m} short /> },
    { key: "spot", header: "Spot", cell: (m) => <Lines title={m.business.name} detail={[m.spot.category, milesText(m.miles), spotLength(m.spot.lengthSec)].filter(Boolean).join(", ")} /> },
    {
      key: "rate",
      header: "Rate",
      width: "184px",
      cell: (m) => {
        const p = rateParts(m.rate);
        return <Lines className="cc-spm__rate" title={<span className="cc-sp-mono">{p.amount}</span>} detail={p.unit} />;
      }
    },
    {
      key: "budget",
      header: "Budget",
      width: "200px",
      cell: (m) => {
        const r = runwayParts(m.runway);
        return <Lines className="cc-spm__runway" title={r.main} detail={r.sub ?? undefined} />;
      }
    },
    {
      key: "act",
      header: <span className="oc-sr-only">Add</span>,
      width: "96px",
      align: "end",
      cell: (m) =>
        m.inRotation ? (
          <Tag>In rotation</Tag>
        ) : canEdit && m.state !== "paused" ? (
          <Button
            size="sm"
            disabled={set.isPending}
            aria-label={`Add ${m.business.name} to your rotation`}
            onClick={() => set.mutate({ params: { stationId: s.id, kind: "main" }, body: { spotIds: [...main, m.spot.id] } }, { onError: (e) => toast.show({ message: errorText(e) }) })}
          >
            Add
          </Button>
        ) : null
    }
  ];
  return (
    <div className="cc-spm">
      <ControlTitle title="Spot rotation" description="Spots that fill the break time you keep in programs stations carry under barter." />
      <RotationEditor stationId={s.id} rotations={rotations.data!} market={market.data!} canEdit={canEdit} studio />
      <section className="cc-spm__studio-market" aria-labelledby="cc-spm-market">
        <div className="cc-rot__head">
          <h2 id="cc-spm-market">The spot market</h2>
          <p>Businesses near you, listed spots only. Every listed spot is funded.</p>
        </div>
        {market.data!.length ? <Table label="The spot market" columns={columns} rows={market.data!} rowKey={(m) => m.spot.id} header={false} /> : <p className="cc-spm__empty">No businesses have listed spots near you yet.</p>}
      </section>
    </div>
  );
}
