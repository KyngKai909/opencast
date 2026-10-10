// The Live and programming area's routes, under `/control/:callSign`.

import { Route } from "react-router";
import Library from "./Library";
import LibraryItem from "./LibraryItem";
import Listings from "./Listings";
import LiveBlock from "./LiveBlock";
import LiveSources from "./LiveSources";
import Rehearse from "./Rehearse";

export const liveStationRoutes = (
  <>
    <Route path="live-sources" element={<LiveSources />} />
    <Route path="live-sources/:sourceId" element={<LiveSources />} />
    <Route path="live-sources/:sourceId/rehearse" element={<Rehearse />} />
    <Route path="live" element={<LiveBlock />} />
    <Route path="live/:entryId" element={<LiveBlock />} />
    <Route path="listings" element={<Listings />} />
    <Route path="listings/:entryId" element={<Listings />} />
    <Route path="library" element={<Library />} />
    <Route path="library/items/:itemId" element={<LibraryItem />} />
    <Route path="library/:folderId" element={<Library />} />
    {/* A244: a programming block's items. */}
    <Route path="library/blocks/:blockId" element={<Library />} />
    {/* A246: Blocks is the Schedule's tab (pages/onair/routes.tsx). */}
  </>
);
