// "Not for me" on the tuned-in page (follow-up Phase 1, 2026-09-29): a quiet text button, only
// while `features.notForMe` is on and a program is airing. On the web it sits in the player's bar
// with the other controls; on the phone, under what's on. Once said, it reads "Noted" for the rest
// of that airing, and a toast says what's kept.

import { Button, cx } from "@opencast/ui";
import { offersNotForMe, useNotForMe, useNotForMeFlag } from "../../data/notForMe";
import type { WatchData } from "./useWatch";

export function NotForMe({ w, className }: { w: WatchData; className?: string }) {
  const flag = useNotForMeFlag();
  const st = w.row?.station ?? null;
  const tuned = !!st && w.state.currentId === st.id && (w.state.status === "playing" || w.state.status === "paused");
  const shown = offersNotForMe({ flag, stationKind: st?.kind, airing: w.now, tuned });
  const { said, sending, say } = useNotForMe(shown && st ? st.id : null, shown ? w.now : null);
  if (!shown || !w.now) return null;
  if (said)
    return (
      <span className={cx("vw-nfm vw-nfm--said", className)} role="status">
        Noted
      </span>
    );
  return (
    <Button variant="text" size="sm" className={cx("vw-nfm", className)} onClick={() => void say()} disabled={sending} aria-label={`Not for me: ${w.now.title}`}>
      Not for me
    </Button>
  );
}
