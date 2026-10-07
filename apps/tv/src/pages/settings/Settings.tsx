// tv-update 04.1 TV settings, five sections ("/settings/:section"): full screen over the dimmed
// picture, sections on the left and rows on the right, one focused at a time. ◀ ▶ change the
// focused row's value; no dropdowns, no keyboard. Watching is the drawn section; the other four
// follow its pattern and the frame's note "The five sections".
//
// Values apply on this TV at once and, signed in, are saved to the account. On a Cast receiver or
// an iPhone's second screen there are no settings here: they come from the phone.

import { useEffect, useRef, type ReactNode } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { cx } from "@opencast/ui";
import { version } from "../../../package.json";
import { deviceLine } from "../../components/settings/about";
import { settingsCommand, type RowKind, type Zone } from "../../components/settings/keys";
import { CAPTION_PREVIEW_PX, channelUpHelp, ends, isSection, labelOf, OPTIONS, SECTIONS, step, type SectionId, type StepKey, type TvSettingsX } from "../../components/settings/model";
import { PhoneRows } from "../../components/settings/PhoneRows";
import { TvRow } from "../../components/settings/TvRow";
import { useAccountSettingsSync, useTvSettings } from "../../components/settings/useTvSettings";
import { isAndroidApp, nativeInfo } from "../../native/plugin";
import { isTizenApp } from "../../native/tizen";
import { useCommandLayer } from "../../tv/commands";
import { useDial, useMe } from "../../tv/data";
import { useDevice } from "../../tv/device";
import { FocusContext, focusKey, useTvFocusable } from "../../tv/focus";
import { signOutThisTv } from "../../tv/session";
import { useTvMode } from "../../tv/TvApp";
import "./Settings.css";

export default function Settings() {
  const mode = useTvMode();
  const { section } = useParams();
  if (mode !== "tv") return <Navigate to="/" replace />;
  if (!isSection(section)) return <Navigate to="/settings/watching" replace />;
  return <SettingsScreen section={section} />;
}

function SettingsScreen({ section }: { section: SectionId }) {
  useAccountSettingsSync();
  const navigate = useNavigate();
  const zone = useRef<Zone | null>(null);
  const row = useRef<{ kind: RowKind; key: string } | null>(null);
  /** Each row's ◀ ▶, by focus key, rebuilt every render so they see current values. */
  const steppers = useRef<Record<string, (dir: -1 | 1, wrap: boolean) => void>>({});
  steppers.current = {};

  // Every section has a row to choose (About's market), so the pane always takes focus.
  const toPane = () => focusKey("tvs-pane");
  const toRail = () => focusKey(`tvs-sec-${section}`);

  useCommandLayer((c) => {
    const a = settingsCommand(c, { zone: zone.current, row: row.current?.kind ?? null });
    if (!a) return false;
    if (a.do === "step") steppers.current[row.current?.key ?? ""]?.(a.dir, a.wrap);
    else if (a.do === "rail") toRail();
    else if (a.do === "pane") toPane();
    else if (a.do === "close") navigate("/menu", { replace: true });
    return true;
  });

  // Opens on the section's first row, as drawn (Captions focused).
  useEffect(() => {
    const t = setTimeout(toPane, 0);
    return () => clearTimeout(t);
    // Once, on opening: moving along the rail keeps focus on the rail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focusRow = (key: string, kind: RowKind) => () => {
    zone.current = "pane";
    row.current = { key, kind };
  };

  const rail = useTvFocusable({ focusKey: "tvs-rail", isFocusBoundary: true, trackChildren: true });
  const pane = useTvFocusable({ focusKey: "tvs-pane", isFocusBoundary: true, trackChildren: true });
  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="tvs-settings">
      <FocusContext.Provider value={rail.focusKey}>
        <nav ref={rail.ref} className="tvs-settings__rail" aria-labelledby="tvs-settings-title">
          <h2 className="tvs-settings__title" id="tvs-settings-title">
            Settings
          </h2>
          {SECTIONS.map((s) => (
            <RailItem
              key={s.id}
              id={s.id}
              label={s.label}
              on={s.id === section}
              onFocus={() => {
                zone.current = "rail";
                row.current = null;
                if (s.id !== section) navigate(`/settings/${s.id}`, { replace: true });
              }}
              onSelect={toPane}
            />
          ))}
        </nav>
      </FocusContext.Provider>
      <FocusContext.Provider value={pane.focusKey}>
        <section ref={pane.ref} className="tvs-settings__pane" aria-labelledby="tvs-settings-heading">
          <h3 className="tvs-settings__heading" id="tvs-settings-heading">
            {current.label}
          </h3>
          <SectionRows section={section} steppers={steppers.current} focusRow={focusRow} />
        </section>
      </FocusContext.Provider>
    </div>
  );
}

