// How the swipe home is framed (A245; swipe home 05, 07, 08): a phone or a tablet, upright or on its
// side, and what it asks of the shell: the picture full bleed, with the floating bar over it (gone
// on a phone on its side, fading with the buttons on a tablet on its side).

import { useLandscape, useShellOptions, useViewerLayout } from "../../layout/shell";

export type SwipeForm = { device: "phone" | "tablet"; landscape: boolean };

export function useSwipeForm(): SwipeForm {
  const layout = useViewerLayout();
  const landscape = useLandscape();
  return { device: layout === "tablet" ? "tablet" : "phone", landscape };
}

/** The frame the swipe home asks of the shell. `quiet`: the buttons have faded (landscape, after 3 seconds). */
export function useSwipeShell(form: SwipeForm, quiet = false) {
  useShellOptions({ player: false, padded: false, picture: true, noBar: form.device === "phone" && form.landscape, barHidden: quiet });
}
