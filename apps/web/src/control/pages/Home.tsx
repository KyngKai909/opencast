// `/`: straight to your station (the first one you own, else the first you run). Hosts go to
// their live blocks. Someone with no station yet can start one.

import { Navigate } from "react-router";
import { Button } from "@opencast/ui";
import { useMe, useMyStations } from "../station/StationContext";
import { stationPath } from "../station/slug";
import { Quiet } from "./common";
import { controlPath } from "../../areas";

export default function Home() {
  const me = useMe();
  const mine = useMyStations();
  if (me.isLoading) return <Quiet />;
  if (me.isError) return <main className="cc-center"><p className="cc-center__p">{me.error.message}</p></main>;
  const first = mine[0];
  if (first) {
    const base = stationPath(first.station);
    const page = first.station.kind === "studio" ? "programs" : first.role === "host" ? "live" : "monitor";
    return <Navigate to={`${base}/${page}`} replace />;
  }
  return (
    <main className="cc-center">
      <h1 className="cc-center__h">Start a station</h1>
      <p className="cc-center__p">Pick a channel in your market, fill a log from your library and the market, and sign on. Each step saves as you go.</p>
      <Button variant="primary" href={controlPath("/new")}>
        Start a station
      </Button>
    </main>
  );
}
