// TV mode on the iPhone's second screen: what's on goes back to the phone, as the Cast receiver
// tells its phones. The Swift plugin (apps/web's OpencastMirror) listens for these messages
// in this web view and passes them to the phone's, where the remote while mirroring shows them.

import { useEffect } from "react";
import { usePlayer } from "@opencast/player";
import { remoteStateOf } from "./remoteState";

export function MirrorStateToPhone({ target = window }: { target?: Pick<Window, "postMessage" | "location"> }) {
  const [s] = usePlayer();
  useEffect(() => {
    target.postMessage({ opencast: "state", state: remoteStateOf(s, null) }, target.location.origin);
  }, [target, s.currentId, s.status, s.sleep?.endsAt]);
  return null;
}
