// `/tv?code=K7Q4MP`: where the QR on the TV's first-launch screen (tv 05.3) lands, and where
// "useopencast.org/tv" goes to type the code. It approves the TV's code for this account (proposed
// B2, approveTvCode), the same as You's "Add a TV", with the code filled in from the address.
// Signed out, signing in comes first and names what it's for.

import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field } from "@opencast/ui";
import { call } from "../api/client";
import { keyFor } from "../api/hooks";
import { tvsApi, type Tv } from "../api/ext/you";
import { useAuth } from "../auth/AuthProvider";
import { useIsPhone, useShellOptions } from "../layout/shell";
import "./TvCode.css";

/** The code as the TV shows it ("K7Q 4MP") or typed: six letters and digits, upper case. */
export function normaliseTvCode(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6);
}

/** "K7Q4MP" reads "K7Q 4MP", as the TV draws it. */
export function spacedTvCode(code: string): string {
  return code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export default function TvCodePage() {
  const phone = useIsPhone();
  useShellOptions(phone ? { tabs: false, player: false, back: { title: "Add a TV", href: "/you" } } : {});
  const [params] = useSearchParams();
  const auth = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [code, setCode] = useState(() => spacedTvCode(normaliseTvCode(params.get("code"))));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Tv | null>(null);

  const approve = async () => {
    const c = normaliseTvCode(code);
    if (c.length !== 6) return setError("The code on the TV has six letters and numbers.");
    setBusy(true);
    setError(null);
    try {
      const tv = await call(tvsApi.approveTvCode, { params: { code: c } });
      void qc.invalidateQueries({ queryKey: keyFor(tvsApi.listTvs).slice(0, 2) });
      setDone(tv);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    auth.requireSignIn({ kind: "general", label: "sign in the TV", finish: "Sign in the TV and go back", backTo: "the TV" }, approve);
  };

  if (done)
    return (
      <div className="vw-tvc">
        {!phone && <h1 className="vw-tvc__h">Add a TV</h1>}
        <p className="vw-tvc__lede" role="status">
          The TV is signed in
        </p>
        <Button variant="primary" onClick={() => navigate("/you")}>
          Done
        </Button>
      </div>
    );

  return (
    <form className="vw-tvc" onSubmit={submit} noValidate>
      {!phone && <h1 className="vw-tvc__h">Add a TV</h1>}
      <p className="vw-tvc__lede">Open Opencast on the TV. It shows a code; enter it here.</p>
      <Field label="Code on the TV" mono autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} error={error ?? undefined} autoFocus={!code} />
      <Button variant="primary" type="submit" disabled={busy} block={phone}>
        Sign in the TV
      </Button>
    </form>
  );
}
