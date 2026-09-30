// You's sections (you 02.1 on the web, 06.2 on the phone): reminders, pledges, TVs, running a
// station, and You signed out (06.1). Ruled rows, not cards.

import { useNavigate } from "react-router";
import type { Reminder } from "@opencast/contracts";
import { Button, Icon, IconButton, Tag, clock, money } from "@opencast/ui";
import type { Pledge, Tv } from "@opencast/contracts";
import { platformLabel } from "../../cast/targets";
import type { CastTarget } from "../../cast/types";
import { MARKET_TZ } from "../../../lib/clock";
import { dayLabel, identText, lastUsedLabel, monthlyTotal, openChannelsLine, pledgeAmount, pledgeLine } from "./youRules";
import { CONTROL } from "../../../areas";

type Form = "web" | "phone";

// ---------- Reminders ----------

export function ReminderRows({ reminders, now, form, onRemove }: { reminders: Reminder[]; now: Date; form: Form; onRemove?: (r: Reminder) => void }) {
  return (
    <>
      {reminders.map((r) => {
        const station = `${identText(r.airing.station)}${r.airing.listed && form === "web" ? ", external" : ""}`;
        return (
          <div key={r.id} className={`vw-y-rem vw-y-rem--${form}`}>
            <span className="vw-y-rem__when">
              {dayLabel(r.airing.startsAt, now, MARKET_TZ)}
              <br />
              {clock(r.airing.startsAt, { timeZone: MARKET_TZ })}
            </span>
            <div className="vw-y-rem__w">
              <b>{r.airing.title}</b>
              <small>{form === "phone" && r.switchMeOver ? `${station}, switch me over` : station}</small>
              {form === "web" && r.switchMeOver && (
                <span className="vw-y-rem__flag">
                  <Icon name="check" size={14} />
                  Switch me over at {clock(r.airing.startsAt, { timeZone: MARKET_TZ, suffix: false })}
                </span>
              )}
            </div>
            {onRemove && form === "web" && <IconButton icon="x" bare label={`Remove reminder for ${r.airing.title}`} onClick={() => onRemove(r)} />}
          </div>
        );
      })}
    </>
  );
}

/** "3 coming up". */
export function comingUp(n: number): string {
  return `${n} coming up`;
}

// ---------- Supporting ----------

export function supportingSub(pledges: Pledge[]): string | null {
  const total = monthlyTotal(pledges);
  return total > 0 ? `${money(total)} a month` : null;
}

function Swatch({ p, size }: { p: Pledge; size: number }) {
  return (
    <span className="vw-y-pl__sw" style={{ background: p.station.colour ?? "var(--ink-50)", width: size, height: size }} aria-hidden="true">
      {p.station.callSign}
    </span>
  );
}

export function PledgeRows({ pledges, displayName, form }: { pledges: Pledge[]; displayName: string | null; form: Form }) {
  const navigate = useNavigate();
  const open = (p: Pledge) => navigate(`/you/pledges/${p.id}`);
  return (
    <>
      {pledges.map((p) => {
        const { amount, per } = pledgeAmount(p);
        if (form === "phone")
          return (
            <button key={p.id} type="button" className="vw-y-pl vw-y-pl--phone" onClick={() => open(p)} aria-label={`${p.station.name}, ${amount} ${per}. ${p.cadence === "monthly" ? "Manage" : "Receipt"}`}>
              <Swatch p={p} size={40} />
              <span className="vw-y-pl__w">
                <b>{p.station.name}</b>
                <small>{p.cadence === "monthly" ? (p.endsAfter ? pledgeLine(p, displayName, MARKET_TZ) : "Monthly") : pledgeLine(p, displayName, MARKET_TZ)}</small>
              </span>
              <span className="vw-y-pl__amt oc-mono">{amount}</span>
            </button>
          );
        return (
          <div key={p.id} className="vw-y-pl">
            <Swatch p={p} size={44} />
            <div className="vw-y-pl__w">
              <b>{p.station.name}</b>
              <small>{pledgeLine(p, displayName, MARKET_TZ)}</small>
            </div>
            <span className="vw-y-pl__amt">
              <span className="oc-mono">{amount}</span>
              <small>{per}</small>
            </span>
            <Button size="sm" onClick={() => open(p)} aria-label={`${p.cadence === "monthly" ? "Manage" : "Receipt"}, ${p.station.name}`}>
              {p.cadence === "monthly" ? "Manage" : "Receipt"}
            </Button>
          </div>
        );
      })}
    </>
  );
}

// ---------- Your TVs ----------

/** The row's second line: the TV app's platform and whether it's on now; a cast target's kind and when it was last used. */
export function tvLine(tv: Tv, now: Date): string {
  if (tv.kind === "tv_app") {
    const platform = platformLabel(tv.platform);
    return `Opencast app${platform ? ` on ${platform}` : ""}${tv.online ? ", on now" : tv.signedIn ? ", signed in" : ""}`;
  }
  const kind = tv.kind === "chromecast" ? "Chromecast" : "AirPlay";
  return tv.lastUsedAt ? `${kind}. Last used ${lastUsedLabel(tv.lastUsedAt, now, MARKET_TZ)}` : kind;
}

/**
 * Whether this TV is being watched from here now. The server knows it for TV apps (a phone on the
 * account is on its remote); a Chromecast or AirPlay TV only this phone's session can say.
 */
