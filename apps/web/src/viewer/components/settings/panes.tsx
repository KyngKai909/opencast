// The eight settings sections (you 05.1, 06.3). Watching and Notifications are drawn; Account,
// Market, TVs and casting, Appearance, Privacy and Your data are built from the section's note
// ("The eight sections", "Privacy says what's kept"), with their copy listed as new.
// Each change saves at once: to the account when signed in, to this device when signed out.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button, Field, Segmented, Toggle, useGround, useToast, type GroundChoice } from "@opencast/ui";
import { accountsApi, type Me, type NotificationTiming } from "@opencast/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, call, endingSessionHere } from "../../../api/client";
import { keyFor } from "../../../api/hooks";
import { setCached } from "../you/cache";
import { useAuth } from "../../../auth/AuthProvider";
import { useMarkets, useMarketSlug } from "../../data/viewer";
import { setDevice, useDevice } from "../../device/store";
import { SettingGroup, SettingRow } from "./SettingRow";
import { useNotificationPrefs, useSettings } from "./useSettings";

export type SectionId = "account" | "market" | "watching" | "notifications" | "tvs" | "appearance" | "privacy" | "data";

export const SECTIONS: ReadonlyArray<{ id: SectionId; label: string }> = [
  { id: "account", label: "Account" },
  { id: "market", label: "Market" },
  { id: "watching", label: "Watching" },
  { id: "notifications", label: "Notifications" },
  { id: "tvs", label: "TVs and casting" },
  { id: "appearance", label: "Appearance" },
  { id: "privacy", label: "Privacy" },
  { id: "data", label: "Your data" }
];

/** The line under a section's heading. */
export function sectionLede(id: SectionId, signedIn: boolean): string | undefined {
  if (id === "watching") return signedIn ? "These apply on this account's phones, computers and TVs." : "These apply on this device until you sign in.";
  if (!signedIn && id !== "account" && id !== "data") return "Saved on this device until you sign in.";
  return undefined;
}

function Err({ error }: { error: string | null }) {
  return error ? (
    <p className="vw-set-err" role="alert">
      {error}
    </p>
  ) : null;
}

// ---------- Account ----------

