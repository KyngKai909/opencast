// TV mode on the iPhone's second screen: what's on goes back to the phone, as the Cast receiver
// tells its phones. The Swift plugin (apps/web's OpencastMirror) listens for these messages
// in this web view and passes them to the phone's, where the remote while mirroring shows them.

import { useEffect } from "react";
import { usePlayer } from "@opencast/player";
import { remoteStateOf } from "./remoteState";

export function MirrorStateToPhone({ target = window }: { target?: Pick<Window, "postMessage" | "location"> }) {
  const [s] = usePlayer();
  useEffect(() => {
    // Behind live too (the relay's contract has no field for it; this message isn't the relay's).
    target.postMessage({ opencast: "state", state: { ...remoteStateOf(s, null), behindLive: s.behindLive } }, target.location.origin);
  }, [target, s.currentId, s.status, s.sleep?.endsAt, s.behindLive]);
  return null;
}
