// The app's three areas, each with its own shell and its own routes (each area's routes.tsx):
//
//   /            the viewer (viewer/routes.tsx): the dial, tuned in, the guide, You, /permission/:token, /tv, /remote…
//   /control/…   master control (control/routes.tsx): /control/:callSign/monitor, /control/new, /control/setup/…
//   /desk/…      Network desk (desk/routes.tsx), for the Opencast team: /desk/markets/:slug/board…
//
// Master control and the desk load only when someone opens them (their own chunks), so viewers
// never download them. /control and /desk are matched before the viewer's /:handle.

import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import ViewerArea from "./viewer/ViewerArea";

const ControlArea = lazy(() => import("./control/ControlArea"));
const DeskArea = lazy(() => import("./desk/DeskArea"));

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="control/*"
        element={
          <Suspense fallback={null}>
            <ControlArea />
          </Suspense>
        }
      />
      <Route
        path="desk/*"
        element={
          <Suspense fallback={null}>
            <DeskArea />
          </Suspense>
        }
      />
      <Route path="*" element={<ViewerArea />} />
    </Routes>
  );
}
