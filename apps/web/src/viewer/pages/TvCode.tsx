// `/tv?code=K7Q4MP`: where the QR on the TV's first-launch screen (tv 05.3) lands, and where
// "useopencast.org/tv" goes to type the code. A six-character code signs the TV in to this account
// (B2, approveTvCode), the same as You's "Add a TV", with the code filled in from the address;
// signed out, signing in comes first and names what it's for. Four digits are the code the TV
// shows in Settings, Remote and phones: they pair this phone as the TV's remote (pairPhone), signed
// in or not, and the remote opens.

import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field } from "@opencast/ui";
import { call } from "../../api/client";
import { keyFor } from "../../api/hooks";
import { tvApi, type Tv } from "@opencast/contracts";
import { inChannelOrder } from "@opencast/player";
import { pairWithCode } from "../cast/pairings";
import { startCast } from "../cast/session";
import { useCastIntro } from "../cast/useCast";
import { useChannels } from "../data/viewer";
import { getDevice } from "../device/store";
import { useNowPlaying } from "../player/PlayerRoot";
import { useAuth } from "../../auth/AuthProvider";
import { useIsPhone, useShellOptions } from "../layout/shell";
import "./TvCode.css";

/** The code as the TV shows it ("K7Q 4MP") or typed: six letters and digits, upper case. */
export function normaliseTvCode(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6);
}

/** What a typed code is: four digits pair this phone as the remote; six letters and digits sign the TV in. */
export function tvCodeKind(raw: string | null | undefined): { kind: "pair" | "sign_in"; code: string } | null {
  const c = (raw ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (/^\d{4}$/.test(c)) return { kind: "pair", code: c };
  if (/^[A-Z0-9]{6}$/.test(c)) return { kind: "sign_in", code: c };
  return null;
}

/** A code from the address as the field shows it: a sign-in code spaced as the TV draws it, a pair code as it is. */
export function codeFromAddress(raw: string | null | undefined): string {
  const k = tvCodeKind(raw);
  return k?.kind === "pair" ? k.code : spacedTvCode(normaliseTvCode(raw));
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
  const intro = useCastIntro();
  const channels = useChannels();
  const np = useNowPlaying();
  const [code, setCode] = useState(() => codeFromAddress(params.get("code")));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Tv | null>(null);

  /** Four digits: pair this phone with the TV and open its remote, on what the phone has on. */
  const pair = async (c: string) => {
    setBusy(true);
    setError(null);
    const r = await pairWithCode(c, intro.from, (body) => call(tvApi.pairPhone, { body }));
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    const last = getDevice().lastStationId;
    const start = np.row ?? channels.find((x) => x.station.id === last) ?? inChannelOrder(channels)[0];
    const ok = await startCast({ id: r.pairing.tvId, name: r.pairing.tvName, kind: "tv_app", paired: true }, intro, start?.station.channel ? { stationId: start.station.id, channel: start.station.channel } : null);
    setBusy(false);
    if (ok) navigate("/remote", { replace: true });
    else setError(`This phone is paired with ${r.pairing.tvName}, but the remote didn't open. Try Watch on.`);
  };

  const approve = async () => {
    const c = normaliseTvCode(code);
    setBusy(true);
    setError(null);
    try {
      const tv = await call(tvApi.approveTvCode, { params: { code: c } });
      void qc.invalidateQueries({ queryKey: keyFor(tvApi.listTvs).slice(0, 2) });
      setDone(tv);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const k = tvCodeKind(code);
    if (!k) return setError("Enter the code the TV shows: six letters and numbers, or four numbers.");
    if (k.kind === "pair") return void pair(k.code);
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
      <p className="vw-tvc__lede">Open Opencast on the TV. It shows a code; enter it here. Four numbers from the TV's Remote and phones make this phone its remote.</p>
      <Field label="Code on the TV" mono autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} error={error ?? undefined} autoFocus={!code} />
      <Button variant="primary" type="submit" disabled={busy} block={phone}>
        {tvCodeKind(code)?.kind === "pair" ? "Pair this phone" : "Sign in the TV"}
      </Button>
    </form>
  );
}
