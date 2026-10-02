// The Watching and menus area's routes (over the picture).

import { Route } from "react-router";
import Menu from "./Menu";
import Pledge from "./Pledge";
import Presets from "./Presets";
import Radio from "./Radio";
import Sleep from "./Sleep";
import Watching from "./Watching";

export const watchingRoutes = (
  <>
    <Route index element={<Watching />} />
    <Route path="menu" element={<Menu />} />
    <Route path="presets" element={<Presets />} />
    <Route path="sleep" element={<Sleep />} />
    <Route path="pledge/:stationRef" element={<Pledge />} />
    <Route path="radio" element={<Radio />} />
  </>
);
