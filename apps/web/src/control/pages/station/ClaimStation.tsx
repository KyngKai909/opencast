// rights 05.1 claiming a station (/control/claim/:token), outside the shell and reachable signed out: it
// asks for sign-in itself. What the station has aired, its audience, what it earned (held in
// escrow), and three steps to take it over. Saying no is one link. The handover waits 72 hours in
// public before paying out, so a wrong claimant can be stopped.

import { useState } from "react";
import { useParams } from "react-router";
import { networkApi, type ClaimPage } from "@opencast/contracts";
import { Avatar, Button, KeyValueList, Lockup, Modal, StationBand, StatRow, StepRail, clock, money, type Step } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { call, ApiError } from "../../../api/client";
import { useApi } from "../../../api/hooks";
import { useAuth } from "../../../auth/AuthProvider";
import { longDate, marketName, shortAddress } from "../../components/station/format";
import { STATION_TZ, useNow } from "../../../lib/clock";
import { useMe } from "../../station/StationContext";
import { NotFound, Quiet } from "../common";
import SignIn from "../SignIn";
import "./ClaimStation.css";
import { controlPath } from "../../../areas";

const PLATFORM: Record<ClaimPage["sourcePlatform"], string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  internet_archive: "Internet Archive",
  instagram: "Instagram",
  facebook: "Facebook",
  soundcloud: "SoundCloud",
  bandcamp: "Bandcamp",
  other: "source"
};

const DAY = 86_400_000;

/** Where the handover stands, for the page: the steps' states and what the third one says. */
export function claimSteps(p: Pick<ClaimPage, "handover">, signedInAsThem: boolean): { signIn: Step["state"]; prove: Step["state"]; takeOver: Step["state"] } {
  const h = p.handover?.kind === "claim" ? p.handover : null;
  if (!signedInAsThem) return { signIn: "current", prove: "todo", takeOver: "todo" };
  if (!h || h.status === "cancelled") return { signIn: "done", prove: "current", takeOver: "todo" };
  if (h.status === "verifying") return { signIn: "done", prove: "current", takeOver: "todo" };
  if (h.status === "completed") return { signIn: "done", prove: "done", takeOver: "done" };
  return { signIn: "done", prove: "done", takeOver: "current" };
}

