// The Station area's routes: settings, translators, rights under `/control/:callSign`; claiming a
// station and joining a station's team (an invite's link) outside the shell.

import { Route } from "react-router";
import AcceptInvite from "./AcceptInvite";
import ClaimStation from "./ClaimStation";
import Rights from "./Rights";
import Settings from "./Settings";
import Translators from "./Translators";

export const stationOutsideRoutes = (
  <>
    <Route path="claim/:token" element={<ClaimStation />} />
    {/* A station invite's link: it asks for sign-in itself, like claiming. */}
    <Route path="invites/:inviteId" element={<AcceptInvite />} />
  </>
);

export const stationStationRoutes = (
  <>
    {/* The web goes on to Identity; the phone lists the sections. */}
    <Route path="settings" element={<Settings />} />
    <Route path="settings/:section" element={<Settings />} />
    <Route path="settings/team/invite" element={<Settings />} />
    <Route path="translators" element={<Translators />} />
    <Route path="rights" element={<Rights />} />
    <Route path="rights/:claimId" element={<Rights />} />
    <Route path="rights/:claimId/answer" element={<Rights />} />
  </>
);
