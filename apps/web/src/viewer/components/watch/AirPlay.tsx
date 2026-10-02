// AirPlay from Safari (iPhone, iPad, Mac): the picture on screen plays on an Apple TV or AirPlay
// TV by itself (the stream, not the phone's screen), so the phone stays free. Offered only while
// Safari says an AirPlay TV is around; WebKit shows its own list of TVs, and doesn't say which one
// was chosen, so the line says "Playing on AirPlay".

import { Button, Icon, IconButton } from "@opencast/ui";
import type { WatchData } from "./useWatch";

/** The web's controls: AirPlay beside sound and full screen, while an AirPlay TV is around. */
export function AirPlayButton({ w }: { w: WatchData }) {
  const a = w.state.airPlay;
  if (!a.available || a.active) return null;
  return <IconButton icon="tv" label="AirPlay" bare onClick={() => w.engine.showAirPlayPicker()} />;
}

/** While the picture plays on an AirPlay TV: where it is, and Stop. */
export function AirPlayLine({ w, className }: { w: WatchData; className?: string }) {
  if (!w.state.airPlay.active) return null;
  return (
    <div className={["vw-airplay", className].filter(Boolean).join(" ")} role="status">
      <Icon name="tv" />
      <span>Playing on AirPlay</span>
      <Button size="sm" onClick={() => w.engine.stopAirPlay()}>
        Stop
      </Button>
    </div>
  );
}
