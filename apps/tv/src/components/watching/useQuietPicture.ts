// An overlay opening puts the banner away: the menu, the presets strip, the sleep timer and the
// pledge panel are drawn over the picture alone, as the frames draw them.

import { useEffect } from "react";
import { usePlayer } from "@opencast/player";

export function useQuietPicture() {
  const [, engine] = usePlayer();
  useEffect(() => engine.hideBanner(), [engine]);
}
