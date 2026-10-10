// A246: the pages the Schedule replaced (/log, /log/place/:offerId, /breaks, /blocks and
// /blocks/:blockId), kept for good as redirects to its tabs, query and all: emails, notifications
// and bookmarks carry them (components/onair/scheduleRoutes.ts says where each lands).

import { Navigate, useLocation } from "react-router";
import { oldRouteTarget } from "../../components/onair/scheduleRoutes";
import { useStation } from "../../station/StationContext";
import { NotFound } from "../common";

export default function OldRoute() {
  const s = useStation();
  const loc = useLocation();
  const target = oldRouteTarget(loc.pathname.slice(s.base.length), loc.search, { studio: s.studio });
  if (!target) return <NotFound />;
  return <Navigate to={`${s.base}/${target}${loc.hash}`} replace />;
}