function RailItem({ id, label, on, onFocus, onSelect }: { id: SectionId; label: string; on: boolean; onFocus: () => void; onSelect: () => void }) {
  const f = useTvFocusable({ focusKey: `tvs-sec-${id}`, onFocus, onSelect });
  return (
    <div
      ref={f.ref}
      tabIndex={-1}
      role="link"
      aria-current={on ? "page" : undefined}
      className={cx("tvs-settings__section", on && "tvs-settings__section--on", f.focused && "tvs-settings__section--focus")}
      onClick={() => f.focusSelf()}
    >
      {label}
    </div>
  );
}

interface RowsProps {
  section: SectionId;
  steppers: Record<string, (dir: -1 | 1, wrap: boolean) => void>;
  focusRow: (key: string, kind: RowKind) => () => void;
}

function SectionRows({ section, steppers, focusRow }: RowsProps) {
  const { settings, save, signedIn, error } = useTvSettings();

  /** A row that steps through a setting's options. */
  const stepRow = (key: StepKey, title: ReactNode, o: { help?: ReactNode; extra?: ReactNode; asSwitch?: boolean; fallback?: unknown } = {}) => {
    const fk = `tvs-row-${key}`;
    const options = OPTIONS[key] as Array<{ value: unknown; label: string }>;
    const value = (settings as unknown as Record<string, unknown>)[key] ?? o.fallback;
    const set = (dir: -1 | 1, wrap: boolean) => {
      const next = step(options, value, dir, wrap);
      if (next !== value) save({ [key]: next } as Partial<TvSettingsX>);
    };
    steppers[fk] = set;
    const e = ends(options, value);
    return (
      <TvRow
        key={fk}
        fk={fk}
        title={title}
        help={o.help}
        extra={o.extra}
        control={o.asSwitch ? { type: "switch", checked: value === true } : { type: "step", label: labelOf(options, value), first: e.first, last: e.last }}
        onFocus={focusRow(fk, "step")}
        onSelect={() => set(1, true)}
      />
    );
  };

  const saved = <p className="tvs-settings__lede">{signedIn ? "Saved to your account, so your other TVs use them too." : "Saved on this TV. Sign in to use them on your other TVs too."}</p>;
  const err = error && (
    <p className="tvs-settings__error" role="alert">
      {error}
    </p>
  );

  switch (section) {
    case "watching":
      return (
        <>
          {saved}
          {stepRow("captions", "Captions", {
            help: "When the station provides them",
            extra: (
              <span className="tvs-settings__cap" style={{ fontSize: CAPTION_PREVIEW_PX[settings.captionSize], lineHeight: `${Math.round(CAPTION_PREVIEW_PX[settings.captionSize] * 1.4)}px` }}>
                Residents question the commission
              </span>
            )
          })}
          {stepRow("captionSize", "Caption size")}
          <ChannelUpRow render={(help) => stepRow("channelUp", "Channel up goes", { help })} dir={settings.channelUp} />
          {stepRow("bannerSeconds", "Banner stays for")}
          {stepRow("tuningSound", "Tuning sound", { help: "A soft hiss when changing channel" })}
          {stepRow("numberWaitSeconds", "After typing a number, tune in", { help: "Or press OK to tune right away" })}
          {stepRow("includeRadioBand", "Include the radio band when changing channel", { asSwitch: true })}
          {err}
        </>
      );
    case "remote":
      return (
        <>
          {saved}
          {stepRow("othersOnWifiCanChange", "Who on the Wi-Fi can change the channel", { help: "While a phone is playing to this TV", fallback: true })}
          <TvRow title="Open the menu" help="On a remote without a Menu key, hold Back" control={{ type: "value", label: "Menu" }} />
          {err}
          <PhoneRows focusRow={focusRow} />
        </>
      );
    case "picture":
      return (
        <>
          {saved}
          {stepRow("quality", "Picture quality", { help: "Auto follows your connection" })}
          {stepRow("eveningOut", "Even out the sound", { help: "So one station isn't much louder than the next", asSwitch: true })}
          {err}
        </>
      );
    case "account":
      return <AccountRows focusRow={focusRow} />;
    case "about":
      return <AboutRows focusRow={focusRow} />;
  }
}

