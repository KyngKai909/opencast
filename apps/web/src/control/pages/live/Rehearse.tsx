// A private rehearsal for a live source (/:callSign/live-sources/:sourceId/rehearse): the studio
// view with no block, so nothing counts down and nothing goes out.

import { useParams } from "react-router";
import { Button, ControlTitle } from "@opencast/ui";
import { useIsPhone } from "../../layout/shell";
import { useStation } from "../../station/StationContext";
import { useLiveSources, useLogWindow } from "../../components/live/hooks";
import { StudioView } from "../../components/live/StudioView";
import { NotFound, Quiet } from "../common";
import "./live.css";

export default function Rehearse() {
  const { sourceId } = useParams();
  const s = useStation();
  const phone = useIsPhone();
  const sources = useLiveSources();
  const log = useLogWindow(1, 1);
  if (sources.isLoading) return <Quiet />;
  const source = sources.data?.find((x) => x.id === sourceId);
  if (!source) return <NotFound />;
  const callSign = s.label;
  return (
    <>
      {!phone && (
        <ControlTitle
          title={`Rehearsal, ${source.kind === "browser" ? "from this browser" : `from ${source.name}`}`}
          description={`A private rehearsal only you see, with ${callSign}'s graphics as viewers would see them.`}
          end={<Button href={`${s.base}/live-sources/${source.id}`}>Done</Button>}
        />
      )}
      <StudioView entry={null} source={source} log={log.data?.entries ?? []} />
    </>
  );
}
