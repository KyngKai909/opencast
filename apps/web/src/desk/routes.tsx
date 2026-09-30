// Network desk's routes, under /desk (src/routes.tsx): every path here is relative to it. The
// Opencast team only (an admin, a rights reviewer or a market lead): signed out, the sign-in page;
// signed in but not on the team, NotForYou; otherwise the desk.
//
//   /desk/markets/:marketSlug/board              01.1 the market board (?ch=33 selects a slot, ?ch=92.0 on radio)
//   /desk/markets/:marketSlug/pipeline           02.1 the creator pipeline (?stage=said_yes filters, ?add=1 opens Add a creator)
//   /desk/markets/:marketSlug/pipeline/:id/ask   03.1 asking permission
//   /desk/markets/:marketSlug/pipeline/:id/setup 04.1 setting up a claimable station
//   /desk/markets/:marketSlug/listed             05.1 listed sources and the catalog station (?add=1 opens List a source)
//   /desk/markets/:marketSlug/catalog            desk-catalog 01 the shelf (?add=1 Add an item, ?series=1 New series)
//   /desk/markets/:marketSlug/catalog/series/:id desk-catalog 02 a series and its items (?ep=14 picks the episode)
//   /desk/markets/:marketSlug/catalog/items/:id  desk-catalog 03 an item's rights check
//   /desk/held-earnings                          07.1 held earnings
//   /desk/settings/:section                      desk-pages 04 Settings: team, rules, markets, signers, log, you
// The creator's permission page (06.1, 06.2) is the viewer area's /permission/:token.

import { Navigate, Route, Routes } from "react-router";
import { accountsApi } from "@opencast/contracts";
import { ApiError } from "../api/client";
import { useApi } from "../api/hooks";
import { useAuth } from "../auth/AuthProvider";
import { gateFor } from "./auth/gate";
import { DeskLayout } from "./layout/DeskLayout";
import { rememberedMarket } from "./layout/market";
import { NotFound, Quiet, Unbuilt } from "./pages/common";
import Ask from "./pages/Ask";
import Board from "./pages/Board";
import Catalog from "./pages/Catalog";
import CatalogItem from "./pages/CatalogItem";
import CatalogSeries from "./pages/CatalogSeries";
import Held from "./pages/Held";
import Listed from "./pages/Listed";
import NotForYou from "./pages/NotForYou";
import Pipeline from "./pages/Pipeline";
import Reserved from "./pages/Reserved";
import Settings from "./pages/Settings";
import Setup from "./pages/Setup";
import SignIn from "./pages/SignIn";
import { deskPath } from "../areas";

export function AppRoutes() {
  const auth = useAuth();
  const me = useApi(accountsApi.getMe, {}, { enabled: auth.ready && auth.signedIn, retry: false });
  const gate = gateFor({ ready: auth.ready, signedIn: auth.signedIn, me: me.data, meError: me.error instanceof ApiError ? me.error.status : me.error ? 500 : null });
  if (gate === "loading") return <Quiet />;
  if (gate === "sign-in") return <SignIn />;
  if (gate === "not-admin") return <NotForYou />;
  if (gate === "error") return <NotForYou error />;
  return (
    <Routes>
      <Route element={<DeskLayout />}>
        <Route index element={<Navigate to={deskPath(`/markets/${rememberedMarket()}/board`)} replace />} />
        <Route path="markets/:marketSlug">
          <Route index element={<Navigate to="board" replace />} />
          <Route path="board" element={<Board />} />
          <Route path="pipeline" element={<Pipeline />} />
          <Route path="pipeline/:creatorId/ask" element={<Ask />} />
          <Route path="pipeline/:creatorId/setup" element={<Setup />} />
          <Route path="listed" element={<Listed />} />
          <Route path="catalog" element={<Catalog />} />
          <Route path="catalog/series/:seriesId" element={<CatalogSeries />} />
          <Route path="catalog/items/:itemId" element={<CatalogItem />} />
        </Route>
        <Route path="held-earnings" element={<Held />} />
        <Route path="reserved-call-signs" element={<Reserved />} />
        <Route path="rights-claims" element={<Unbuilt title="Rights claims" about="Claims against programs on any station, and the answers." />} />
        <Route path="catalog-sponsors" element={<Unbuilt title="Catalog sponsors" about="Businesses that sponsor the catalog station's programs." />} />
        <Route path="settings" element={<Navigate to="rules" replace />} />
        <Route path="settings/:section" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
