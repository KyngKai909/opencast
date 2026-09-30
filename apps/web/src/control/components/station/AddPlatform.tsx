// "Add a platform" (the Translators page, step A4): sign in to YouTube or Twitch when they aren't
// connected yet, or add any other service (Facebook, Kick, any RTMP or RTMPS address) with its
// address and stream key. The key goes to the API once and is never shown back (it's encrypted
// there). A modal on the web, a sheet on the phone. Owners only.

import { useState } from "react";
import { PLATFORM_NAMES, platformsApi, relayApi, type OAuthProvider, type PlatformConnection, type PlatformKind, type PlatformList } from "@opencast/contracts";
import { Button, Field, Modal, SelectField, Sheet } from "@opencast/ui";
import { ApiError } from "../../../api/client";
import { useApiMutation } from "../../../api/hooks";
import { isRtmpAddress, MANUAL_ADDRESS } from "./relayWords";

const PROVIDERS: OAuthProvider[] = ["youtube", "twitch"];

/** Where YouTube and Twitch take a pasted key, when signing in to them isn't set up. */
const ADDRESS: Partial<Record<PlatformKind, string>> = { ...MANUAL_ADDRESS, youtube: "rtmps://a.rtmps.youtube.com/live2", twitch: "rtmp://live.twitch.tv/app" };

export interface AddPlatformProps {
  stationId: string;
  list: PlatformList;
  phone?: boolean;
  /** Signing in is in flight for this provider. */
  signingIn: OAuthProvider | null;
  onSignIn: (provider: OAuthProvider) => void;
  onClose: () => void;
  onAdded: (c: PlatformConnection) => void;
}

export function AddPlatform({ stationId, list, phone, signingIn, onSignIn, onClose, onAdded }: AddPlatformProps) {
  const add = useApiMutation(platformsApi.addManualPlatform, { invalidates: [platformsApi.listPlatforms, relayApi.getRelay] });
  const signedIn = (p: OAuthProvider) => list.platforms.some((c) => c.kind === p && c.method === "signed_in");
  const offers = PROVIDERS.filter((p) => list.signIn[p] && !signedIn(p));
  // By key: Facebook and Kick always; YouTube and Twitch only where signing in to them isn't set up.
  const kinds: PlatformKind[] = ["facebook", "kick", ...PROVIDERS.filter((p) => !list.signIn[p]), "custom"];
  const [kind, setKind] = useState<PlatformKind>(kinds[0]!);
  const [name, setName] = useState("");
  const [url, setUrl] = useState(ADDRESS[kinds[0]!] ?? "");
  const [key, setKey] = useState("");
  const [error, setError] = useState<{ field: "name" | "url" | "key" | "form"; message: string } | null>(null);

  const choose = (k: PlatformKind) => {
    // Start the address with the platform's usual one, unless one was typed.
    if (!url.trim() || Object.values(ADDRESS).includes(url)) setUrl(ADDRESS[k] ?? "");
    setKind(k);
  };

  const submit = () => {
    setError(null);
    const n = name.trim() || (kind === "custom" ? "" : PLATFORM_NAMES[kind]);
    if (!n) return setError({ field: "name", message: "Give it a name." });
    if (!isRtmpAddress(url)) return setError({ field: "url", message: "Use an rtmp:// or rtmps:// address." });
    if (!key.trim()) return setError({ field: "key", message: "Paste the stream key." });
    add.mutate(
      { params: { stationId }, body: { kind, name: n, rtmpUrl: url.trim(), streamKey: key.trim() } },
      {
        onSuccess: (c) => onAdded(c as PlatformConnection),
        onError: (e) => {
          if (e instanceof ApiError && e.fields?.rtmpUrl) return setError({ field: "url", message: "Use an rtmp:// or rtmps:// address." });
          setError({ field: "form", message: e instanceof ApiError ? e.message : "Something went wrong. Try again." });
        }
      }
    );
  };
  const err = (f: string) => (error?.field === f ? error.message : undefined);

  const body = (
    <div className="cc-addp">
      {offers.length > 0 && (
        <div className="cc-addp__signin">
          {offers.map((p) => (
            <Button key={p} block disabled={signingIn !== null} onClick={() => onSignIn(p)}>
              Sign in to {PLATFORM_NAMES[p]}
            </Button>
          ))}
          <p className="cc-addp__why">Signing in lets Opencast start broadcasts, mark paid promotion and count viewers.</p>
        </div>
      )}
      <h3 className="cc-addp__h">Add another service</h3>
      <form
        id="cc-addp-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <SelectField label="Platform" value={kind} onChange={(e) => choose(e.target.value as PlatformKind)}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k === "custom" ? "Another service" : PLATFORM_NAMES[k]}
            </option>
          ))}
        </SelectField>
        <Field label="Name" placeholder={kind === "custom" ? "My server" : PLATFORM_NAMES[kind]} value={name} onChange={(e) => setName(e.target.value)} error={err("name")} />
        <Field label="RTMP or RTMPS address" mono placeholder="rtmps://" value={url} onChange={(e) => setUrl(e.target.value)} error={err("url")} />
        <Field label="Stream key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} error={err("key")} help="Stream keys are encrypted and never shown again." />
        <p className="cc-addp__why">Viewers on a service added by key can't be counted, and Opencast reminds you to mark paid promotion there.</p>
        {error?.field === "form" && (
          <p className="cc-relays__error" role="alert">
            {error.message}
          </p>
        )}
      </form>
    </div>
  );
  const footer = (
    <Button variant="primary" type="submit" form="cc-addp-form" block disabled={add.isPending}>
      Add
    </Button>
  );
  const props = { open: true, onClose, title: "Add a platform", subtitle: "Sign in to YouTube or Twitch, or add any other service with its RTMP address and stream key", footer };
  return phone ? <Sheet {...props}>{body}</Sheet> : <Modal {...props}>{body}</Modal>;
}
