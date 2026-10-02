// Translators, as step A4 of master control draws it (follow-up Phase 3): the platforms a station
// simulcasts to, and one setting for all of its relays. Used by setup step 4, the Translators page
// and Settings, Translators.
//
// - Connected platforms (platformsApi): YouTube and Twitch by signing in ("Connect with Google",
//   "Connect with Twitch": the API answers with where to sign in; the platform comes back to this
//   page with `?platform=…&connected=1` or `&error=…`), anything else by address and stream key
//   ("Add a platform"). Remove in one click, confirmed. "Sign in again" when a platform stopped
//   accepting Opencast's sign-in. Owners only, as the API has it.
// - What gets relayed: "Live shows only" (free) or "Everything {BEAT} airs", per hour (Phase 2's
//   price), billed with the Station account.
// - On every relay: what breaks show, the station bug, saving YouTube videos, relayed this month.
// - Restarts for platform limits: the next one per platform, and the log.
// - The paid-promotion reminder for destinations Opencast can't mark.
//
// Operators see it all, read-only (the owner decides what's relayed and what it costs).

import { useEffect, useState, type CSSProperties } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { PLATFORM_NAMES, platformsApi, relayApi, type OAuthProvider, type PlatformConnection, type PlatformKind, type RelayBreakHandling, type RelayMode, type RelaySettings } from "@opencast/contracts";
import { Button, ChoiceList, Lines, Modal, Notice, Segmented, Sheet, Tag, Toggle, useToast } from "@opencast/ui";
import { ApiError, call } from "../../../api/client";
import { useApi, useApiMutation } from "../../../api/hooks";
import { SecTop } from "../live/Studio";
import { AddPlatform } from "./AddPlatform";
import {
  ADD_A_PLATFORM_LINE,
  CANT_STORE_KEYS,
  CONNECT_WITH,
  PLATFORM_MARKS,
  modeChoices,
  modeToast,
  offerLine,
  paidPromotionReminder,
  platformHeading,
  platformLine,
  platformTitle,
  relayStateNotice,
  relayedThisMonth,
  restartDetail,
  signInReturn,
  type SignInReturn
} from "./relayWords";
import "./TranslatorsPanel.css";

const PROVIDERS: OAuthProvider[] = ["youtube", "twitch"];
const BREAK_OPTIONS: { value: RelayBreakHandling; label: string }[] = [
  { value: "air_spots", label: "Your spots" },
  { value: "station_id_slate", label: "Station ID slate" }
];

/** Leaving the app for a platform's sign-in page (a seam, so tests can watch it). */
export const signInNavigation = {
  away(url: string) {
    window.location.assign(url);
  }
};

/**
 * Goes where the API said to sign in. Back to this app (the mock answers with the callback's
 * return address at once) is a move inside it; the platform's own page is a real navigation.
 */
function leaveFor(url: string, navigate: (to: string) => void) {
  const u = new URL(url, window.location.href);
  if (u.origin === window.location.origin) navigate(`${u.pathname}${u.search}${u.hash}`);
  else signInNavigation.away(u.toString());
}

const failWords = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");

export interface TranslatorsPanelProps {
  stationId: string;
  /** "BEAT". */
  callSign: string;
  /** Owners connect and remove platforms and change what's relayed; everyone else reads it. */
  owner: boolean;
  /** Station account, where relays are billed (the mode links there). */
  accountHref?: string;
  phone?: boolean;
}