export default function ClaimStation() {
  const { token = "" } = useParams();
  const auth = useAuth();
  const me = useMe();
  const qc = useQueryClient();
  const now = useNow(30_000);
  const [signingIn, setSigningIn] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const page = useApi(networkApi.getClaimPage, { params: { token } }, {
    retry: false,
    // While the desk checks the account, look again every couple of seconds.
    refetchInterval: (q) => ((q.state.data as ClaimPage | undefined)?.handover?.status === "verifying" ? 2000 : false)
  });

  if (signingIn && !auth.signedIn) return <SignIn />;
  if (page.isLoading) return <Quiet />;
  if (!page.data) {
    if (page.error instanceof ApiError && page.error.status === 404) return <NotFound />;
    return (
      <main className="cc-claimpage">
        <p className="cc-claimpage__error" role="alert">
          {(page.error as Error | null)?.message ?? "Something went wrong. Try again."}
        </p>
      </main>
    );
  }

  const p = page.data;
  const st = p.station;
  const cs = st.callSign ?? st.name;
  const platform = PLATFORM[p.sourcePlatform];
  const held = money(p.heldMicros);
  const days = p.onAirSince ? Math.max(0, Math.floor((now.getTime() - Date.parse(p.onAirSince)) / DAY)) : 0;
  const myName = me.data?.displayName ?? me.data?.email ?? null;
  const asThem = auth.signedIn && !!myName && myName === p.personName;
  const steps = claimSteps(p, asThem);
  const h = p.handover;
  const stopAsked = h?.kind === "stop" && h.status !== "cancelled";
  const band = [st.band === "radio" ? "Radio band" : "TV band", marketName(st.marketSlug)].filter(Boolean).join(", ");

  const start = async (kind: "claim" | "stop") => {
    if (!auth.signedIn) return setSigningIn(true);
    setBusy(true);
    setError(null);
    try {
      // The real connect is the source platform's sign-in (request N10); the mock takes its word.
      await call(networkApi.startHandover, { params: { stationId: st.id }, body: { kind, sourceAccountProof: `${p.sourcePlatform}:connected` } });
      await qc.invalidateQueries({ queryKey: [networkApi.getClaimPage.method, networkApi.getClaimPage.path] });
      setStopping(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const signInDetail = !auth.signedIn
    ? `As ${p.personName}`
    : asThem
      ? `As ${p.personName}`
      : `Signed in as ${(myName ?? "someone else").replace(/\.$/, "")}. This station is waiting for ${p.personName}.`;
  const proveDetail =
    h?.kind === "claim" && h.status === "verifying"
      ? `Checking your ${platform} account. This takes a moment.`
      : steps.prove === "done"
        ? `${platform} connected`
        : `Connect the ${platform} account ${p.worksShort} come from`;
  const takeOverDetail =
    h?.kind === "claim" && h.status === "waiting_period" && h.payableAfter
      ? `You become ${cs}'s owner on ${longDate(h.payableAfter, STATION_TZ)} at ${clock(h.payableAfter, { timeZone: STATION_TZ })}, and the ${held} is paid from escrow to your wallet. Until then, anyone who sees a mistake can stop it.`
      : h?.kind === "claim" && h.status === "completed"
        ? `You're ${cs}'s owner. The ${held} is on its way to your wallet.`
        : `You become ${cs}'s owner. The ${held} is paid from escrow to your wallet 72 hours after you're verified`;

  return (
    <div className="cc-claimpage">
      <header className="cc-claimpage__head">
        <Lockup size="app" />
        <span className="cc-claimpage__app">Claim your station</span>
        {auth.signedIn && myName && <Avatar name={myName} className="cc-claimpage__av" />}
      </header>
      <main className="cc-claimpage__main">
        <p className="cc-claimpage__kick">For {p.personName}</p>
        <h1 className="cc-claimpage__h">{steps.takeOver === "done" ? `${cs} ${st.channel} is yours.` : `${cs} ${st.channel} is ready for you.`}</h1>
        <p className="cc-claimpage__lede">
          {p.saidYesAt ? `You said yes on ${longDate(p.saidYesAt, STATION_TZ)}. Since then, Opencast's team has run` : "Opencast's team has run"} {p.works} on the {marketName(st.marketSlug)} dial. Everything below becomes yours when you claim it.
        </p>
        <StationBand channel={st.channel ?? ""} callSign={cs} colour={st.colour ?? "#7E2F35"} name={st.name} place={band} rounded className="cc-claimpage__band" />
        <StatRow
          size="sm"
          className="cc-claimpage__stats"
          stats={[
            { value: String(days), caption: "Days on air" },
            { value: String(p.presetCount), caption: `Listeners with ${cs} as a preset` },
            { amount: p.heldMicros, caption: "Earned, held in escrow for you" }
          ]}
        />
        {stopAsked ? (
          <div className="cc-claimpage__stopped" role="status">
            <b>You asked us to sign {cs} off.</b>
            <small>It leaves the dial within a day, and the {held} it earned is paid to your wallet. Nothing else is needed from you.</small>
          </div>
        ) : (
          <StepRail
            variant="list"
            label={`Claiming ${cs} ${st.channel}`}
            steps={[
              {
                label: "Sign in",
                detail: signInDetail,
                state: steps.signIn,
                action: !auth.signedIn ? (
                  <Button variant="primary" size="sm" onClick={() => setSigningIn(true)}>
                    Sign in
                  </Button>
                ) : !asThem ? (
                  <Button size="sm" onClick={() => void auth.signOut()}>
                    Sign out
                  </Button>
                ) : undefined
              },
              {
                label: "Show it's you",
                detail: proveDetail,
                state: steps.prove,
                action:
                  asThem && steps.prove === "current" && !(h?.kind === "claim" && h.status === "verifying") ? (
                    <Button variant="primary" size="sm" onClick={() => void start("claim")} disabled={busy}>
                      Connect {platform}
                    </Button>
                  ) : undefined
              },
              {
                label: "Take it over",
                detail: takeOverDetail,
                state: steps.takeOver,
                action:
                  steps.takeOver === "done" ? (
                    <Button variant="primary" size="sm" href={controlPath(`/${cs.toLowerCase()}/monitor`)}>
                      Open master control
                    </Button>
                  ) : undefined
              }
            ]}
          />
        )}
        {error && (
          <p className="cc-claimpage__error" role="alert">
            {error}
          </p>
        )}
        <KeyValueList
          variant="rows"
          className="cc-claimpage__check"
          items={[
            {
              title: "Check it yourself",
              detail: `Held for station #${p.escrowStationId} in a public escrow contract${p.escrowContract ? `, ${shortAddress(p.escrowContract)}` : ""}. It can only pay you`,
              amount: p.heldMicros
            }
          ]}
        />
        {!stopAsked && steps.takeOver !== "done" && (
          <p className="cc-claimpage__no">
            Not what you want?{" "}
            <Button variant="text" onClick={() => (auth.signedIn ? setStopping(true) : setSigningIn(true))}>
              Ask us to sign it off
            </Button>
            . We'll take it off the dial within a day and pay out what it earned.
          </p>
        )}
      </main>
      <Modal
        open={stopping}
        onClose={() => setStopping(false)}
        title={`Sign ${cs} off?`}
        footer={
          <>
            <Button onClick={() => setStopping(false)}>Keep it on</Button>
            <Button variant="primary" onClick={() => void start("stop")} disabled={busy || !asThem}>
              Sign it off
            </Button>
          </>
        }
      >
        <p className="cc-claimpage__modal-p">
          {asThem
            ? `We'll take ${cs} off the dial within a day and pay the ${held} it earned to your wallet. Connecting your ${platform} account shows us it's you.`
            : `Only ${p.personName} can ask for this. Sign in as them first.`}
        </p>
      </Modal>
    </div>
  );
}
