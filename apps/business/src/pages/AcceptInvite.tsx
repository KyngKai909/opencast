// `/invites/:inviteId`: the link in a business invite's email. No frame draws it; it's the sign-in
// card (viewer/you 01.1) with the invite on it. Reachable signed out: it says who invited you and
// to what, then asks you to sign in. Signed in with the invited email, it joins the team and opens
// the business. Signed in as someone else, expired or already used, it says so and what to do.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { accountsApi, type InvitePreview, type Me } from "@opencast/contracts";
import { Button } from "@opencast/ui";
import { ApiError, call } from "../api/client";
import { keyFor } from "../api/hooks";
import { useAuth } from "../auth/AuthProvider";
import { NotFound, Quiet } from "./common";
import SignIn from "./SignIn";
import "./AcceptInvite.css";

const ROLE: Record<InvitePreview["role"], { a: string; does: string }> = {
  operator: { a: "an operator", does: "Operators run the station day to day, but not money or the team." },
  host: { a: "a host", does: "Hosts go live on the blocks they're given." },
  manager: { a: "a manager", does: "Managers can run spots, add money and approve orders; only the owner takes money out." },
  viewer: { a: "a viewer", does: "Viewers see results and statements, but can't spend or change anything." }
};

/** Where joining lands: the business's spots, or its results for a viewer. */
function landing(me: Me, businessId: string): string {
  const m = me.memberships.find((x) => x.kind === "business" && x.business.id === businessId);
  return m && m.kind === "business" ? `/${businessId}/${m.role === "viewer" ? "results" : "spots"}` : "/";
}

export default function AcceptInvite() {
  const { inviteId = "" } = useParams();
  const auth = useAuth();
  const qc = useQueryClient();
  const [signingIn, setSigningIn] = useState(false);
  const [joined, setJoined] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const tried = useRef(false);
  // Read again whenever who's signed in changes: the match is theirs.
  const who = auth.signedIn ? (auth.email ?? "signed-in") : "signed-out";
  const invite = useQuery({ queryKey: ["invite", inviteId, who], queryFn: () => call(accountsApi.getInvite, { params: { inviteId } }), retry: false });
  const p = invite.data;
  const canJoin = auth.signedIn && p?.state === "open" && p.emailMatches !== false && p.team.kind === "business";

  const join = () => {
    if (!p) return;
    setJoinError(null);
    call(accountsApi.acceptInvite, { params: { inviteId } })
      .then((me: Me) => {
        qc.setQueryData([...keyFor(accountsApi.getMe), 0], me);
        setJoined(landing(me, p.team.id));
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
  if (joined) return <Navigate to={joined} replace />;
  if (invite.isLoading) return <Quiet />;
  if (!p) {
    if (invite.error instanceof ApiError && invite.error.status === 404) return <NotFound />;
    return (
      <Card kicker="For business" title="That invite didn't open.">
        <p className="bz-join__p" role="alert">
          {(invite.error as Error | null)?.message ?? "Something went wrong. Try again."}
        </p>
        <Button onClick={() => void invite.refetch()}>Try again</Button>
      </Card>
    );
  }
  if (p.team.kind !== "business") return <NotFound />;
  if (p.state === "accepted" && p.acceptedByYou) return <Navigate to={`/${p.team.id}`} replace />;

  const role = ROLE[p.role];
  const from = p.invitedBy ?? `The owner of ${p.team.name}`;
  const signInWithOther = async () => {
    await auth.signOut();
    tried.current = false;
    setSigningIn(true);
  };

  if (p.state === "expired") {
    return (
      <Card kicker={p.team.name} title="This invite has expired.">
        <p className="bz-join__p">Invites last a week. Ask {p.invitedBy ?? `the owner of ${p.team.name}`} to send it again.</p>
        <Button href="/">Opencast for business</Button>
      </Card>
    );
  }
  if (p.state === "accepted") {
    return (
      <Card kicker={p.team.name} title="This invite was already used.">
        <p className="bz-join__p">Each invite joins one person. If that wasn't you, ask {p.invitedBy ?? `the owner of ${p.team.name}`} for a new one.</p>
        <Button href="/">Opencast for business</Button>
      </Card>
    );
  }
  if (auth.signedIn && p.emailMatches === false) {
    return (
      <Card kicker={p.team.name} title="This invite is for another email.">
        <p className="bz-join__p">
          This invite is for {p.emailHint}; you're signed in as {p.signedInAs ?? auth.email ?? "an account with no email"}.
        </p>
        <p className="bz-join__p">Sign in with {p.emailHint} to join. If you don't use that address, ask {p.invitedBy ?? `the owner of ${p.team.name}`} to invite the one you do.</p>
        <div className="bz-join__actions">
          <Button variant="primary" onClick={() => void signInWithOther()}>
            Sign in with another email
          </Button>
          <Button variant="ghost" href="/">
            Opencast for business
          </Button>
        </div>
      </Card>
    );
  }
  if (auth.signedIn) {
    if (!joinError) return <Quiet />;
    return (
      <Card kicker={p.team.name} title="That invite didn't work.">
        <p className="bz-join__p" role="alert">
          {joinError}
        </p>
        <div className="bz-join__actions">
          <Button variant="primary" onClick={join}>
            Try again
          </Button>
          <Button variant="ghost" href="/">
            Opencast for business
          </Button>
        </div>
      </Card>
    );
  }
  return (
    <Card kicker="For business" title={`Join ${p.team.name}`}>
      <p className="bz-join__p">
        {from} invited you to {p.team.name}'s team on Opencast, as {role.a}. {role.does}
      </p>
      <p className="bz-join__p">{p.emailHint ? `Sign in with ${p.emailHint} to join.` : "Sign in to join."}</p>
      <Button variant="primary" className="bz-join__go" onClick={() => setSigningIn(true)} disabled={!auth.available}>
        Sign in to join
      </Button>
      {!auth.available && <p className="bz-join__p">Signing in isn't set up here.</p>}
      <p className="bz-join__foot">Each person signs in with their own account, from anywhere.</p>
    </Card>
  );
}

function Card({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <main className="bz-join">
      <div className="bz-join__card">
        <p className="bz-join__kicker">{kicker}</p>
        <h1 className="bz-join__h">{title}</h1>
        {children}
      </div>
    </main>
  );
}
