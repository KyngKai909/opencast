// The viewer area (/): the player that keeps playing from page to page, the shells' page options,
// and the viewer's routes. Leaving for master control or the desk stops the player.

import { PlayerRoot } from "./player/PlayerRoot";
import { ShellOptionsProvider } from "./layout/shell";
import { AppRoutes } from "./routes";

export default function ViewerArea() {
  return (
    <PlayerRoot>
      <ShellOptionsProvider>
        <AppRoutes />
      </ShellOptionsProvider>
    </PlayerRoot>
  );
}
