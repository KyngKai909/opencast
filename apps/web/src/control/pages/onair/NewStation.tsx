// `/new`: A.1 before the station exists. The first thing saved starts it (stations.createStation),
// and setup carries on at /setup/:stationId/station.
//
// `/new?reservation=<id>` (added 2026-09-29) is a waitlist invite's link. Like a team invite's page
// it's reachable signed out: it says what's held and asks for sign-in. Signed in with the email the
// call sign was reserved with, setup opens with the call sign filled in and locked and the channel
// held chosen. Signed in as someone else, or once the hold has ended, it says so.

import { useState, type ReactNode } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { waitlistApi, type ReservationInvite } from "@opencast/contracts";
import { Button, ControlSetupShell } from "@opencast/ui";
import { ApiError, call } from "../../../api/client";
import { useAuth } from "../../../auth/AuthProvider";
import { config } from "../../../config";
import { STATION_TZ } from "../../../lib/clock";
import { StationForm } from "../../components/onair/StationForm";
import { useInAppLinks } from "../../layout/links";
import { CONTROL, controlPath } from "../../../areas";
import { NotFound, Quiet } from "../common";
import SignIn from "../SignIn";
import "../station/AcceptInvite.css";

export default function NewStation() {
  useInAppLinks();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const reservationId = params.get("reservation");
  if (reservationId) return <FromInvite reservationId={reservationId} />;
  return (
    <ControlSetupShell step={1} onFinishLater={() => navigate(CONTROL)}>
      <StationForm setup={null} />
    </ControlSetupShell>
  );
}

/** The waitlist, on the public site. */
const waitlistUrl = () => `${config.siteUrl ?? ""}/#join`;

function FromInvite({ reservationId }: { reservationId: string }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [signingIn, setSigningIn] = useState(false);
  // Read again whenever who's signed in changes: the match is theirs.
  const who = auth.signedIn ? (auth.email ?? "signed-in") : "signed-out";
  const invite = useQuery({
    queryKey: ["reservation-invite", reservationId, who],
    queryFn: () => call(waitlistApi.getReservationInvite, { params: { reservationId } }),
    retry: false
  });
  const p = invite.data;

  if (signingIn && !auth.signedIn) return <SignIn />;
  if (invite.isLoading) return <Quiet />;
  if (!p) {
    if (invite.error instanceof ApiError && invite.error.status === 404) return <NotFound />;
    return (
      <Card kicker="Master control" title="That invite didn't open.">
        <p className="cc-join__p" role="alert">
          {(invite.error as Error | null)?.message ?? "Something went wrong. Try again."}
        </p>
        <Button onClick={() => void invite.refetch()}>Try again</Button>
      </Card>
    );
  }
  // Their station, already started from it: carry on there.
  if (p.stationId) return <Navigate to={p.state === "signed_on" ? controlPath() : controlPath(`/setup/${p.stationId}/station`)} replace />;

  const until = p.heldUntil ? heldUntilWords(p) : null;
  if (p.state !== "open") {
    return (
      <Card kicker="Master control" title="This invite has ended.">
        <p className="cc-join__p">
          {p.state === "ended"
            ? `${p.callSign} was held for you${until ? ` until ${until}` : ""}. If it's still free, you can reserve it again on the waitlist.`
            : `A station has already been set up as ${p.callSign}. You can reserve another call sign on the waitlist.`}
        </p>
        <div className="cc-join__actions">
          <Button variant="primary" href={waitlistUrl()}>
            Join the waitlist
          </Button>
          <Button variant="ghost" href={controlPath()}>
            Back to master control
          </Button>
        </div>
      </Card>
    );
  }
  if (auth.signedIn && p.emailMatches === false) {
    return (
      <Card kicker={`Sign on as ${p.callSign}`} title="This invite is for another email.">
        <p className="cc-join__p">
          This invite is for {p.emailHint}; you're signed in as {p.signedInAs ?? auth.email ?? "an account with no email"}.
        </p>
        <p className="cc-join__p">
          Sign in with {p.emailHint}, the address {p.callSign} was reserved with, to set up your station.
        </p>
        <div className="cc-join__actions">
          <Button
            variant="primary"
            onClick={() =>
              void auth.signOut().then(() => {
                setSigningIn(true);
              })
            }
          >
            Sign in with another email
          </Button>
          <Button variant="ghost" href={controlPath()}>
            Back to master control
          </Button>
        </div>
      </Card>
    );
  }
  if (!auth.signedIn) {
    const where = p.market ? ` in the ${p.market.name}` : "";
    return (
      <Card kicker="Master control" title={`Sign on as ${p.callSign}`}>
        <p className="cc-join__p">
          {`${p.callSign} is held for you${where}${until ? ` until ${until}` : ""}.${p.channel ? ` So is channel ${p.channel}.` : ""}`}
        </p>
        <p className="cc-join__p">{p.emailHint ? `Sign in with ${p.emailHint} to set up your station.` : "Sign in to set up your station."}</p>
        <Button variant="primary" className="cc-join__go" onClick={() => setSigningIn(true)} disabled={!auth.available}>
          Sign in to set up
        </Button>
        {!auth.available && <p className="cc-join__p">Signing in isn't set up here.</p>}
        <p className="cc-join__foot">Master control is where stations run their dial. Each person signs in with their own account.</p>
      </Card>
    );
  }
  return (
    <ControlSetupShell step={1} onFinishLater={() => navigate(CONTROL)}>
      <StationForm setup={null} reservation={p} />
    </ControlSetupShell>
  );
}

/** "December 29", in the market's time. */
function heldUntilWords(p: ReservationInvite): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: p.market?.timezone ?? STATION_TZ }).format(new Date(p.heldUntil!));
}

function Card({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <main className="cc-join">
      <div className="cc-join__card">
        <p className="cc-join__kicker">{kicker}</p>
        <h1 className="cc-join__h">{title}</h1>
        {children}
      </div>
    </main>
  );
}
