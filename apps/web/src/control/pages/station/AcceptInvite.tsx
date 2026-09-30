// `/control/invites/:inviteId`: the link in a station invite's email. No frame draws it; it's the
// sign-in card (viewer/you 01.1) with the invite on it, and like claiming a station (rights 05.1)
// it's reachable signed out and asks for sign-in itself. Signed in with the invited email, it joins
// the team and opens the station in master control. Signed in as someone else, expired or already
// used, it says so and what to do.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { accountsApi, type InvitePreview } from "@opencast/contracts";
import { Button } from "@opencast/ui";
import { ApiError, call } from "../../../api/client";
import { useAuth } from "../../../auth/AuthProvider";
import { controlPath } from "../../../areas";
import { NotFound, Quiet } from "../common";
import { useMyStations, type StationMembership } from "../../station/StationContext";
import { stationPath } from "../../station/slug";
import SignIn from "../SignIn";
import "./AcceptInvite.css";

const ROLE: Record<InvitePreview["role"], { a: string; does: string }> = {
  operator: { a: "an operator", does: "Operators run the station day to day, but not money or the team." },
  host: { a: "a host", does: "Hosts go live on the blocks they're given." },
  manager: { a: "a manager", does: "Managers can run spots, add money and approve orders; only the owner takes money out." },
  viewer: { a: "a viewer", does: "Viewers see results and statements, but can't spend or change anything." }
};

/**
 * Master control's address for the station: its slug once it's among your stations ("beat", a
 * station sharing a call sign "beat-12-2"), else its id (the call sign alone would name 12.1),
 * else the list of your stations.
 */
function stationHome(team: InvitePreview["team"], mine: StationMembership[]): string {
  const m = mine.find((x) => x.station.id === team.id);
  if (m) return stationPath(m.station);
  return team.callSign ? controlPath(`/${team.id}`) : controlPath();
}

export default function AcceptInvite() {
  const { inviteId = "" } = useParams();
  const auth = useAuth();
  const qc = useQueryClient();
  const [signingIn, setSigningIn] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const tried = useRef(false);
  const mine = useMyStations();
  // Read again whenever who's signed in changes: the match is theirs.
  const who = auth.signedIn ? (auth.email ?? "signed-in") : "signed-out";
  const invite = useQuery({ queryKey: ["invite", inviteId, who], queryFn: () => call(accountsApi.getInvite, { params: { inviteId } }), retry: false });
  const p = invite.data;
  const canJoin = auth.signedIn && p?.state === "open" && p.emailMatches !== false && p.team.kind === "station";

  const join = () => {
    setJoinError(null);
    call(accountsApi.acceptInvite, { params: { inviteId } })
      .then(async () => {
        // The station switcher and every page read the person's stations from getMe.
        await qc.invalidateQueries({ queryKey: [accountsApi.getMe.method, accountsApi.getMe.path] });
        setJoined(true);
      })
      .catch((e) => {
        setJoinError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
        void invite.refetch();
      });
  };

  useEffect(() => {
    if (canJoin && !tried.current) {
      tried.current = true;
      join();
    }
  }, [canJoin]);

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
  if (p.team.kind !== "station") return <NotFound />;
  if (joined || (p.state === "accepted" && p.acceptedByYou)) return <Navigate to={stationHome(p.team, mine)} replace />;

  const role = ROLE[p.role];
  const station = p.team.callSign ? `${p.team.callSign}, ${p.team.name}` : p.team.name;
  const owner = p.invitedBy ?? `the owner of ${p.team.name}`;
  const signInWithOther = async () => {
    await auth.signOut();
    tried.current = false;
    setSigningIn(true);
  };

  if (p.state === "expired") {
    return (
      <Card kicker={station} title="This invite has expired.">
        <p className="cc-join__p">Invites last a week. Ask {owner} to send it again from Settings, Team.</p>
        <Button href={controlPath()}>Back to master control</Button>
      </Card>
    );
  }
  if (p.state === "accepted") {
    return (
      <Card kicker={station} title="This invite was already used.">
        <p className="cc-join__p">Each invite joins one person. If that wasn't you, ask {owner} for a new one.</p>
        <Button href={controlPath()}>Back to master control</Button>
      </Card>
    );
  }
  if (auth.signedIn && p.emailMatches === false) {
    return (
      <Card kicker={station} title="This invite is for another email.">
        <p className="cc-join__p">
          This invite is for {p.emailHint}; you're signed in as {p.signedInAs ?? auth.email ?? "an account with no email"}.
        </p>
        <p className="cc-join__p">
          Sign in with {p.emailHint} to join. If you don't use that address, ask {owner} to invite the one you do.
        </p>
        <div className="cc-join__actions">
          <Button variant="primary" onClick={() => void signInWithOther()}>
            Sign in with another email
          </Button>
          <Button variant="ghost" href={controlPath()}>
            Back to master control
          </Button>
        </div>
      </Card>
    );
  }
  if (auth.signedIn) {
    if (!joinError) return <Quiet />;
    return (
      <Card kicker={station} title="That invite didn't work.">
        <p className="cc-join__p" role="alert">
          {joinError}
        </p>
        <div className="cc-join__actions">
          <Button variant="primary" onClick={join}>
            Try again
          </Button>
          <Button variant="ghost" href={controlPath()}>
            Back to master control
          </Button>
        </div>
      </Card>
    );
  }
  return (
    <Card kicker="Master control" title={`Join ${p.team.name}`}>
      <p className="cc-join__p">
        {p.invitedBy ?? `The owner of ${p.team.name}`} invited you to {station}'s team, as {role.a}. {role.does}
      </p>
      <p className="cc-join__p">{p.emailHint ? `Sign in with ${p.emailHint} to join.` : "Sign in to join."}</p>
      <Button variant="primary" className="cc-join__go" onClick={() => setSigningIn(true)} disabled={!auth.available}>
        Sign in to join
      </Button>
      {!auth.available && <p className="cc-join__p">Signing in isn't set up here.</p>}
      <p className="cc-join__foot">Master control is where stations run their dial. Each person signs in with their own account.</p>
    </Card>
  );
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
