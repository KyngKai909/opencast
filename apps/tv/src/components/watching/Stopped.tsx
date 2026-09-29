// After the sleep timer: Opencast has stopped itself (it can't turn the TV off). The TV app on
// Android TV and Fire TV goes back to the TV's home screen (Phase 8); in a browser the screen
// stays dark with one line saying what happened and how to start again.

import { Kbd } from "@opencast/ui";
import "./Stopped.css";

export function Stopped() {
  return (
    <div className="tvw-full tvw-stopped" role="status">
      <p>Turned off by the sleep timer.</p>
      <p className="tvw-stopped__ok">
        <Kbd size="tv">OK</Kbd>to watch again.
      </p>
    </div>
  );
}