/** "Up the dial, 7.1 to 9.1, like most TVs": this market's first two channels. */
function ChannelUpRow({ dir, render }: { dir: TvSettingsX["channelUp"]; render: (help: string) => ReactNode }) {
  const tv = useDial("tv");
  const channels = (tv.data?.rows ?? []).map((r) => r.station.channel).filter((c): c is string => !!c);
  return <>{render(channelUpHelp(dir, channels))}</>;
}

function AccountRows({ focusRow }: Pick<RowsProps, "focusRow">) {
  const device = useDevice();
  const me = useMe();
  const navigate = useNavigate();
  const signedIn = !!device.token;
  const name = me.data?.displayName ?? device.signedInAs;

  const signOut = async () => {
    // Signed out on this TV whatever the server says: the session ending there is the API's part.
    await signOutThisTv();
    setTimeout(() => focusKey("tvs-row-signin"), 0);
  };

  if (!signedIn)
    return (
      <>
        <TvRow title="Not signed in" help="Signing in adds your presets, reminders and pledges from your phone" control={{ type: "none" }} />
        <TvRow fk="tvs-row-signin" title="Sign in" help="With a code, on your phone" control={{ type: "none" }} onFocus={focusRow("tvs-row-signin", "action")} onSelect={() => navigate("/welcome", { state: { from: "/settings/account" } })} />
      </>
    );
  return (
    <>
      <TvRow title="Signed in as" help={me.data?.email ?? undefined} control={{ type: "value", label: name ?? "" }} />
      <TvRow fk="tvs-row-signout" title="Sign out of this TV" help="Your presets and reminders stay on your account" control={{ type: "none" }} onFocus={focusRow("tvs-row-signout", "action")} onSelect={() => void signOut()} />
      {me.isError && (
        <p className="tvs-settings__error" role="alert">
          {me.error.message}
        </p>
      )}
    </>
  );
}

function AboutRows({ focusRow }: Pick<RowsProps, "focusRow">) {
  const tv = useDial("tv");
  const navigate = useNavigate();
  // Capacitor's core sets window.Capacitor in a browser too: ask it whether this is the app.
  const isApp = isAndroidApp() || isTizenApp();
  return (
    <>
      <TvRow title="Version" control={{ type: "value", label: version }} />
      <TvRow fk="tvs-row-market" title="Your market" control={{ type: "value", label: tv.data?.market.name ?? "" }} onFocus={focusRow("tvs-row-market", "action")} onSelect={() => navigate("/market", { state: { from: "/settings/about" } })} />
      <TvRow title="This TV" control={{ type: "value", label: deviceLine(navigator.userAgent, isApp, nativeInfo()) }} />
    </>
  );
}
