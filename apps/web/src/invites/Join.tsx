// An invite link, /join/XXXX-XXXX (added 2026-10-07): who it's from, and "Sign in to come in". The
// code is kept on the device through sign-in and redeemed after it (here, or by the waiting screen
// if sign-in lands somewhere else). Someone already in is sent home: their own codes are on You.

import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi, invitesApi } from "@opencast/contracts";
import { Button, Lockup } from "@opencast/ui";
import { ApiError, call } from "../api/client";
import { useApi } from "../api/hooks";
import { useAuth } from "../auth/AuthProvider";
import SignInModal from "../viewer/components/overlays/SignInModal";
import { forgetCode, keepCode, REDEEM_ERRORS } from "./code";
import "./InviteGate.css";

const WHY: Record<string, string> = {
  unknown: "That invite code isn't one of ours. Check the link you were sent.",
  used: "That invite has already been used. Ask whoever sent it for another.",
  revoked: "That invite was taken back. Ask whoever sent it for another.",
  expired: "That invite has expired. Ask whoever sent it for another."
};

export default function Join() {
  const { code = "" } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const check = useApi(invitesApi.check, { params: { code } });
  const me = useApi(accountsApi.getMe, {}, { enabled: auth.signedIn });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const redeem = async () => {
    setError(null);
    setBusy(true);
    try {
      await call(invitesApi.redeem, { params: { code } });
      forgetCode();
      await qc.invalidateQueries();
      navigate("/", { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? (REDEEM_ERRORS[e.code] ?? e.message) : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const c = check.data;
  const inAlready = auth.signedIn && me.data?.admitted !== false && !!me.data;
  return (
    <main className="oc-gate">
      <div className="oc-gate__col">
        <Lockup size="phone" />
        {check.isLoading ? null : !c ? (
          <p className="oc-gate__lede">That invite couldn&rsquo;t be checked. Try again in a moment.</p>
        ) : inAlready ? (
          <>
            <h1 className="oc-gate__h">You&rsquo;re already in</h1>
            <p className="oc-gate__lede">{c.usable ? "This invite is still free for someone else. " : ""}Your own invites are on You.</p>
            <Button variant="primary" href="/you" onClick={(e) => (e.preventDefault(), navigate("/you"))}>
              Go to You
            </Button>
          </>
        ) : !c.usable ? (
          <>
            <h1 className="oc-gate__h">This invite can&rsquo;t be used</h1>
            <p className="oc-gate__lede">{WHY[c.reason ?? "unknown"]}</p>
            <Button variant="ghost" href="/" onClick={(e) => (e.preventDefault(), navigate("/"))}>
              Watch Opencast
            </Button>
          </>
        ) : (
          <>
            <h1 className="oc-gate__h">{c.from && c.from !== "Opencast" ? `${c.from} invited you to Opencast` : "You're invited to Opencast"}</h1>
            <p className="oc-gate__lede">Local TV and radio from people near you, on every screen. Sign in to come in; this invite is for you.</p>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                keepCode(code);
                if (auth.signedIn) void redeem();
                else auth.requireSignIn({ kind: "general", label: "accept your invite", finish: "Come in" }, redeem);
              }}
            >
              {auth.signedIn ? "Come in" : "Sign in to come in"}
            </Button>
            {error && (
              <p className="oc-gate__note" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </div>
      <SignInModal />
    </main>
  );
}
