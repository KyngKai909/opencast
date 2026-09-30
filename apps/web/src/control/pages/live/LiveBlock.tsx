// 02.1 going live from a browser; 05.1 and 05.2 from a phone (/:callSign/live/:entryId, the same
// route at phone width). /:callSign/live alone opens the person's next live block: a host's own
// (A27), anyone else's next on the log.

import { Navigate, useParams } from "react-router";
import { Button, ControlTitle } from "@opencast/ui";
import type { LogEntry } from "@opencast/contracts";
import { useNow } from "../../../lib/clock";
import { useIsPhone } from "../../layout/shell";
import { HOST_REASON } from "../../station/abilities";
import { useStation } from "../../station/StationContext";
import { useLiveSources, useLogWindow, useMyHostedPrograms } from "../../components/live/hooks";
import { nextBlock } from "../../components/live/logic";
import { StudioView } from "../../components/live/StudioView";
import { Quiet } from "../common";
import "./live.css";

function Message({ title, text }: { title: string; text?: string }) {
  const s = useStation();
  return (
    <div className="cc-live-msg">
      <ControlTitle title={title} description={text} />
      {s.can("programming") && <Button href={`${s.base}/live-sources`}>Live sources</Button>}
    </div>
  );
}

export default function LiveBlock() {
  const { entryId } = useParams();
  const s = useStation();
  const phone = useIsPhone();
  const log = useLogWindow(8, 12);
  const sources = useLiveSources();
  const hosted = useMyHostedPrograms();
  const now = useNow(15_000);
  const host = s.role === "host";

  if (log.isLoading || (host && hosted === null)) return <Quiet />;
  if (log.isError) return <Message title="Going live" text={log.error.message} />;
  const entries = log.data?.entries ?? [];

  if (!entryId) {
    const next = nextBlock(entries, now, host ? { programIds: hosted ?? [] } : null);
    if (next) return <Navigate to={`${s.base}/live/${next.id}`} replace />;
    return <Message title="No live blocks coming up" text={host ? "When you're given a live block, it's here." : "Live blocks in the log are listed in Live sources."} />;
  }

  const entry: LogEntry | undefined = entries.find((e) => e.id === entryId);
  if (!entry || entry.kind !== "live") return <Message title="That live block isn't on the log." />;
  if (host && !(entry.programId && hosted?.includes(entry.programId))) return <Message title="That block isn't one of yours." text={HOST_REASON} />;

  const source = sources.data?.find((x) => x.id === entry.liveSourceId) ?? null;
  const kind = source?.kind ?? "browser";
  const title = kind === "browser" ? `${entry.title}, from this browser` : `${entry.title}, from ${source?.name ?? "an encoder"}`;
  const callSign = s.label;
  return (
    <>
      {!phone && (
        <ControlTitle
          title={title}
          description={kind === "browser" ? `Your camera, with ${callSign}'s graphics as viewers will see them.` : `${source?.name ?? "The encoder"}'s signal, with ${callSign}'s graphics as viewers will see them.`}
        />
      )}
      {phone && <h1 className="oc-sr-only">{title}</h1>}
      <StudioView entry={entry} source={source} log={entries} />
    </>
  );
}
