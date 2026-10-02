// The menu rail's band item ("/radio", and "/radio?band=tv" for the way back). Not drawn: it
// tunes the station last heard on that band (or the first one on the air) and closes, so the
// radio screen (the player's, tv 05.1) comes up with its banner. Nothing to focus or choose.

import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { usePlayer } from "@opencast/player";
import { bandTarget, lastOnBand } from "../../components/watching/bands";
import { useDial } from "../../tv/data";

export default function Radio() {
  const [params] = useSearchParams();
  const band = params.get("band") === "tv" ? "tv" : "radio";
  const navigate = useNavigate();
  const [s, engine] = usePlayer();
  const dial = useDial(band);
  // The player tunes only what's on its dial: wait for it to have the channels.
  const ready = !dial.isLoading && (!dial.data?.rows.length || s.channels.length > 0);

  useEffect(() => {
    if (!ready) return;
    const target = dial.data ? bandTarget(dial.data.rows, band, lastOnBand(band)) : null;
    if (target) void engine.tune(target.station.id, { input: "remote" });
    navigate("/", { replace: true });
  }, [ready, dial.data, band, engine, navigate]);

  return null;
}
