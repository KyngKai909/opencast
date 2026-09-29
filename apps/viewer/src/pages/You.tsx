// You (you 02.1 web, 06.1 and 06.2 phone): presets, reminders, pledges and TVs, in the order
// people use them, then a way into running a station. Settings is a link on the web and the name
// row on the phone. Signed out, it says what an account adds and names the presets on this device.
// /you/pledges/:pledgeId opens a pledge over it; ?modal=tv-code adds a TV.

import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, Button, Icon, useToast } from "@opencast/ui";
import { tvApi, type Tv } from "@opencast/contracts";
import { call } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { useMe, usePresets } from "../data/viewer";
import { useDevice } from "../device/store";
import { useIsPhone, useShellOptions } from "../layout/shell";
import { useNow } from "../lib/clock";
import { useTune } from "../player/PlayerRoot";
import { useCastSession } from "../cast/session";
import { setCached } from "../components/you/cache";
import { PledgeModal } from "../components/you/PledgeModal";
import { PresetTiles } from "../components/you/PresetTiles";
import { TvCodeDialog } from "../components/you/TvCodeDialog";
import { PledgeRows, ReminderRows, RunStation, SignedOutYou, TvRows, comingUp, supportingSub } from "../components/you/YouSections";
import { useMyStation, useOpenChannels, usePledges, useReminders, useRemoveReminder, useTvs } from "../components/you/useYouData";
import "../components/you/sections.css";
import "./You.css";

export default function YouPage() {
  const phone = useIsPhone();
  const auth = useAuth();
  // The phone's You has no top bar (06.1, 06.2); its rows run edge to edge.
  useShellOptions(phone ? { top: null, padded: false } : {});
  const navigate = useNavigate();
  const device = useDevice();
  const { pledgeId } = useParams();

  if (!auth.signedIn)
    return <SignedOutYou form={phone ? "phone" : "web"} devicePresets={device.presets.length} onSignIn={() => auth.openSignIn()} onSettings={() => navigate("/settings")} />;
  return (
    <>
      {phone ? <YouPhone /> : <YouWeb />}
      {pledgeId && <PledgeModal pledgeId={pledgeId} />}
    </>
  );
}

function useYou() {
  const me = useMe();
  const presets = usePresets();
  const reminders = useReminders();
  const pledges = usePledges();
  const tvs = useTvs();
  const session = useCastSession();
  const castingTo = session.status === "casting" || session.status === "mirroring" ? session.target : null;
  const mine = useMyStation();
  const open = useOpenChannels(me.data?.market?.slug ?? null);
  const removeReminder = useRemoveReminder();
  const tune = useTune();
  const now = useNow(60_000);
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const signOutTv = async (tv: Tv) => {
    try {
      const list = await call(tvApi.signOutTv, { params: { tvId: tv.id } });
      setCached(qc, tvApi.listTvs, {}, list);
      toast.show({ message: `${tv.name} is signed out` });
    } catch (e) {
      toast.show({ message: (e as Error).message });
    }
  };
  const tvCode = {
    open: params.get("modal") === "tv-code",
    show: () => setParams((p) => (p.set("modal", "tv-code"), p)),
    close: () => setParams((p) => (p.delete("modal"), p), { replace: true })
  };
  return { me, presets, reminders, pledges, tvs, castingTo, mine, open, removeReminder, tune, now, signOutTv, tvCode };
}

function Placeholder({ rows = 2 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="vw-y-ph" />
      ))}
    </div>
  );
}

function ErrorLine({ error }: { error: unknown }) {
  return (
    <p className="vw-y-error" role="alert">
      {(error as Error).message}
    </p>
  );
}

