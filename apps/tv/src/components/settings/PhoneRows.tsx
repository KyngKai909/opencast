// Remote and phones, below "Who on the Wi-Fi can change the channel": pairing a guest's phone by
// a 4-digit code, and the phones that can drive this TV, each with Remove. Phones signed in to
// the account need no code; they're listed once they've connected. The list follows the relay's
// `phones` events, so a phone pairing or connecting shows up while the section is open.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { tvApi, type RemotePhone } from "@opencast/contracts";
import { cx } from "@opencast/ui";
import { call } from "../../api/client";
import { keyFor } from "../../api/hooks";
import { config } from "../../config";
import { now } from "../../lib/clock";
import { useDevice } from "../../tv/device";
import { focusKey } from "../../tv/focus";
import { setPhones, usePhones } from "../../tv/phones";
import { ensureRegistered } from "../../tv/registration";
import type { RowKind } from "./keys";
import { codeLasts, pairedSince, phoneLine, phoneOrder, spacedCode, usePairCode, viewerAddress } from "./pairing";
import { TvRow } from "./TvRow";
import "./PhoneRows.css";

export function PhoneRows({ focusRow }: { focusRow: (key: string, kind: RowKind) => () => void }) {
  const signedIn = !!useDevice().token;
  const [showing, setShowing] = useState(false);
  const pair = usePairCode(
    {
      create: async () => {
        await ensureRegistered();
        return call(tvApi.createPairCode);
      },
      now: () => now().getTime()
    },
    showing
  );

  // The list as the API has it when the section opens; the relay's events keep it current.
  const listed = useQuery({
    queryKey: keyFor(tvApi.listRemotePhones),
    queryFn: async () => {
      await ensureRegistered();
      return call(tvApi.listRemotePhones);
    },
    staleTime: 0,
    retry: 0
  });
  useEffect(() => {
    if (listed.data) setPhones(listed.data);
  }, [listed.data]);
  const phones = usePhones();

  // "Changes in 4 minutes" counts down while the code is up.
  const [, tick] = useState(0);
  useEffect(() => {
    if (pair.kind !== "showing") return;
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [pair.kind]);

  // A guest's phone paired with the code on screen: the code has done its job.
  const paired = pair.kind === "showing" ? pairedSince(phones, pair.since) : null;
  useEffect(() => {
    if (paired) setShowing(false);
  }, [paired]);

  const [error, setError] = useState<string | null>(null);
  const remove = async (p: RemotePhone) => {
    try {
      setPhones(await call(tvApi.removeRemotePhone, { params: { phoneId: p.id } }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    // Its row is gone: focus goes back to pairing.
    setTimeout(() => focusKey("tvs-row-pair"), 0);
  };

  const address = viewerAddress(config.viewerUrl);
  const list = phones ? phoneOrder(phones) : null;

  return (
    <>
      <TvRow
        fk="tvs-row-pair"
        title="Pair a phone"
        help={showing ? undefined : "For a guest's phone. Phones signed in to your account don't need a code"}
        control={{ type: "action", label: showing ? "Hide the code" : "Show a code" }}
        onFocus={focusRow("tvs-row-pair", "action")}
        onSelect={() => setShowing((s) => !s)}
      />
      {showing && (
        <div className="tvs-pair" aria-live="polite">
          {pair.kind === "error" ? (
            <p className="tvs-pair__error" role="alert">
              {pair.message}
            </p>
          ) : (
            <>
              <p className="tvs-pair__how">
                On the phone, go to <span className="tvs-pair__url">{address}</span> and enter:
              </p>
              <div className={cx("tvs-pair__code", pair.kind !== "showing" && "tvs-pair__code--loading")} aria-label={pair.kind === "showing" ? `The code ${pair.code.code}` : undefined}>
                {pair.kind === "showing" ? spacedCode(pair.code.code) : " "}
              </div>
              <small className="tvs-pair__lasts">{pair.kind === "showing" ? codeLasts(pair.code.expiresAt, now().getTime()) : " "}</small>
            </>
          )}
        </div>
      )}
      <h4 className="tvs-phones__title">Phones that can change the channel</h4>
      {list === null ? (
        listed.isError ? (
          <p className="tvs-settings__error" role="alert">
            {listed.error.message}
          </p>
        ) : (
          <TvRow title=" " control={{ type: "none" }} />
        )
      ) : list.length ? (
        list.map((p) => (
          <TvRow
            key={p.id}
            fk={`tvs-row-phone-${p.id}`}
            title={p.name}
            help={phoneLine(p)}
            control={{ type: "action", label: "Remove" }}
            onFocus={focusRow(`tvs-row-phone-${p.id}`, "action")}
            onSelect={() => void remove(p)}
          />
        ))
      ) : (
        <TvRow title="No phones yet" help={signedIn ? "Phones signed in to your account appear here once they connect" : "Pair a phone to use it as a remote"} control={{ type: "none" }} />
      )}
      {error && (
        <p className="tvs-settings__error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
