// tv 04.1 the menu rail over a dimmed picture ("/menu"). It slides in from the left and holds
// everything that isn't watching; the picture keeps playing, dimmed, with its sound on. Each item
// says where it stands ("5 saved", "4 stations", "Inland Empire", "Off"). Menu or Back closes it
// (the dispatcher); OK opens or toggles the focused item.

import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { clock, cx, Mark } from "@opencast/ui";
import { usePlayer } from "@opencast/player";
import { OPTIONS } from "../../components/settings/model";
import { useTvSettings } from "../../components/settings/useTvSettings";
import { otherBand, useRememberBand } from "../../components/watching/bands";
import { menuItems, savedText, stationsText, toggledCaptions, type MenuItemId } from "../../components/watching/menu";
import { pledgeRoute } from "../../components/watching/pledge";
import { MARKET_TZ } from "../../lib/clock";
import { useDial, useMe, usePresets, useSignedIn } from "../../tv/data";
import { useDevice } from "../../tv/device";
import { FocusContext, focusKey, useTvFocusable } from "../../tv/focus";
import { useTvMode } from "../../tv/TvApp";
import { useQuietPicture } from "../../components/watching/useQuietPicture";
import "./Menu.css";

function Item({ id, label, value, onSelect }: { id: MenuItemId; label: ReactNode; value?: ReactNode; onSelect: () => void }) {
  const { ref, focused } = useTvFocusable({ focusKey: `tvw-mi-${id}`, onSelect });
  return (
    <div ref={ref} role="menuitem" tabIndex={-1} className={cx("tvw-mi", focused && "tv-focus")} onClick={onSelect}>
      {label}
      {value != null && <small>{value}</small>}
    </div>
  );
}

export default function Menu() {
  const mode = useTvMode();
  useQuietPicture();
  const navigate = useNavigate();
  const [s] = usePlayer();
  const signedIn = useSignedIn();
  const me = useMe();
  const device = useDevice();
  const { settings, save } = useTvSettings();
  const { presets, loading } = usePresets();
  const current = s.channels.find((c) => c.station.id === s.currentId);
  useRememberBand(current);
  const cross = otherBand(current);
  const crossDial = useDial(cross);
  const tvDial = useDial("tv");

  const rail = useTvFocusable({ focusKey: "tvw-menu", trackChildren: true, isFocusBoundary: true, saveLastFocusedChild: false });
  // Opens on the first item.
  useEffect(() => focusKey("tvw-mi-guide"), []);

  const go = (to: string) => navigate(to, { replace: true });
  const items = menuItems({ mode, station: current?.station ?? null });
  const market = me.data?.market?.name ?? tvDial.data?.market.name ?? null;
  const captionsLabel = OPTIONS.captions.find((o) => o.value === settings.captions)?.label ?? null;
  const crossCount = crossDial.data ? crossDial.data.rows.length : null;
  const account = signedIn ? `Signed in as ${me.data?.displayName ?? device.signedInAs ?? "you"}` : "Sign in";

  const render: Record<MenuItemId, () => ReactNode> = {
    guide: () => <Item key="guide" id="guide" label="Guide" onSelect={() => go("/guide")} />,
    presets: () => <Item key="presets" id="presets" label="Presets" value={loading ? null : savedText(presets.length)} onSelect={() => go("/presets")} />,
    sleep: () => <Item key="sleep" id="sleep" label="Sleep timer" value={s.sleep ? `Until ${clock(s.sleep.endsAt, { timeZone: MARKET_TZ })}` : "Off"} onSelect={() => go("/sleep")} />,
    band: () => <Item key="band" id="band" label={cross === "radio" ? "Radio band" : "TV band"} value={stationsText(crossCount)} onSelect={() => go(cross === "radio" ? "/radio" : "/radio?band=tv")} />,
    market: () => <Item key="market" id="market" label="Your market" value={market} onSelect={() => go("/market")} />,
    captions: () => <Item key="captions" id="captions" label="Captions" value={captionsLabel} onSelect={() => save({ captions: toggledCaptions(settings.captions) })} />,
    settings: () => <Item key="settings" id="settings" label="Settings" onSelect={() => go("/settings")} />,
    pledge: () => (current ? <Item key="pledge" id="pledge" label="Pledge" value={current.station.name} onSelect={() => go(pledgeRoute(current.station))} /> : null),
    account: () => <Item key="account" id="account" label={account} onSelect={() => go(signedIn ? "/settings/account" : "/welcome")} />
  };

  return (
    <div className="tvw-full tvw-menu">
      <div className="tvw-menu__dim" aria-hidden="true" />
      <FocusContext.Provider value={rail.focusKey}>
        <nav ref={rail.ref} className="tvw-rail" aria-label="Menu">
          <div className="tvw-rail__logo">
            <Mark variant="outline" />
            opencast
          </div>
          <div role="menu">{items.map((id) => render[id]())}</div>
          <div className="tvw-rail__foot">Menu or Back to close</div>
        </nav>
      </FocusContext.Provider>
    </div>
  );
}
