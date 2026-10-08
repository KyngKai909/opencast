// Invite-only sign-ups (added 2026-10-07): someone signed in who hasn't been let in sees this
// instead of the app, in every area, until they redeem a code (one kept from a /join link is tried
// by itself). A team invite's own page (/control/invites/…) and the /join page stay open, since
// either can let them in. Signing out goes back to watching, as anyone can.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi, invitesApi } from "@opencast/contracts";
import { Button, Field, Lockup } from "@opencast/ui";
import { ApiError, call } from "../api/client";
import { useApi } from "../api/hooks";
import { useAuth } from "../auth/AuthProvider";
import { forgetCode, keptCode, REDEEM_ERRORS } from "./code";
import "./InviteGate.css";

/** Pages that can let someone in themselves. */
const OPEN = [/^\/join\//, /^\/invites\//, /^\/control\/invites\//];

export function InviteGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { pathname } = useLocation();
  const me = useApi(accountsApi.getMe, {}, { enabled: auth.signedIn });
  const waiting = auth.signedIn && me.data?.admitted === false && !OPEN.some((p) => p.test(pathname));
  return waiting ? <Waiting /> : <>{children}</>;
}

function Waiting() {
  const auth = useAuth();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tried = useRef(false);

  const redeem = async (value: string) => {
    setError(null);
    setBusy(true);
    try {
      await call(invitesApi.redeem, { params: { code: value } });
      forgetCode();
      // Everything read while waiting was refused: read it all again.
      await qc.invalidateQueries();
    } catch (e) {
      forgetCode();
      setError(e instanceof ApiError ? (REDEEM_ERRORS[e.code] ?? e.message) : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // A code kept from a /join link: tried once, by itself.
  useEffect(() => {
    const kept = keptCode();
    if (kept && !tried.current) {
      tried.current = true;
      setCode(kept);
      void redeem(kept);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="oc-gate">
      <div className="oc-gate__col">
        <Lockup size="phone" />
        <h1 className="oc-gate__h">Opencast is invite-only for now</h1>
        <p className="oc-gate__lede">
          You&rsquo;re signed in{auth.email ? ` as ${auth.email}` : ""}. Enter the invite code someone sent you to come in. Everyone who&rsquo;s in can invite a few friends.
        </p>
        <form
          className="oc-gate__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim().length < 8) return setError("Enter the 8 letters and numbers of your code.");
            void redeem(code.trim());
          }}
        >
          <Field label="Invite code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} mono error={error ?? undefined} />
          <Button variant="primary" type="submit" disabled={busy}>
            Come in
          </Button>
        </form>
        <p className="oc-gate__note">No code? You can still watch without an account.</p>
        <Button variant="ghost" onClick={() => void auth.signOut()}>
          Sign out and keep watching
        </Button>
      </div>
    </main>
  );
}
