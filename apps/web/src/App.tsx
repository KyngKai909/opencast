import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

// Route-level code splitting: hls.js (only used on Watch) stays out of the
// initial bundle, keeping first load light.
const ExplorePage = lazy(() => import("./pages/ExplorePage"));
const WatchPage = lazy(() => import("./pages/WatchPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));

function RouteFallback() {
  return <div className="min-h-screen bg-bg" aria-busy="true" />;
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<ExplorePage />} />
        <Route path="/watch/:channelRef" element={<WatchPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
