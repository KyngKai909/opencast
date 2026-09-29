// "Watch on" (tv 06.2): the cast button's sheet over the tuned-in page, `?sheet=watch-on`. The TVs
// on the Wi-Fi, each going the way that works best there (the target-kind table in cast/targets.ts),
// "This phone", and a word that the installed TV app beats casting.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button, ChoiceList, Icon, Sheet, useToast } from "@opencast/ui";
import { usePlayer } from "@opencast/player";
import { getMirroring } from "../../cast/mirroring";
import { clearCastError, startCast, stopCasting, useCastSession } from "../../cast/session";
import { TARGET_KINDS, primaryLabel, type Choice } from "../../cast/targets";
import type { CastTarget } from "../../cast/types";
import { mirrorGuideHidden, useCastIntro, useWatchOnTargets } from "../../cast/useCast";
import { useOverlayParams } from "../watch/overlay";
import "./WatchOnSheet.css";

const PHONE = "this-phone";

export function mirrorGuideHref(tvName: string): string {
  return `/remote/mirror-guide?tv=${encodeURIComponent(tvName)}`;
}

export function WatchOnSheet() {
  const { params, close } = useOverlayParams();
  const open = params.get("sheet") === "watch-on";
  if (!open) return null;
  return <WatchOn onClose={() => close(["sheet"])} />;
}

function WatchOn({ onClose }: { onClose: () => void }) {
  const session = useCastSession();
  const { targets, loading } = useWatchOnTargets(true);
  const intro = useCastIntro();
  const [s] = usePlayer();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const current: CastTarget | null = session.status === "casting" || session.status === "mirroring" || session.status === "connecting" ? session.target : null;
  const driving = current !== null;
  // A TV that's playing is listed even when discovery doesn't return it (Chrome's picker names it only once connected).
  const rows = useMemo(() => (current && !targets.some((t) => t.id === current.id) ? [current, ...targets] : targets), [current, targets]);

  const [chosen, setChosen] = useState<string | null>(null);
  const value = chosen ?? current?.id ?? rows[0]?.id ?? (loading ? null : PHONE);
  const choice: Choice | null = value === PHONE ? { kind: "phone" } : (() => {
    const t = rows.find((r) => r.id === value);
    return t ? { kind: "tv", target: t } : null;
  })();
  const label = primaryLabel(choice, current);
  const error = session.status === "idle" ? session.error : null;
  useEffect(() => () => clearCastError(), []);

  const playing = s.channels.find((c) => c.station.id === (s.pendingId ?? s.currentId));

  const go = async () => {
    if (!choice) return;
    if (choice.kind === "phone") {
      if (driving) stopCasting();
      return onClose();
    }
    const t = choice.target;
    if (current && current.id === t.id) return navigate("/remote", { replace: true });
    const action = TARGET_KINDS[t.kind].action;
    if (action === "mirror") {
      if (!mirrorGuideHidden()) return navigate(mirrorGuideHref(t.name), { replace: true });
      // Hidden for good: the phone notices mirroring by itself and switches to the remote.
      void getMirroring().then((m) => m?.expect(t.name));
      toast.show({ message: `Turn on Screen Mirroring and choose ${t.name}.` });
      return onClose();
    }
    setBusy(true);
    const ok = await startCast(t, intro, playing?.station.channel ? { stationId: playing.station.id, channel: playing.station.channel } : null);
    setBusy(false);
    if (ok) navigate("/remote", { replace: true });
  };

  const options = [
    ...rows.map((t) => ({
      value: t.id,
      title: t.name,
      helper: TARGET_KINDS[t.kind].kindLine,
      end: (
        <span className="vw-wo__ic">
          <Icon name={TARGET_KINDS[t.kind].icon} />
        </span>
      )
    })),
    {
      value: PHONE,
      title: "This phone",
      helper: driving ? "Stop casting" : "Playing here",
      end: (
        <span className="vw-wo__ic">
          <Icon name="phone" />
        </span>
      )
    }
  ];

  return (
    <Sheet
      open
      onClose={onClose}
      title="Watch on"
      subtitle="TVs on this Wi-Fi"
      className="vw-wo"
      footer={
        label ? (
          <Button variant="primary" block onClick={() => void go()} disabled={busy || session.status === "connecting"}>
            {session.status === "connecting" ? `Connecting to ${session.target.name}` : label}
          </Button>
        ) : undefined
      }
    >
      {loading && !rows.length ? (
        <div className="vw-wo__quiet" aria-busy="true" aria-label="Looking for TVs">
          <i />
          <i />
        </div>
      ) : (
        <>
          {!rows.length && <p className="vw-wo__none">No TVs found on this Wi-Fi.</p>}
          <ChoiceList label="Watch on" options={options} value={value} onChange={setChosen} className="vw-wo__list" />
        </>
      )}
      {error && (
        <p className="vw-wo__error" role="alert">
          {error}
        </p>
      )}
      <p className="vw-wo__note">Got Opencast installed on the TV? It's faster than casting and has its own remote controls.</p>
      {choice?.kind === "tv" && TARGET_KINDS[choice.target.kind].action === "mirror" && mirrorGuideHidden() && (
        <Button variant="text" size="sm" className="vw-wo__how" onClick={() => navigate(mirrorGuideHref(choice.target.name), { replace: true })}>
          How to turn on Screen Mirroring
        </Button>
      )}
    </Sheet>
  );
}