export function TranslatorsPanel({ stationId, callSign, owner, accountHref, phone }: TranslatorsPanelProps) {
  const params = { stationId };
  const list = useApi(platformsApi.listPlatforms, { params });
  const relay = useApi(relayApi.getRelay, { params });
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useSearchParams();
  const invalidates = [platformsApi.listPlatforms, relayApi.getRelay];
  const update = useApiMutation(relayApi.updateRelay, { invalidates: [relayApi.getRelay] });
  const remove = useApiMutation(platformsApi.removePlatform, { invalidates });
  const dismiss = useApiMutation(relayApi.dismissPaidPromotionReminder, { invalidates: [relayApi.getRelay] });
  const [returned, setReturned] = useState<SignInReturn | null>(null);
  const [signingIn, setSigningIn] = useState<OAuthProvider | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PlatformConnection | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    for (const e of invalidates) void qc.invalidateQueries({ queryKey: [e.method, e.path] });
  };

  // Back from signing in: say how it went once, and take the platform's words out of the address.
  useEffect(() => {
    const r = signInReturn(search);
    if (!r) return;
    setReturned(r);
    refresh();
    setSearch(
      (q) => {
        for (const k of ["platform", "connected", "error"]) q.delete(k);
        return q;
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  if (list.isLoading || relay.isLoading) return <div className="cc-relays cc-relays--loading" aria-busy="true" />;
  if (!list.data || !relay.data)
    return (
      <p className="cc-relays__error" role="alert">
        {((list.error ?? relay.error) as Error | null)?.message ?? "Something went wrong. Try again."}
      </p>
    );

  const platforms = list.data.platforms;
  const view = relay.data;
  const canStore = list.data.canStoreKeys;
  const manage = owner && view.canManage;

  const signIn = async (provider: OAuthProvider) => {
    setError(null);
    setReturned(null);
    setSigningIn(provider);
    try {
      const r = await call(platformsApi.startPlatformSignIn, { params: { stationId, provider }, body: { returnTo: location.pathname } });
      setAdding(false);
      leaveFor(r.url, navigate);
    } catch (e) {
      setError(failWords(e));
    } finally {
      setSigningIn(null);
    }
  };

  const change = (body: Partial<RelaySettings>, done?: () => void) => {
    setError(null);
    update.mutate({ params, body }, { onSuccess: done, onError: (e) => setError(failWords(e)) });
  };

  const logo = (kind: PlatformKind) => (
    <span className="cc-relays__lg" style={{ "--cc-relays-colour": PLATFORM_MARKS[kind].colour } as CSSProperties} aria-hidden="true">
      {PLATFORM_MARKS[kind].mark}
    </span>
  );

  const connectedRow = (c: PlatformConnection) => {
    const title = platformTitle(c);
    const again = c.status === "needs_sign_in" && c.method === "signed_in" && (c.kind === "youtube" || c.kind === "twitch");
    return (
      <li key={c.id} className="cc-relays__row">
        {logo(c.kind)}
        <Lines className="cc-relays__what" title={platformHeading(c)} detail={platformLine(c)} />
        <div className="cc-relays__end">
          {owner && again && list.data.signIn[c.kind as OAuthProvider] && (
            <Button size="sm" disabled={signingIn !== null || !canStore} onClick={() => void signIn(c.kind as OAuthProvider)}>
              Sign in again
            </Button>
          )}
          {owner && (
            <Button size="sm" aria-label={`Remove ${title}`} onClick={() => setRemoving(c)}>
              Remove
            </Button>
          )}
        </div>
      </li>
    );
  };

  const offerRow = (p: OAuthProvider) => {
    const setUp = list.data.signIn[p];
    return (
      <li key={`offer-${p}`} className="cc-relays__row">
        {logo(p)}
        <Lines className="cc-relays__what" title={PLATFORM_NAMES[p]} detail={offerLine(p, setUp)} />
        <div className="cc-relays__end">
          {owner && setUp && (
            <Button size="sm" disabled={signingIn !== null || !canStore} onClick={() => void signIn(p)}>
              {CONNECT_WITH[p]}
            </Button>
          )}
        </div>
      </li>
    );
  };

  const rows = [
    ...PROVIDERS.flatMap((p) => {
      const mine = platforms.filter((c) => c.kind === p);
      return mine.length ? mine.map(connectedRow) : [offerRow(p)];
    }),
    ...platforms.filter((c) => c.kind !== "youtube" && c.kind !== "twitch").map(connectedRow),
    <li key="add" className="cc-relays__row">
      <span className="cc-relays__lg" style={{ "--cc-relays-colour": PLATFORM_MARKS.custom.colour } as CSSProperties} aria-hidden="true">
        +
      </span>
      <Lines className="cc-relays__what" title="Add a platform" detail={ADD_A_PLATFORM_LINE} />
      <div className="cc-relays__end">
        {owner && (
          <Button size="sm" disabled={!canStore} onClick={() => setAdding(true)}>
            Add
          </Button>
        )}
      </div>
    </li>
  ];

  const state = relayStateNotice(view);
  const reminders = view.platforms.filter((p) => p.paidPromotion === "remind");
  const month = relayedThisMonth(view.month);
  const youtubeSignedIn = platforms.some((c) => c.kind === "youtube" && c.method === "signed_in");

  const confirmRemove = () => {
    if (!removing) return;
    const c = removing;
    const title = platformTitle(c);
    remove.mutate(
      { params: { stationId, platformId: c.id } },
      {
        onSuccess: () => {
          setRemoving(null);
          toast.show({ message: `${title} removed. ${callSign} no longer relays there.` });
        },
        onError: (e) => {
          setRemoving(null);
          setError(failWords(e));
        }
      }
    );
  };

  const removeDialog = removing && (() => {
    const title = platformTitle(removing);
    const props = {
      open: true,
      onClose: () => setRemoving(null),
      title: `Remove ${title}?`,
      footer: (
        <>
          <Button onClick={() => setRemoving(null)}>Cancel</Button>
          <Button variant="primary" disabled={remove.isPending} onClick={confirmRemove}>
            Remove
          </Button>
        </>
      )
    };
    const words = (
      <p className="cc-relays__confirm">
        {callSign} stops relaying there at once. Its stream key{removing.method === "signed_in" ? " and sign-in are" : " is"} erased from Opencast. Viewer numbers and bills so far stay.
      </p>
    );
    return phone ? <Sheet {...props}>{words}</Sheet> : <Modal {...props}>{words}</Modal>;
  })();

  return (
    <div className={phone ? "cc-relays cc-relays--phone" : "cc-relays"}>
      {returned && (
        <div role={returned.ok ? "status" : "alert"}>
          <Notice
            tone={returned.ok ? "plain" : "standby"}
            icon={returned.ok ? "check" : undefined}
            action={
              <Button size="sm" variant="text" onClick={() => setReturned(null)}>
                Dismiss
              </Button>
            }
          >
            {returned.text}
          </Notice>
        </div>
      )}
      {state && (
        <Notice
          title={state.title}
          detail={state.detail}
          action={
            state.account && accountHref ? (
              <Button size="sm" href={accountHref}>
                Station account
              </Button>
            ) : undefined
          }
        />
      )}
      {reminders.map((p) => (
        <Notice
          key={`remind-${p.platformId}`}
          action={
            manage ? (
              <Button
                size="sm"
                disabled={dismiss.isPending}
                onClick={() =>
                  dismiss.mutate(
                    { params: { stationId, platformId: p.platformId } },
                    { onSuccess: () => toast.show({ message: `No more reminders for ${platformTitle(p)} until its next broadcast.` }), onError: (e) => setError(failWords(e)) }
                  )
                }
              >
                Done, it's marked
              </Button>
            ) : undefined
          }
        >
          {paidPromotionReminder(platformTitle(p))}
        </Notice>
      ))}
      {!owner && <p className="cc-relays__who">Only owners connect platforms and change what's relayed.</p>}
      {error && (
        <p className="cc-relays__error" role="alert">
          {error}
        </p>
      )}

      <div className="cc-relays__split">
        <div className="cc-relays__main">
          <div className="cc-relays__lb" id={`cc-relays-platforms-${stationId}`}>
            Connected platforms
          </div>
          {!canStore && (
            <Notice tone="plain" icon="info" className="cc-relays__keys">
              {CANT_STORE_KEYS}
            </Notice>
          )}
          <ul className="cc-relays__list" aria-labelledby={`cc-relays-platforms-${stationId}`}>
            {rows}
          </ul>

          <SecTop title="What gets relayed" id={`cc-relays-mode-${stationId}`} />
          <ChoiceList<RelayMode>
            label="What gets relayed"
            value={view.mode}
            options={modeChoices(callSign, view.month.priceMicros).map((o) => ({ value: o.value, title: o.title, helper: o.helper, end: o.end, disabled: !manage }))}
            onChange={(mode) => change({ mode }, () => toast.show({ message: modeToast(mode, callSign, view.month.priceMicros) }))}
          />
          <p className="cc-relays__note">
            Relays of everything {callSign} airs are billed with the Station account, from {callSign}'s earnings first.
            {accountHref && (
              <>
                {" "}
                <a className="cc-relays__link" href={accountHref}>
                  Station account
                </a>
              </>
            )}
          </p>

          {platforms.length > 0 && (
            <section className="cc-relays__restarts-sec" aria-labelledby={`cc-relays-restarts-${stationId}`}>
              <SecTop title="Restarts" id={`cc-relays-restarts-${stationId}`} />
              <p className="cc-relays__note">Platforms cap how long one broadcast runs. Opencast restarts one platform at a time, during the station ID in a break, so the others keep streaming.</p>
              {view.nextRestarts.length ? (
                <ul className="cc-relays__restarts" aria-label="Next restarts">
                  {view.nextRestarts.map((r) => (
                    <li key={r.id} className="cc-relays__restart">
                      <Lines title={r.label} detail={restartDetail(r)} />
                      {r.status === "due" && <Tag variant="standby">Due</Tag>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cc-relays__quiet">No restarts planned.</p>
              )}
              {view.recentRestarts.length > 0 && (
                <>
                  <div className="cc-relays__lb cc-relays__lb--gap" id={`cc-relays-log-${stationId}`}>
                    Lately
                  </div>
                  <ul className="cc-relays__restarts" aria-labelledby={`cc-relays-log-${stationId}`}>
                    {view.recentRestarts.slice(0, 5).map((r) => (
                      <li key={r.id} className="cc-relays__restart">
                        <Lines title={r.label} detail={r.status === "failed" ? "It tries again at the next break." : undefined} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
        </div>

        <aside className="cc-relays__pane" aria-labelledby={`cc-relays-every-${stationId}`}>
          <h4 id={`cc-relays-every-${stationId}`}>On every relay</h4>
          <div className="cc-relays__lb">During breaks, relays show</div>
          <Segmented<RelayBreakHandling>
            label="During breaks, relays show"
            block
            value={view.breakHandling}
            options={BREAK_OPTIONS.map((o) => ({ ...o, disabled: !manage }))}
            onChange={(breakHandling) => change({ breakHandling })}
          />
          <p className="cc-relays__note">With spots on, YouTube streams are marked as containing paid promotion for you. Time filled by ads from partners always shows the slate.</p>
          <div className="cc-relays__kv">
            <div className="cc-relays__kvrow">
              <span id={`cc-relays-bug-${stationId}`}>Station bug on relays</span>
              <Toggle checked={view.bugOnRelays} aria-labelledby={`cc-relays-bug-${stationId}`} disabled={!manage} onChange={(bugOnRelays) => change({ bugOnRelays })} />
            </div>
            {youtubeSignedIn && (
              <div className="cc-relays__kvrow">
                <Lines
                  title={<span id={`cc-relays-yt-${stationId}`}>Save relays as YouTube videos</span>}
                  detail="YouTube saves only broadcasts under 12 hours. With this on, Opencast starts a new broadcast about every 11 hours, during a break."
                />
                <Toggle checked={view.saveYoutubeVideos} aria-labelledby={`cc-relays-yt-${stationId}`} disabled={!manage} onChange={(saveYoutubeVideos) => change({ saveYoutubeVideos })} />
              </div>
            )}
            <div className="cc-relays__kvrow">
              <span>Relayed this month</span>
              <b className="cc-relays__month">{month.value}</b>
            </div>
          </div>
          {month.note && <p className="cc-relays__note">{month.note}</p>}
          <p className="cc-relays__note">Viewers on YouTube and Twitch are counted from what those platforms report, and shown apart from Opencast viewers in Audience and Earnings.</p>
        </aside>
      </div>

      {adding && (
        <AddPlatform
          stationId={stationId}
          list={list.data}
          phone={phone}
          signingIn={signingIn}
          onSignIn={(p) => void signIn(p)}
          onClose={() => setAdding(false)}
          onAdded={(c) => {
            setAdding(false);
            toast.show({ message: `${platformTitle(c)} is added.` });
          }}
        />
      )}
      {removeDialog}
    </div>
  );
}
