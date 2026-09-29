// tv 05.3 first launch: sign in on your phone ("/welcome"). The code and a QR (both finish on the
// phone, B2), "Watch without signing in" focused (signing in is optional), and the market guessed
// from the TV's connection (S10), said out loud with where to change it. The first station is
// already tuned underneath, so the next thing on screen is its picture.
//
// Approved: the TV keeps its session, keeps what it had saved (presets), takes the account's
// settings, and goes to the picture. A code that runs out is replaced, and the screen says so.
// Also opened from Settings, Account, "Sign in": Back and "Watch without signing in" return there.

import { useCallback, useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi } from "@opencast/contracts";
import { cx, Mark } from "@opencast/ui";
import { call } from "../../api/client";
import { useApi } from "../../api/hooks";
import { MarketByConnection, marketsApiX, tvCodesApi } from "../../api/ext/signIn";
import { QrCode } from "../../components/common/QrCode";
import { enterAt, formatCode, useTvCode } from "../../components/settings/codeFlow";
import { marketLine } from "../../components/settings/market";
import { fromAccount } from "../../components/settings/model";
import { now } from "../../lib/clock";
import { useCommandLayer } from "../../tv/commands";
import { useDial } from "../../tv/data";
import { getDevice, setDevice, useDevice, type TvSettings } from "../../tv/device";
import { useTvFocusable } from "../../tv/focus";
import { useTvMode } from "../../tv/TvApp";
import "./Welcome.css";

export default function Welcome() {
  const mode = useTvMode();
  const device = useDevice();
  const state = useLocation().state as { from?: string; then?: string } | null;
  const from = state?.from ?? null;
  // Where to go once signed in (the guide's Remind me comes back to its dialog).
  const then = state?.then ?? null;
  // A Cast receiver or an iPhone's second screen never signs in; a signed-in TV has nothing to do here.
  if (mode !== "tv" || device.token) return <Navigate to={then ?? from ?? "/"} replace />;
  return <WelcomeScreen from={from} then={then} />;
}

/** After a phone approves the code: this TV's session, its presets kept, the account's settings. */
async function signIn(token: string, signedInAs: string | null) {
  setDevice({ token, signedInAs, welcomed: true });
  const presets = Object.entries(getDevice().presets).map(([k, stationId]) => ({ stationId, key: Number(k) }));
  if (presets.length) await call(accountsApi.mergeDevice, { body: { presets, reminders: [] } }).catch(() => undefined);
  const me = await call(accountsApi.getMe).catch(() => null);
  if (me) setDevice({ settings: fromAccount(me.settings) as TvSettings });
}

function WelcomeScreen({ from, then }: { from: string | null; then: string | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const device = useDevice();

  const leave = useCallback(() => {
    setDevice({ welcomed: true });
    navigate(from ?? "/", { replace: true });
  }, [from, navigate]);

  const code = useTvCode({
    create: () => call(tvCodesApi.createCode),
    poll: (pollToken) => call(tvCodesApi.pollCode, { params: { pollToken } }),
    now: () => now().getTime(),
    onApproved: (token, signedInAs) => {
      void signIn(token, signedInAs).then(() => qc.invalidateQueries());
      // The TV updates the moment it's done: straight to the picture, or back to what asked.
      navigate(then ?? "/", { replace: true });
    }
  });

  // The market: guessed from the connection until someone chooses one (and kept on this TV).
  const guess = useApi(marketsApiX.byConnection, {}, { schema: MarketByConnection, enabled: !device.marketSlug, staleTime: Infinity, retry: 0 });
  const guessed = guess.data?.market ?? null;
  useEffect(() => {
    if (guessed && !getDevice().marketSlug) setDevice({ marketSlug: guessed.slug });
  }, [guessed]);
  const dial = useDial("tv");
  const line = marketLine({
    loading: !device.marketSlug && guess.isLoading,
    guessed: guessed && device.marketSlug === guessed.slug ? guessed.name : null,
    noneOpen: !device.marketSlug && !!guess.data && !guessed,
    current: dial.data?.market.name ?? null
  });

  // Back: the same as watching without signing in (from Settings, back to Account).
  useCommandLayer((c) => {
    if (c.type !== "back") return false;
    leave();
    return true;
  });

  const button = useTvFocusable<HTMLButtonElement>({ focusKey: "tvs-welcome-watch", onSelect: leave, autoFocus: true });
  const waiting = code.kind === "waiting" ? code.code : null;

  return (
    <div className="tvs-welcome">
      <div className="tvs-welcome__words">
        <div className="tvs-welcome__logo">
          <Mark size={58} />
          <span>opencast</span>
        </div>
        <h2 className="tvs-welcome__title">Sign in on your phone.</h2>
        <p className="tvs-welcome__how">
          {code.kind === "waiting" && code.renewed ? "That code ran out, so here's a new one. Scan it, or go to " : "Scan the code, or go to "}
          <span className="tvs-welcome__url">{waiting ? enterAt(waiting) : "useopencast.org/tv"}</span> and enter:
        </p>
        {code.kind === "error" ? (
          <p className="tvs-welcome__error" role="alert">
            {code.message}
          </p>
        ) : (
          <div className={cx("tvs-welcome__code", !waiting && "tvs-welcome__code--loading")} aria-live="polite">
            {waiting ? formatCode(waiting.code) : " "}
          </div>
        )}
        <button ref={button.ref} type="button" className={cx("tvs-welcome__watch", button.focused && "tvs-welcome__watch--focus")} onClick={() => (button.focusSelf(), leave())}>
          Watch without signing in
        </button>
        <p className="tvs-welcome__market">{line ?? " "}</p>
      </div>
      <div className="tvs-welcome__qr">{waiting ? <QrCode value={waiting.qrUrl} size={420} label={`A QR code that opens ${enterAt(waiting)} with the code ${formatCode(waiting.code)}`} /> : code.kind !== "error" && <div className="tvs-welcome__qr-wait" />}</div>
    </div>
  );
}
