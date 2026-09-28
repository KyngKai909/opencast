// Every route. Each area adds its routes in its own pages/<area>/routes.tsx.

import { Navigate, Route, Routes } from "react-router";
import { useAuth } from "./auth/AuthProvider";
import { BusinessLayout } from "./layout/BusinessLayout";
import { SetupLayout } from "./layout/SetupLayout";
import { NotFound } from "./pages/common";
import AcceptInvite from "./pages/AcceptInvite";
import Home from "./pages/Home";
import SignIn from "./pages/SignIn";
import { dealsBusinessRoutes } from "./pages/deals/routes";
import { moneyBusinessRoutes, moneySetupRoutes, moneyStartRoutes } from "./pages/money/routes";
import { resultsBusinessRoutes } from "./pages/results/routes";
import { settingsBusinessRoutes } from "./pages/settings/routes";
import { spotsBusinessRoutes, spotsSetupRoutes } from "./pages/spots/routes";

export function AppRoutes() {
  const auth = useAuth();
  if (!auth.ready) return null;
  if (!auth.signedIn) return <SignIn />;
  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path="invites/:inviteId" element={<AcceptInvite />} />
      <Route element={<SetupLayout />}>{moneyStartRoutes}</Route>
      <Route path=":businessId/start" element={<SetupLayout />}>
        <Route index element={<Navigate to="fund" replace />} />
        {moneySetupRoutes}
        {spotsSetupRoutes}
      </Route>
      <Route path=":businessId" element={<BusinessLayout />}>
        <Route index element={<Navigate to="spots" replace />} />
        {spotsBusinessRoutes}
        {dealsBusinessRoutes}
        {resultsBusinessRoutes}
        {moneyBusinessRoutes}
        {settingsBusinessRoutes}
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