function YouWeb() {
  const y = useYou();
  const navigate = useNavigate();
  const me = y.me.data;
  const keyed = y.presets.presets.filter((p) => p.key !== null);
  const reminders = y.reminders.data ?? [];
  const pledges = y.pledges.data ?? [];
  const sub = supportingSub(pledges);
  const name = me?.displayName ?? me?.email ?? "";

  return (
    <div className="vw-you">
      <div className="vw-y-pg-h">
        {me ? <Avatar name={name} size={56} decorative /> : <span className="vw-you__avatar-ph" />}
        <div>
          <h1>{name || " "}</h1>
          <p>{me ? [me.displayName ? me.email : null, me.market?.name].filter(Boolean).map((s) => `${s}.`).join(" ") : " "}</p>
        </div>
        <div className="vw-y-pg-h__end">
          <Button size="sm" href="/settings" onClick={(e) => (e.preventDefault(), navigate("/settings"))}>
            Settings
          </Button>
        </div>
      </div>

      <section className="vw-y-sec vw-you__presets" aria-labelledby="vw-you-presets">
        <div className="vw-y-sec-top">
          <h2 id="vw-you-presets">Presets</h2>
          <span className="vw-y-sec-top__sub">Keys 1 to 6 on the web and TV</span>
          <span className="vw-y-sec-top__end">
            <a className="vw-y-link" href="/presets" onClick={(e) => (e.preventDefault(), navigate("/presets"))}>
              Edit
            </a>
          </span>
        </div>
        {y.presets.loading ? <div className="vw-you__keys-ph" /> : <PresetTiles presets={keyed} onTune={(id) => void y.tune(id)} className="vw-you__keys" />}
        {!y.presets.loading && keyed.length === 0 && <p className="vw-y-quiet">Tune in to a station and press Add to presets.</p>}
      </section>

      <div className="vw-you__two">
        <section className="vw-y-sec" aria-labelledby="vw-you-rem">
          <div className="vw-y-sec-top">
            <h2 id="vw-you-rem">Reminders</h2>
            {reminders.length > 0 && <span className="vw-y-sec-top__sub">{comingUp(reminders.length)}</span>}
          </div>
          {y.reminders.isLoading ? <Placeholder rows={3} /> : y.reminders.error ? <ErrorLine error={y.reminders.error} /> : <ReminderRows reminders={reminders} now={y.now} form="web" onRemove={(r) => void y.removeReminder(r)} />}
          {y.reminders.isSuccess && reminders.length === 0 && <p className="vw-y-quiet">Nothing coming up. Press Remind me on anything in the guide.</p>}
        </section>
        <section className="vw-y-sec" aria-labelledby="vw-you-sup">
          <div className="vw-y-sec-top">
            <h2 id="vw-you-sup">Supporting</h2>
            {sub && <span className="vw-y-sec-top__sub">{sub}</span>}
          </div>
          {y.pledges.isLoading ? <Placeholder rows={2} /> : y.pledges.error ? <ErrorLine error={y.pledges.error} /> : <PledgeRows pledges={pledges} displayName={me?.displayName ?? null} form="web" />}
          {y.pledges.isSuccess && pledges.length === 0 && <p className="vw-y-quiet">No pledges yet. Pledge from a station's page, monthly or once.</p>}
        </section>
      </div>

      <section className="vw-y-sec" aria-labelledby="vw-you-tvs">
        <div className="vw-y-sec-top">
          <h2 id="vw-you-tvs">Your TVs</h2>
          <span className="vw-y-sec-top__sub">Where you've watched</span>
        </div>
        {y.tvs.isLoading ? (
          <Placeholder rows={2} />
        ) : (
          <div className="vw-you__tvs">
            {y.tvs.error && <ErrorLine error={y.tvs.error} />}
            <TvRows tvs={y.tvs.data ?? []} castingTo={y.castingTo} now={y.now} form="web" onSignOut={(tv) => void y.signOutTv(tv)} onAdd={y.tvCode.show} />
          </div>
        )}
      </section>

      <RunStation form="web" marketName={me?.market?.name ?? null} open={y.open} mine={y.mine} />
      <TvCodeDialog open={y.tvCode.open} onClose={y.tvCode.close} />
    </div>
  );
}

function YouPhone() {
  const y = useYou();
  const navigate = useNavigate();
  const me = y.me.data;
  const keyed = y.presets.presets.filter((p) => p.key !== null);
  const reminders = y.reminders.data ?? [];
  const pledges = y.pledges.data ?? [];
  const name = me?.displayName ?? me?.email ?? "";

  return (
    <div className="vw-you-p">
      <a className="vw-you-p__top" href="/settings" onClick={(e) => (e.preventDefault(), navigate("/settings"))} aria-label={`${name}, ${me?.market?.name ?? ""}. Settings`}>
        {me ? <Avatar name={name} size={46} decorative /> : <span className="vw-you__avatar-ph" />}
        <span className="vw-you-p__who">
          <b>{name || " "}</b>
          <small>{me?.market?.name ?? " "}</small>
        </span>
        <Icon name="chev" className="vw-you-p__chev" />
      </a>

      <h2 className="vw-y-psec">
        Presets
        <a className="vw-y-link" href="/presets" onClick={(e) => (e.preventDefault(), navigate("/presets"))}>
          Edit
        </a>
      </h2>
      <div className="vw-you-p__keys">{y.presets.loading ? <div className="vw-you__keys-ph" /> : <PresetTiles presets={keyed} compact onTune={(id) => void y.tune(id)} />}</div>

      <h2 className="vw-y-psec">Reminders</h2>
      <div className="vw-you-p__list">
        {y.reminders.isLoading ? <Placeholder rows={2} /> : y.reminders.error ? <ErrorLine error={y.reminders.error} /> : <ReminderRows reminders={reminders} now={y.now} form="phone" />}
        {y.reminders.isSuccess && reminders.length === 0 && <p className="vw-y-quiet">Nothing coming up. Press Remind me on anything in the guide.</p>}
      </div>

      <h2 className="vw-y-psec">Supporting</h2>
      <div className="vw-you-p__list">
        {y.pledges.isLoading ? <Placeholder rows={1} /> : y.pledges.error ? <ErrorLine error={y.pledges.error} /> : <PledgeRows pledges={pledges} displayName={me?.displayName ?? null} form="phone" />}
        {y.pledges.isSuccess && pledges.length === 0 && <p className="vw-y-quiet">No pledges yet. Pledge from a station's page, monthly or once.</p>}
      </div>

      <h2 className="vw-y-psec">Your TVs</h2>
      <div className="vw-you-p__list">
        {y.tvs.isLoading ? <Placeholder rows={1} /> : <TvRows tvs={y.tvs.data ?? []} castingTo={y.castingTo} now={y.now} form="phone" onSignOut={(tv) => void y.signOutTv(tv)} onAdd={y.tvCode.show} />}
        {y.tvs.error && <ErrorLine error={y.tvs.error} />}
      </div>

      <h2 className="vw-y-psec">Run a station</h2>
      <div className="vw-you-p__list">
        <RunStation form="phone" marketName={me?.market?.name ?? null} open={y.open} mine={y.mine} />
      </div>
      <TvCodeDialog open={y.tvCode.open} onClose={y.tvCode.close} />
    </div>
  );
}
