// `/`: straight to your business's spots (a viewer to where they aired). Someone with no business
// yet starts one.

import { Navigate } from "react-router";
import { useMe, useMyBusinesses } from "../business/BusinessContext";
import { Quiet } from "./common";

export default function Home() {
  const me = useMe();
  const mine = useMyBusinesses();
  if (me.isLoading) return <Quiet />;
  if (me.isError) return <main className="bz-center"><p className="bz-center__p">{me.error.message}</p></main>;
  const first = mine[0];
  if (!first) return <Navigate to="/start" replace />;
  return <Navigate to={`/${first.business.id}/${first.role === "viewer" ? "results" : "spots"}`} replace />;
}
