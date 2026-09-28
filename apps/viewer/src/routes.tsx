import { Route, Routes } from "react-router";
import { AppLayout } from "./layout/AppLayout";
import Home from "./pages/Home";
import Radio from "./pages/Radio";
import Watch from "./pages/Watch";
import Guide from "./pages/Guide";
import Search from "./pages/Search";
import Program from "./pages/Program";
import Station from "./pages/Station";
import Presets from "./pages/Presets";
import You from "./pages/You";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

/**
 * Routes (docs/apps/inventory.md, viewer). Overlays are search params on the page underneath, so
 * Esc and Back return to exactly where you were: ?q= (search), ?station=CIVC (preview),
 * ?modal=market|carried|pledge|share|replace-key, ?listing=<airing>.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Home />} />
        <Route path="radio" element={<Radio />} />
        <Route path="watch/:stationRef" element={<Watch />} />
        <Route path="guide" element={<Guide />} />
        <Route path="search" element={<Search />} />
        <Route path="program/:programId" element={<Program />} />
        <Route path="presets" element={<Presets />} />
        <Route path="you" element={<You />} />
        <Route path="you/pledges/:pledgeId" element={<You />} />
        <Route path="settings" element={<Settings />} />
        <Route path="settings/:section" element={<Settings />} />
        <Route path=":handle" element={<Station />} />
        <Route path=":handle/pledge" element={<Station />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
