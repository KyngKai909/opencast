// The creator's permission page (network-desk 06.1, 06.2): public, no account needed to answer,
// outside the phone shell (no tabs, no mini player, no player bar), phone-first, never indexed. The
// token in the address is the only credential. It lists exactly which works, what Opencast would
// do, where the money goes and how to stop; then "Yes, go ahead" or "No thanks". After a yes: Stop
// (from the link, B8) and Claim now (sign in, then B8's claim from the link, before or after the
// station exists). Every word is in components/permission/copy.ts, versioned for the lawyer.

import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { networkApi } from "@opencast/contracts";
import { Button, clock, KeyValueList, Lockup, useToast } from "@opencast/ui";
import { ApiError, call } from "../../api/client";
import { keyFor, useApi } from "../../api/hooks";
import { useAuth } from "../../auth/AuthProvider";
import SignInModal from "../components/overlays/SignInModal";
import { PERMISSION_COPY as C, PERMISSION_WORDING_VERSION } from "../components/permission/copy";
import { mainNoun, pageState, PLATFORMS, whenLine, worksLine } from "../components/permission/words";
import { MARKET_TZ } from "../../lib/clock";
import "./Permission.css";
import { CONTROL } from "../../areas";

/** "September 27 at 10:15 am", in the market's time. */
function whenText(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: MARKET_TZ, month: "long", day: "numeric" }).format(d);
  return `${day} at ${clock(d, { timeZone: MARKET_TZ })}`;
}

/** Keeps the page out of search engines while it's open: the token is the only credential. */
function useNoIndex(title: string) {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    const before = document.title;
    document.title = title;
    return () => {
      meta.remove();
      document.title = before;
    };
  }, [title]);
}

export default function Permission() {
  const { token = "" } = useParams();
  useNoIndex(C.documentTitle);
  const auth = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const page = useApi(networkApi.getPermissionPage, { params: { token } }, { enabled: token.length >= 16, retry: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: keyFor(networkApi.getPermissionPage, { params: { token } }) });
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : C.failed);
      if (e instanceof ApiError && e.code === "already_answered") await refresh();
    } finally {
      setBusy(false);
    }
  };

  const answer = (a: "yes" | "no") =>
    run(() => call(networkApi.answerPermission, { params: { token }, body: { answer: a, wordingVersion: PERMISSION_WORDING_VERSION } }));

  // Stop is one tap; the toast holds it for a moment so a slip can be undone (rules: Undo, not a confirmation).
  const stop = () => {
    setStopping(true);
    toast.show({
      message: C.stopping,
      onUndo: () => setStopping(false),
      onExpire: () => void run(() => call(networkApi.stopFromLink, { params: { token } })).finally(() => setStopping(false))
    });
  };

  // Claim from the link (B8), before or after the station exists: the link is what proves it's them.
  const claim = () => auth.requireSignIn({ kind: "general", ...C.claimSignIn }, () => run(() => call(networkApi.claimFromLink, { params: { token } })));

  if (token.length < 16 || page.error) return <Bad />;
  if (page.isLoading || !page.data) return <main className="vw-perm" aria-busy="true" />;
  const p = page.data;
  const state = pageState(p);
  const band = p.proposed?.band ?? p.station?.band ?? "tv";
  const noun = mainNoun(p.works);
  const line = worksLine(p);
  const platform = p.creator.sourcePlatform ? (PLATFORMS[p.creator.sourcePlatform] ?? null) : null;

  return (
    <main className="vw-perm">
      <div className="vw-perm__col">
        <Lockup size="phone" className="vw-perm__logo" />
        {state === "unanswered" && (
          <>
            <h1 className="vw-perm__h">{C.title(noun, p.marketName ?? "local")}</h1>
            <p className="vw-perm__lede">{C.lede}</p>
            <KeyValueList
              variant="rows"
              className="vw-perm__rows"
              items={[
                { title: C.worksTitle, detail: C.works(line.included, platform, line.leftOut) },
                { title: C.stationTitle(band), detail: C.station(noun, whenLine(p), p.creator.displayName) },
                { title: C.moneyTitle, detail: C.money },
                { title: C.stopTitle, detail: C.stop }
              ]}
            />
            <Button variant="primary" block className="vw-perm__yes" disabled={busy} onClick={() => void answer("yes")}>
              {C.yes}
            </Button>
            <Button variant="ghost" block className="vw-perm__no" disabled={busy} onClick={() => void answer("no")}>
              {C.no}
            </Button>
          </>
        )}
        {(state === "yes" || state === "claiming") && p.answer && (
          <>
            <h1 className="vw-perm__h">{C.thanks}</h1>
            <p className="vw-perm__lede">{p.station?.channel && p.station.callSign ? C.thanksLedeStation(p.station.channel, p.station.callSign) : C.thanksLede}</p>
            <KeyValueList
              variant="rows"
              className="vw-perm__rows"
              items={[
                { title: C.saidYesTitle, detail: C.saidYes(p.answer.works, whenText(p.answer.answeredAt)) },
                {
                  title: C.changedTitle,
                  detail: C.changed,
                  actions: (
                    <Button size="sm" disabled={busy || stopping} onClick={stop}>
                      {C.stopButton}
                    </Button>
                  )
                },
                state === "claiming"
                  ? {
                      title: C.claimStartedTitle,
                      detail: C.claimStarted,
                      actions: (
                        <Button size="sm" href={CONTROL}>
                          {C.openControl}
                        </Button>
                      )
                    }
                  : {
                      title: C.claimTitle,
                      detail: C.claim,
                      actions: (
                        <Button size="sm" disabled={busy} onClick={claim}>
                          {C.claimButton}
                        </Button>
                      )
                    }
              ]}
            />
          </>
        )}
        {state === "no" && (
          <>
            <h1 className="vw-perm__h">{C.noTitle}</h1>
            <p className="vw-perm__lede">{C.noLede}</p>
          </>
        )}
        {state === "stopped" && (
          <>
            <h1 className="vw-perm__h">{C.stoppedTitle}</h1>
            <p className="vw-perm__lede">{C.stoppedLede}</p>
          </>
        )}
        {error && (
          <p className="vw-perm__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <SignInModal />
    </main>
  );
}

function Bad() {
  return (
    <main className="vw-perm">
      <div className="vw-perm__col">
        <Lockup size="phone" className="vw-perm__logo" />
        <h1 className="vw-perm__h">{C.badLinkTitle}</h1>
        <p className="vw-perm__lede">{C.badLinkLede}</p>
      </div>
    </main>
  );
}
