// TV mode: one tree for the TV app (Android TV, Google TV, Fire TV, TV browsers), the Cast Web
// Receiver and the iPhone's external display. They differ only in their input (the remote's keys,
// Cast messages from phones, the bridge from the iPhone app), their router (the TV app has
// history; the receiver and mirror run in memory) and where they count as tuned in.

import { createContext, useContext, useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import { BrowserRouter, MemoryRouter, Outlet, useLocation, useNavigate } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { audienceApi } from "@opencast/contracts";
import { PlayerProvider, PlayerSurface, startHeartbeat, startInputs, usePlayer, type Command, type CommandSource, type EngineOptions, type InputAdapter } from "@opencast/player";
import { GroundProvider, TvShell } from "@opencast/ui";
import { call, setTokenSource } from "../api/client";
import { now, MARKET_TZ } from "../lib/clock";
import { contextFor, dispatch, onPictureCommand, type Ui } from "./commands";
import { useChannels, usePresets } from "./data";
import { getDevice, setDevice, useDevice } from "./device";
import { startFocus } from "./focus";
import "./tv.css";

export type TvMode = "tv" | "cast" | "mirror";

export interface TvAppProps {
  mode: TvMode;
  /** Builds the inputs, given where TV mode is (picture or overlay) for the remote's arrows. */
  inputs: (where: () => "picture" | "overlay") => InputAdapter[];
  routes: ReactNode;
  /** Extra wiring inside the player and router (the receiver's state to phones). */
  children?: ReactNode;
}

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } });

// The TV session's token (the code sign-in); read on every call, so signing in takes effect at once.
setTokenSource(async () => getDevice().token);

/** The inputs in use, for the hint row ("▲▼ Channels…", "Playing from Kai's phone"). */
const InputsContext = createContext<InputAdapter[]>([]);
export function useInputs(): InputAdapter[] {
  return useContext(InputsContext);
}

export function TvApp({ mode, inputs, routes, children }: TvAppProps) {
  startFocus();
  const ui = useRef<Ui | null>(null);
  const path = useRef("/");
  // Built once: the keyboard reads where TV mode is through `path`.
  const adapters = useMemo(() => inputs(() => contextFor(path.current)), [inputs]);
  const settings = getDevice().settings;
  const options = useMemo<EngineOptions>(
    () => ({
      // Neighbours warm by buffering near live; on a Chromecast only the playlists (memory).
      warm: mode === "cast" ? "none" : "buffer",
      neighbours: { sameBand: !settings.includeRadioBand },
      bannerMs: settings.bannerSeconds * 1000,
      numberWaitMs: settings.numberWaitSeconds * 1000,
      now: () => now().getTime(),
      onCommand: (c: Command, s?: CommandSource) => {
        if (ui.current && engineRef.current) onPictureCommand(c, ui.current, engineRef.current, s);
      }
    }),
    // Settings apply when TV mode starts (a change in Settings restarts the player: see Settings).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode]
  );
  const engineRef = useRef<import("@opencast/player").PlayerEngine | null>(null);
  const Router = mode === "tv" ? BrowserRouter : MemoryRouter;
  return (
    <QueryClientProvider client={queryClient}>
      <GroundProvider>
        <PlayerProvider options={options}>
          <Router>
            <InputsContext.Provider value={adapters}>
              <Wiring mode={mode} adapters={adapters} path={path} ui={ui} engineRef={engineRef} />
              {routes}
              {children}
            </InputsContext.Provider>
          </Router>
        </PlayerProvider>
      </GroundProvider>
    </QueryClientProvider>
  );
}

/** Connects the router, the inputs and the player; keeps the dial, presets and captions current. */
function Wiring({ mode, adapters, path, ui, engineRef }: { mode: TvMode; adapters: InputAdapter[]; path: MutableRefObject<string>; ui: MutableRefObject<Ui | null>; engineRef: MutableRefObject<import("@opencast/player").PlayerEngine | null> }) {
  const [state, engine] = usePlayer();
  engineRef.current = engine;
  const navigate = useNavigate();
  const loc = useLocation();
  path.current = loc.pathname;
  const device = useDevice();
  const channels = useChannels();
  const { presets } = usePresets();

  ui.current = {
    path: () => path.current,
    go: (to, o) => navigate(to, { replace: o?.replace }),
    close: () => {
      const inOverlay = path.current !== "/";
      if (!inOverlay) return;
      // Nested overlays (guide options) go back to their parent; others to the picture.
      const parent = path.current.split("/").slice(0, -1).join("/");
      navigate(parent && parent !== path.current && /^\/(guide|settings)/.test(parent) ? parent : "/", { replace: true });
    }
  };

  // Inputs: every command goes through the one dispatcher.
  useEffect(() => startInputs(adapters, (c, s) => ui.current && dispatch(c, s, ui.current, engine)), [engine, adapters, ui]);

  useEffect(() => engine.setChannels(channels), [engine, channels]);
  useEffect(() => engine.setPresets(Object.fromEntries(presets.map((p) => [p.key, p.stationId]))), [engine, presets]);
  useEffect(() => engine.setCaptions(device.settings.captions, device.settings.captionSize), [engine, device.settings.captions, device.settings.captionSize]);
  useEffect(() => startHeartbeat(engine, (body) => call(audienceApi.heartbeat, { body }), mode === "cast" ? "cast" : mode === "mirror" ? "phone" : "tv_app"), [engine, mode]);

  // First tune: the last channel on this TV, or the first station on the dial.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !channels.length || state.currentId) return;
    started.current = true;
    const last = getDevice().settings.startOn === "last_channel" ? channels.find((c) => c.station.id === getDevice().lastStationId) : null;
    void engine.tune((last ?? channels[0]).station.id, { input: "app" });
  }, [channels, engine, state.currentId]);
  useEffect(() => {
    if (state.currentId && state.currentId !== getDevice().lastStationId) setDevice({ lastStationId: state.currentId });
  }, [state.currentId]);

  // First launch on the TV app: sign in on your phone, or watch without signing in.
  useEffect(() => {
    if (mode === "tv" && !getDevice().welcomed && path.current !== "/welcome") navigate("/welcome", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** The picture, full screen, with whatever overlay the route draws over it. */
export function TvLayout() {
  const loc = useLocation();
  const adapters = useInputs();
  usePlayer(); // re-render as the player changes: a new phone casting changes the chip
  const hints = loc.pathname === "/" ? adapters.flatMap((a) => a.hints?.() ?? []) : [];
  return (
    <TvShell picture={<PlayerSurface size="tv" timeZone={MARKET_TZ} clock={now} hints={hints} />}>
      <Outlet />
    </TvShell>
  );
}