function AccountPane({ phone }: { phone: boolean }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useSettings();
  const [name, setName] = useState(me?.displayName ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(me?.displayName ?? ""), [me?.displayName]);

  if (!auth.signedIn)
    return (
      <>
        <SettingRow title="You're not signed in" help="Watching never needs an account. Signing in keeps your presets, reminders and pledges on every device and TV." />
        <div className="vw-set-actions">
          <Button variant="primary" onClick={() => auth.openSignIn()}>
            Sign in or create an account
          </Button>
        </div>
      </>
    );

  const saveName = async () => {
    setError(null);
    try {
      const saved = await call(accountsApi.updateMe, { body: { displayName: name.trim() || null } });
      setCached(qc, accountsApi.getMe, {}, saved);
      toast.show({ message: "Name saved" });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const signOut = async () => {
    await auth.signOut();
    navigate("/you");
  };
  const everywhere = async () => {
    setError(null);
    try {
      await endingSessionHere(async () => {
        await call(accountsApi.signOutEverywhere);
        await signOut();
      });
      toast.show({ message: "Signed out everywhere" });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const methods: Record<string, string> = { email: "Email", apple: "Apple", google: "Google", wallet: "Wallet" };

  return (
    <>
      <SettingRow title="What stations call you" help="Only used if you ask to be credited on air when you pledge.">
        <form
          className="vw-set-name"
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <Field size="sm" aria-label="What stations call you" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          <Button size="sm" type="submit" disabled={name.trim() === (me?.displayName ?? "")}>
            Save
          </Button>
        </form>
      </SettingRow>
      <SettingRow title="Email" value={me?.email ?? ""} />
      <SettingGroup>Signing in</SettingGroup>
      {(me?.identities ?? []).map((i) => (
        <SettingRow key={`${i.kind}-${i.value}`} title={methods[i.kind] ?? i.kind} help={i.kind === "email" ? `A six-digit code to ${i.value}` : i.value} />
      ))}
      <SettingRow title={phone ? "Sign out of this phone" : "Sign out of this device"} control={() => <Button size="sm" onClick={() => void signOut()}>Sign out</Button>} />
      <SettingRow title="Sign out everywhere" help="Every phone, computer and TV signed in to this account" control={() => <Button size="sm" onClick={() => void everywhere()}>Sign out everywhere</Button>} />
      <Err error={error} />
    </>
  );
}

// ---------- Market ----------

function MarketPane() {
  const { settings, save, error } = useSettings();
  const markets = useMarkets();
  const slug = useMarketSlug();
  const [, setParams] = useSearchParams();
  const name = markets.data?.find((m) => m.slug === slug)?.name ?? "Not chosen yet";
  return (
    <>
      <SettingRow title="Your market" help={name} control={() => <Button size="sm" onClick={() => setParams((p) => (p.set("modal", "market"), p))}>Change</Button>} />
      <SettingRow
        title="Nearby markets on a thin dial"
        help="When your market has only a few stations, nearby stations follow your own"
        control={({ labelId, helpId }) => <Toggle checked={settings.market?.showNearby ?? true} onChange={(v) => void save({ market: { showNearby: v } })} aria-labelledby={labelId} aria-describedby={helpId} />}
      />
      <Err error={error} />
    </>
  );
}

// ---------- Watching (drawn, 05.1) ----------

export const CAPTION_PX = { small: 12, medium: 15, large: 19 } as const;

function WatchingPane() {
  const { settings, save, error } = useSettings();
  const w = settings.watching ?? {};
  const size = w.captionSize ?? "medium";
  return (
    <>
      <SettingGroup>Captions</SettingGroup>
      <SettingRow
        title="Show captions"
        help="When a station provides them"
        control={() => (
          <Segmented
            size="sm"
            label="Show captions"
            value={w.captions ?? "off"}
            onChange={(v) => void save({ watching: { captions: v } })}
            options={[
              { value: "off", label: "Off" },
              { value: "on", label: "On" },
              { value: "muted_only", label: "Muted only" }
            ]}
          />
        )}
      />
      <SettingRow
        title="Size"
        help={
          <>
            Preview:{" "}
            <span className="vw-set-cap" style={{ fontSize: CAPTION_PX[size] }}>
              Residents question the commission
            </span>
          </>
        }
        control={() => (
          <Segmented
            size="sm"
            label="Caption size"
            value={size}
            onChange={(v) => void save({ watching: { captionSize: v } })}
            options={[
              { value: "small", label: "Small" },
              { value: "medium", label: "Medium" },
              { value: "large", label: "Large" }
            ]}
          />
        )}
      />
      <SettingGroup>When Opencast opens</SettingGroup>
      <SettingRow
        title="Start on"
        help="On TVs it always opens on the last channel"
        control={() => (
          <Segmented
            size="sm"
            label="Start on"
            value={w.startOn ?? "dial"}
            onChange={(v) => void save({ watching: { startOn: v } })}
            options={[
              { value: "dial", label: "The dial" },
              { value: "last_channel", label: "Last channel" }
            ]}
          />
        )}
      />
      <SettingRow
        title="Muted previews on the dial"
        help="The live hero plays with no sound"
        control={({ labelId, helpId }) => <Toggle checked={w.mutedPreviews ?? true} onChange={(v) => void save({ watching: { mutedPreviews: v } })} aria-labelledby={labelId} aria-describedby={helpId} />}
      />
      <SettingRow
        title="Tuning sound"
        help="A soft hiss when changing channel. Always on for the radio band unless turned off there"
        control={({ labelId, helpId }) => <Toggle checked={w.tuningSound ?? false} onChange={(v) => void save({ watching: { tuningSound: v } })} aria-labelledby={labelId} aria-describedby={helpId} />}
      />
      <SettingGroup>Playback</SettingGroup>
      <SettingRow
        title="Quality on mobile data"
        help="Data saver uses about 300 MB an hour"
        control={() => (
          <Segmented
            size="sm"
            label="Quality on mobile data"
            value={w.mobileQuality ?? "auto"}
            onChange={(v) => void save({ watching: { mobileQuality: v } })}
            options={[
              { value: "auto", label: "Auto" },
              { value: "data_saver", label: "Data saver" }
            ]}
          />
        )}
      />
      <SettingRow
        title="Keep playing in the background"
        help="Sound continues with the screen off or another app open"
        control={({ labelId, helpId }) => <Toggle checked={w.backgroundPlay ?? true} onChange={(v) => void save({ watching: { backgroundPlay: v } })} aria-labelledby={labelId} aria-describedby={helpId} />}
      />
      <SettingRow title="Pause holds for" help="Then the player offers Back to live" value="30 minutes" />
      <Err error={error} />
    </>
  );
}

// ---------- Notifications (drawn, 06.3) ----------

/** Whether this browser will show notifications: null when it can't say. */
function usePushBlocked(): [boolean, () => Promise<void>] {
  const read = () => typeof Notification !== "undefined" && Notification.permission === "denied";
  const [blocked, setBlocked] = useState(read);
  const ask = async () => {
    if (typeof Notification === "undefined" || Notification.permission !== "default") return setBlocked(read());
    const r = await Notification.requestPermission().catch(() => "denied" as NotificationPermission);
    setBlocked(r === "denied");
  };
  return [blocked, ask];
}

/** "At the start", or "10 minutes before" (O2's leadMinutes). */
export function leadLine(minutes: number | undefined): string {
  if (!minutes) return "At the start";
  if (minutes % 60 === 0) return minutes === 60 ? "An hour before" : `${minutes / 60} hours before`;
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"} before`;
}

/** "22:00" to "10:00 pm". */
function clockOf(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** Quiet hours' window: 10:00 pm to 8:00 am unless the account says otherwise (O2). */
export function quietLine(t: Pick<NotificationTiming, "quietFrom" | "quietTo">): string {
  return `Nothing between ${clockOf(t.quietFrom ?? "22:00")} and ${clockOf(t.quietTo ?? "08:00")}`;
}

function NotificationsPane({ phone }: { phone: boolean }) {
  const { prefs, set, error } = useNotificationPrefs();
  const { settings, save, error: saveError } = useSettings();
  const [blocked, askPush] = usePushBlocked();
  const timing: NotificationTiming = settings.notifications ?? {};
  const on = (kind: string, ch: "push" | "email") => prefs[kind]?.[ch] ?? false;
  const push = (kind: string) => async (v: boolean) => {
    if (v) await askPush();
    await set(kind, { push: v });
  };
  const toggle = (checked: boolean, onChange: (v: boolean) => void) => ({ labelId, helpId }: { labelId: string; helpId: string }) => (
    <Toggle checked={checked} onChange={(v) => void onChange(v)} aria-labelledby={labelId} aria-describedby={helpId} />
  );
  return (
    <>
      <SettingGroup>Reminders</SettingGroup>
      <SettingRow title={phone ? "On this phone" : "In this browser"} help="A notification when it starts" control={toggle(on("reminder", "push"), push("reminder"))} />
      <SettingRow title="By email" help="The evening before" control={toggle(on("reminder", "email"), (v) => void set("reminder", { email: v }))} />
      <SettingRow title="How early" value={leadLine(timing.leadMinutes)} />
      <SettingGroup>Your presets</SettingGroup>
      <SettingRow title="When a preset goes live" help="For live programs only, not scheduled ones" control={toggle(on("preset_live", "push"), push("preset_live"))} />
      <SettingRow title="Quiet hours" help={quietLine(timing)} control={toggle(timing.quietHours ?? true, (v) => void save({ notifications: { quietHours: v } }))} />
      <SettingGroup>Stations you support</SettingGroup>
      <SettingRow title="Station news" help="No more than one a month per station" control={toggle(on("station_news", "push") || on("station_news", "email"), (v) => void set("station_news", { push: v, email: v }))} />
      {blocked && <p className="vw-set-note">This browser is blocking notifications from Opencast. Allow them in its settings to get them here.</p>}
      <Err error={error ?? saveError} />
      <p className="vw-set-close">Opencast never sends notifications about programs you didn't ask about.</p>
    </>
  );
}

// ---------- TVs and casting ----------

function TvsPane() {
  const { settings, save, error } = useSettings();
  const navigate = useNavigate();
  const t = settings.tvs ?? {};
  return (
    <>
      <SettingRow
        title="Lock-screen remote"
        help="Channel up and down on the lock screen while something plays"
        control={({ labelId, helpId }) => <Toggle checked={t.lockScreenRemote ?? true} onChange={(v) => void save({ tvs: { lockScreenRemote: v } })} aria-labelledby={labelId} aria-describedby={helpId} />}
      />
      <SettingRow
        title="Let others on the Wi-Fi change channel"
        help="On Opencast TVs and Chromecast. AirPlay follows the phone that started it."
        control={({ labelId, helpId }) => <Toggle checked={t.othersOnWifiCanChange ?? true} onChange={(v) => void save({ tvs: { othersOnWifiCanChange: v } })} aria-labelledby={labelId} aria-describedby={helpId} />}
      />
      <SettingRow title="Your TVs" help="The TVs signed in to this account, and where you've cast, are on You." control={() => <Button size="sm" onClick={() => navigate("/you")}>Open You</Button>} />
      <Err error={error} />
    </>
  );
}

// ---------- Appearance ----------

function AppearancePane() {
  const { settings, save, error } = useSettings();
  const ground = useGround();
  const a = settings.appearance ?? {};
  const reduce = a.reducedMotion ?? false;
  return (
    <>
      <SettingRow
        title="Ground"
        help="Dark is the default. TV mode is always dark."
        control={() => (
          <Segmented<GroundChoice>
            size="sm"
            label="Ground"
            value={ground.choice}
            onChange={(v) => {
              ground.setChoice(v);
              void save({ appearance: { ground: v } });
            }}
            options={[
              { value: "system", label: "Match the system" },
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" }
            ]}
          />
        )}
      />
      <SettingRow
        title="Reduce motion"
        help="The ON AIR sign comes on without its flicker, and nothing slides"
        control={({ labelId, helpId }) => <Toggle checked={reduce} onChange={(v) => void save({ appearance: { reducedMotion: v } })} aria-labelledby={labelId} aria-describedby={helpId} />}
      />
      <Err error={error} />
    </>
  );
}

// ---------- Privacy ----------

function PrivacyPane() {
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const refreshHistory = () => void qc.invalidateQueries({ queryKey: keyFor(accountsApi.getWatchHistory).slice(0, 2) });
  const { settings, save, error } = useSettings();
  const [clearError, setClearError] = useState<string | null>(null);
  const keep = settings.privacy?.keepWatchHistory ?? true;
  const clear = async () => {
    setClearError(null);
    try {
      if (auth.signedIn) await call(accountsApi.clearWatchHistory);
      setDevice({ lastStationId: null });
      refreshHistory();
      toast.show({ message: "Watch history cleared" });
    } catch (e) {
      setClearError((e as Error).message);
    }
  };
  return (
    <>
      <SettingRow title="Location" help="Used once to pick a market, and isn't stored." />
      <SettingRow
        title="Keep watch history"
        help={'Kept for 30 days to resume and power "last channel"'}
        control={({ labelId, helpId }) => <Toggle checked={keep} onChange={(v) => void save({ privacy: { keepWatchHistory: v } }).then(refreshHistory)} aria-labelledby={labelId} aria-describedby={helpId} />}
      />
      <SettingRow title="Clear watch history" help="Starts fresh, here and on the account" control={() => <Button size="sm" onClick={() => void clear()}>Clear</Button>} />
      <SettingRow title="What stations see" help="Tuned-in counts that stations see are anonymous." />
      <Err error={error ?? clearError} />
    </>
  );
}

// ---------- Your data ----------

/** Why the account can't be deleted yet (A3's 409s), in the viewer's words. */
export function deleteRefusal(e: unknown, me: Pick<Me, "memberships"> | null): string {
  if (e instanceof ApiError && e.code === "owns_station") {
    const owned = me?.memberships.find((m) => m.kind === "station" && m.role === "owner");
    const name = owned?.kind === "station" ? [owned.station.callSign, owned.station.channel].filter(Boolean).join(" ") || owned.station.name : "a station";
    return `You own ${name}. Make someone on its team the owner in master control first, then delete your account.`;
  }
  if (e instanceof ApiError && e.code === "owns_business") return "You own a business on Opencast. Write to us to hand it over first, then delete your account.";
  return (e as Error).message;
}

/** Saves the account's data (A3's downloadData) as a file. */
export function saveAsFile(data: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The emailed link (/settings/data?download=1, A3) opens here: signed in, the file is made and
 * saved; signed out, sign-in comes first.
 */
function useDownloadFromLink(setError: (e: string | null) => void) {
  const auth = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const asked = params.get("download") === "1";
  const run = async () => {
    setError(null);
    try {
      const data = await call(accountsApi.downloadData);
      saveAsFile(data, `opencast-data-${data.exportedAt.slice(0, 10)}.json`);
      toast.show({ message: "Your data is downloaded" });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (!asked || !auth.ready) return;
    setParams((p) => (p.delete("download"), p), { replace: true });
    auth.requireSignIn({ kind: "general", label: "download your data", finish: "Download and go back" }, () => runRef.current());
    // Once per link: the parameter is gone after this.
  }, [asked, auth.ready]); // eslint-disable-line react-hooks/exhaustive-deps
}

function DataPane({ phone }: { phone: boolean }) {
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const device = useDevice();
  const { me } = useSettings();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Why deleting was refused: worded when shown, with the account as it's known by then.
  const [refusal, setRefusal] = useState<unknown>(null);
  const where = phone ? "phone" : "device";
  useDownloadFromLink(setError);

  if (!auth.signedIn) {
    const n = device.presets.length;
    const r = device.reminders.length;
    return (
      <>
        <SettingRow
          title={`What's on this ${where}`}
          help={`${n} ${n === 1 ? "preset" : "presets"}, ${r} ${r === 1 ? "reminder" : "reminders"} and your settings`}
          control={() => (
            <Button
              size="sm"
              onClick={() => {
                setDevice({ presets: [], reminders: [], settings: {}, lastStationId: null });
                toast.show({ message: `Cleared this ${where}` });
              }}
            >
              Clear this {where}
            </Button>
          )}
        />
        <Err error={error} />
      </>
    );
  }

  // The file is made when the emailed link is opened here, signed in (A3).
  const download = async () => {
    setError(null);
    setRefusal(null);
    try {
      const r = await call(accountsApi.exportData);
      toast.show({ message: `We emailed a link to ${r.email}. Open it to download the file.` });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    setError(null);
    setRefusal(null);
    try {
      await endingSessionHere(async () => {
        await call(accountsApi.deleteAccount);
        await auth.signOut();
      });
      navigate("/");
      toast.show({ message: "Your account is deleted" });
    } catch (e) {
      setConfirm(false);
      setRefusal(e);
    }
  };

  return (
    <>
      <SettingRow title="Download your data" help="Presets, reminders, pledges, receipts and settings, in one file" control={() => <Button size="sm" onClick={() => void download()}>Download</Button>} />
      <SettingRow
        title="Delete your account"
        help={confirm ? "This can't be undone. Your presets, reminders and TVs go now; pledges stop after this month." : "Presets, reminders and TVs go. Pledges stop after this month."}
        control={() =>
          confirm ? (
            <span className="vw-set-pair">
              <Button size="sm" onClick={() => setConfirm(false)}>
                Keep it
              </Button>
              <Button size="sm" className="vw-set-danger" onClick={() => void remove()}>
                Delete account
              </Button>
            </span>
          ) : (
            <Button size="sm" className="vw-set-danger" onClick={() => setConfirm(true)}>
              Delete account
            </Button>
          )
        }
      />
      <Err error={error ?? (refusal ? deleteRefusal(refusal, me) : null)} />
    </>
  );
}

export function SectionPane({ id, phone }: { id: SectionId; phone: boolean }): ReactNode {
  switch (id) {
    case "account":
      return <AccountPane phone={phone} />;
    case "market":
      return <MarketPane />;
    case "watching":
      return <WatchingPane />;
    case "notifications":
      return <NotificationsPane phone={phone} />;
    case "tvs":
      return <TvsPane />;
    case "appearance":
      return <AppearancePane />;
    case "privacy":
      return <PrivacyPane />;
    case "data":
      return <DataPane phone={phone} />;
  }
}