export function castingNow(tv: Tv, castingTo: CastTarget | null): boolean {
  if (tv.castingNow) return true;
  if (!castingTo || castingTo.kind !== tv.kind) return false;
  return tv.kind === "tv_app" ? castingTo.id === tv.id : castingTo.name.toLowerCase() === tv.name.toLowerCase();
}

export function TvRows({
  tvs,
  castingTo = null,
  now,
  form,
  onSignOut,
  onAdd
}: {
  tvs: Tv[];
  castingTo?: CastTarget | null;
  now: Date;
  form: Form;
  onSignOut?: (tv: Tv) => void;
  onAdd?: () => void;
}) {
  return (
    <>
      {tvs.map((tv) => {
        const casting = castingNow(tv, castingTo);
        const canSignOut = tv.kind === "tv_app" && tv.signedIn && !!onSignOut;
        return (
        <div key={tv.id} className={`vw-y-dev vw-y-dev--${form}`}>
          <span className="vw-y-dev__ic" aria-hidden="true">
            <Icon name={tv.kind === "tv_app" ? "tv" : "cast"} size={20} />
          </span>
          <div className="vw-y-dev__w">
            <b>{tv.name}</b>
            <small>{form === "phone" && casting ? "Casting now" : tvLine(tv, now)}</small>
          </div>
          {form === "web" && casting ? (
            <Tag>Casting now</Tag>
          ) : canSignOut ? (
            <Button size="sm" onClick={() => onSignOut?.(tv)} aria-label={`Sign out ${tv.name}`}>
              Sign out
            </Button>
          ) : (
            <span />
          )}
        </div>
        );
      })}
      {onAdd && (
        <div className={`vw-y-dev vw-y-dev--${form}`}>
          <span className="vw-y-dev__ic" aria-hidden="true">
            <Icon name="tv" size={20} />
          </span>
          <div className="vw-y-dev__w">
            <b>Add a TV</b>
            <small>Open Opencast on the TV and enter its code</small>
          </div>
          <Button size="sm" onClick={onAdd}>
            Enter a code
          </Button>
        </div>
      )}
    </>
  );
}

// ---------- Run a station ----------

export interface RunStationProps {
  form: Form;
  marketName: string | null;
  open: { tv: number | null; radio: number | null; loading: boolean };
  mine: { station: { name: string; callSign: string | null; channel: string | null }; onAir: boolean | null } | null;
}

export function runStationLines({ marketName, open, mine }: Omit<RunStationProps, "form">): { heading: string; line: string | null } {
  if (mine) {
    const state = mine.onAir === null ? null : mine.onAir ? "on air" : "off air";
    return { heading: mine.station.name, line: state ? `${identText(mine.station)}, ${state}` : identText(mine.station) };
  }
  if (open.tv === null || open.radio === null || !marketName) return { heading: "Run a station", line: open.loading ? null : "Setting up takes about 20 minutes." };
  return { heading: "Run a station", line: openChannelsLine(marketName, open.tv, open.radio) };
}

export function RunStation(props: RunStationProps) {
  const { heading, line } = runStationLines(props);
  if (props.form === "phone")
    return (
      <a className="vw-y-run vw-y-run--phone" href={CONTROL}>
        <span className="vw-y-run__w">
          <b>{props.mine ? heading : "Run a station or offer your programs"}</b>
          {line && <small>{line}</small>}
        </span>
        <Icon name="chev" />
      </a>
    );
  return (
    <section className="vw-y-run" aria-labelledby="vw-y-run-h">
      <div>
        <h2 id="vw-y-run-h">{heading}</h2>
        {line ? <p>{line}</p> : <p className="vw-y-run__loading" aria-hidden="true" />}
      </div>
      <Button href={CONTROL}>Open master control</Button>
    </section>
  );
}

// ---------- Signed out (06.1) ----------

export function SignedOutYou({ form, devicePresets, onSignIn, onSettings }: { form: Form; devicePresets: number; onSignIn: () => void; onSettings: () => void }) {
  const where = form === "phone" ? "phone" : "device";
  const presetsLine = devicePresets > 0 ? `You have ${devicePresets} on this ${where}. Keep ${devicePresets === 1 ? "it" : "them"} on your TV too.` : "Keys 1 to 6 on the web, your phone and your TV.";
  return (
    <div className={`vw-y-out vw-y-out--${form}`}>
      <h1>You're watching without an account.</h1>
      <p className="vw-y-out__lede">That's fine for everything on the dial. An account adds:</p>
      <div className="vw-y-out__rows">
        <div className="vw-y-out__row">
          <b>Presets everywhere</b>
          <small>{presetsLine}</small>
        </div>
        <div className="vw-y-out__row">
          <b>Reminders</b>
          <small>A nudge before a program starts</small>
        </div>
        <div className="vw-y-out__row">
          <b>Pledges</b>
          <small>Support a station monthly or once</small>
        </div>
        <div className="vw-y-out__row">
          <b>Your TVs</b>
          <small>Sign in on a TV with a code</small>
        </div>
      </div>
      <Button variant="primary" block className="vw-y-out__signin" onClick={onSignIn}>
        Sign in or create an account
      </Button>
      <Button block className="vw-y-out__settings" href="/settings" onClick={(e) => (e.preventDefault(), onSettings())}>
        Settings
      </Button>
    </div>
  );
}
