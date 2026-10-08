// Invite-only sign-ups (added 2026-10-07): the web app's waiting screen, for businesses. Someone
// signed in who hasn't been let in sees this until they redeem a code (a /join link opens on the
// web app; the same account is then in here too). A business team invite's page stays open, since
// it can let them in.

import { useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi, invitesApi } from "@opencast/contracts";
import { Button, Field, Lockup } from "@opencast/ui";
import { ApiError, call } from "../api/client";
import { useApi } from "../api/hooks";
import { useAuth } from "../auth/AuthProvider";
import "./InviteGate.css";

const REDEEM_ERRORS: Record<string, string> = {
  not_found: "That code isn't one of ours. Check it and try again.",
  invite_used: "That code has already been used. Ask for another.",
  invite_revoked: "That code was taken back. Ask for another.",
  invite_expired: "That code has expired. Ask for another."
};

/** Pages that can let someone in themselves. */
const OPEN = [/^\/invites\//];

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

  const redeem = async (value: string) => {
    setError(null);
    setBusy(true);
    try {
      await call(invitesApi.redeem, { params: { code: value } });
      // Everything read while waiting was refused: read it all again.
      await qc.invalidateQueries();
    } catch (e) {
      setError(e instanceof ApiError ? (REDEEM_ERRORS[e.code] ?? e.message) : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="oc-gate">
      <div className="oc-gate__col">
        <Lockup size="phone" />
        <h1 className="oc-gate__h">Opencast is invite-only for now</h1>
        <p className="oc-gate__lede">
          You&rsquo;re signed in{auth.email ? ` as ${auth.email}` : ""}. Enter the invite code someone sent you to come in.
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
        <p className="oc-gate__note">No code? Ask the station you&rsquo;re working with, or write to Opencast.</p>
        <Button variant="ghost" onClick={() => void auth.signOut()}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
