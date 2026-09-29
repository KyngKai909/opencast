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
import Remote, { MirrorGuidePage } from "./pages/Remote";
import TvCode from "./pages/TvCode";
import { CastSync } from "./cast/CastSync";

/**
 * Routes (docs/apps/inventory.md, viewer). Overlays are search params on the page underneath, so
 * Esc and Back return to exactly where you were: ?q= (search), ?station=CIVC (preview),
 * ?modal=market|carried|pledge|share|replace-key, ?listing=<airing>, ?sheet=watch-on (the cast button's
 * "Watch on", over the tuned-in page) and ?sheet=keypad (over the remote). CastSync keeps a casting or
 * mirroring session in step with the phone from every page.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route
        element={
          <>
            <AppLayout />
            <CastSync />
          </>
        }
      >
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
        <Route path="remote" element={<Remote />} />
        <Route path="remote/mirror-guide" element={<MirrorGuidePage />} />
        <Route path="tv" element={<TvCode />} />
        <Route path=":handle" element={<Station />} />
        <Route path=":handle/pledge" element={<Station />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
