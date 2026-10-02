// The Guide area's routes (over the picture).

import { Route } from "react-router";
import About from "./About";
import Guide from "./Guide";
import GuideOptions from "./GuideOptions";

export const guideRoutes = (
  <>
    <Route path="guide" element={<Guide />}>
      <Route path="options/:airingId" element={<GuideOptions />} />
    </Route>
    <Route path="about/:stationRef" element={<About />} />
  </>
);
