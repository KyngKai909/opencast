import { useEffect } from "react";
import { Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { MiniPlayer, PlayerBar, ViewerPhoneShell, ViewerWebShell, type ViewerSection, type ViewerTab } from "@opencast/ui";
import { usePlayer } from "@opencast/player";
import { useAuth } from "../auth/AuthProvider";
import { useMarkets, useMarketSlug, useMe } from "../data/viewer";
import { useNowPlaying } from "../player/PlayerRoot";
import { useIsPhone, useShellState } from "./shell";
import MarketPicker from "../components/overlays/MarketPicker";
import SearchOverlay from "../components/overlays/SearchOverlay";
import StationPreview from "../components/overlays/StationPreview";
import PlayerModals from "../components/overlays/PlayerModals";
import SignInModal from "../components/overlays/SignInModal";
import ReplaceKeyDialog from "../components/overlays/ReplaceKeyDialog";

const SECTION_HREF: Record<ViewerSection, string> = { dial: "/", guide: "/guide", radio: "/radio", presets: "/presets" };
const TAB_HREF: Record<ViewerTab, string> = { dial: "/", guide: "/guide", search: "/search", you: "/you" };

function sectionFor(path: string): ViewerSection | "you" | null {
  if (path === "/" || path.startsWith("/watch")) return "dial";
  if (path.startsWith("/guide")) return "guide";
  if (path.startsWith("/radio")) return "radio";
  if (path.startsWith("/presets")) return "presets";
  if (path.startsWith("/you") || path.startsWith("/settings")) return "you";
  return null;
}
function tabFor(path: string): ViewerTab | null {
  if (path === "/" || path.startsWith("/radio") || path.startsWith("/watch")) return "dial";
  if (path.startsWith("/guide")) return "guide";
  if (path.startsWith("/search")) return "search";
  if (path.startsWith("/you") || path.startsWith("/settings") || path.startsWith("/presets")) return "you";
  return null;
}

function initials(name: string | null | undefined): string {
  return (name ?? "").split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).join("").slice(0, 2) || "?";
}

/** Keys from anywhere outside a text field: 1 to 6 tune presets. ("/" is the shell's.) */
function usePresetKeys() {
  const [, engine] = usePlayer();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (/^[1-6]$/.test(e.key)) {
        e.preventDefault();
        engine.handle({ type: "preset", key: Number(e.key) }, { input: "keyboard" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine]);
}

export function AppLayout() {
  const phone = useIsPhone();
  const loc = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const auth = useAuth();
  const me = useMe();
  const markets = useMarkets();
  const slug = useMarketSlug();
  const [, engine] = usePlayer();
  const shell = useShellState();
  const np = useNowPlaying();
  usePresetKeys();

  const marketName = markets.data?.find((m) => m.slug === slug)?.name ?? "Choose a market";
  const openMarket = () => setParams((p) => (p.set("modal", "market"), p));
  const openSearch = () => (phone ? navigate("/search") : setParams((p) => (p.set("q", ""), p)));
  const row = np.row;
  const stationLine = row ? [[row.station.callSign, row.station.channel].filter(Boolean).join(" "), row.now?.carriedFrom?.callSign ? `carried from ${row.now.carriedFrom.callSign}` : null].filter(Boolean).join(", ") : "";
  const openPlayer = row ? () => navigate(`/watch/${row.station.callSign?.toLowerCase() ?? row.station.id}`) : undefined;
  const showPlayer = shell.player !== false && !!row;
  const radio = row?.station.band === "radio";

  const overlays = (
    <>
      <MarketPicker />
      <SearchOverlay />
      <StationPreview />
      <PlayerModals />
      <SignInModal />
      <ReplaceKeyDialog />
    </>
  );
  void params;

  if (phone) {
    return (
      <ViewerPhoneShell
        tab={tabFor(loc.pathname)}
        linkTo={(t) => TAB_HREF[t]}
        tabs={shell.tabs !== false}
        market={{ name: marketName, onClick: openMarket }}
        back={shell.back}
        top={shell.top}
        padded={shell.padded !== false}
        player={
          showPlayer ? (
            <MiniPlayer title={row.now?.title ?? row.station.name} station={[row.station.callSign, row.station.channel].filter(Boolean).join(" ")} colour={row.station.colour ?? "#33507A"} card={radio ? row.station.channel ?? undefined : undefined} playing={np.playing} flicker={false} onTogglePlay={() => engine.togglePlay()} onOpen={openPlayer} />
          ) : undefined
        }
      >
        <Outlet />
        {overlays}
      </ViewerPhoneShell>
    );
  }
  return (
    <ViewerWebShell
      active={sectionFor(loc.pathname)}
      linkTo={(s) => SECTION_HREF[s]}
      homeHref="/"
      market={{ name: marketName, onClick: openMarket }}
      onSearch={openSearch}
      user={auth.signedIn ? { initials: initials(me.data?.displayName ?? auth.email), name: me.data?.displayName ?? auth.email ?? "You", href: "/you" } : undefined}
      signIn={{ onClick: () => auth.openSignIn() }}
      padded={shell.padded !== false}
      player={
        showPlayer ? (
          <PlayerBar
            title={row.now?.title ?? row.station.name}
            station={stationLine}
            colour={row.station.colour ?? "#33507A"}
            card={radio ? row.station.channel ?? undefined : undefined}
            playing={np.playing}
            flicker={false}
            radio={radio}
            onChannelDown={() => engine.handle({ type: "channel", dir: "down" })}
            onChannelUp={() => engine.handle({ type: "channel", dir: "up" })}
            onTogglePlay={() => engine.togglePlay()}
            onOpen={openPlayer}
          />
        ) : undefined
      }
    >
      <Outlet />
      {overlays}
    </ViewerWebShell>
  );
}
