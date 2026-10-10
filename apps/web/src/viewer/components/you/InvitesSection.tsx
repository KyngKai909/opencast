// You: Invite friends (added 2026-10-07, invite-only sign-ups). A few codes each (10 to start),
// each good for one person: make one, then copy or share its link; a code nobody has used yet can
// be taken back, and goes back to what you can make. Who came in with each is listed under it.

import { useState } from "react";
import { invitesApi, type InviteCodeView } from "@opencast/contracts";
import { Button, useToast } from "@opencast/ui";
import { ApiError } from "../../../api/client";
import { useApi, useApiMutation } from "../../../api/hooks";
import { joinLink } from "../../../invites/code";
import "./InvitesSection.css";

type Form = "web" | "phone";

const day = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));

export function InvitesSection({ form }: { form: Form }) {
  const toast = useToast();
  const mine = useApi(invitesApi.mine);
  const make = useApiMutation(invitesApi.make, { invalidates: [invitesApi.mine] });
  const takeBack = useApiMutation(invitesApi.takeBack, { invalidates: [invitesApi.mine] });
  const [error, setError] = useState<string | null>(null);
  const d = mine.data;

  const share = async (c: InviteCodeView) => {
    const url = joinLink(c.code);
    try {
      if (form === "phone" && navigator.share) {
        await navigator.share({ title: "Come watch Opencast", text: `Here's an invite to Opencast: ${c.code}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.show({ message: "Invite link copied." });
    } catch {
      // Closed the share sheet, or no clipboard: the code is on screen to read out.
    }
  };

  const heading = (
    <>
      <h2 id="vw-you-inv">Invite friends</h2>
      {d && <span className="vw-y-sec-top__sub">{d.left === 1 ? "1 invite left" : `${d.left} invites left`}</span>}
    </>
  );
  const body = !d ? null : (
    <>
      <p className="vw-y-quiet vw-inv__lede">{d.inviteOnly ? "Opencast is invite-only for now." : "Anyone can sign up right now, but invites still count."} Each code is good for one person.</p>
      <ul className="vw-inv">
        {d.codes.map((c) => {
          const used = c.uses > 0;
          const who = c.joined[0];
          return (
            <li key={c.code} className="vw-inv__row">
              <span className="vw-inv__code">{c.code}</span>
              <span className="vw-inv__state">{used ? `${who?.name ?? "Someone"} came in ${who ? day(who.at) : ""}`.trim() : `Made ${day(c.createdAt)}, not used yet`}</span>
              {!used && (
                <span className="vw-inv__acts">
                  <Button size="sm" onClick={() => void share(c)}>
                    {form === "phone" ? "Share" : "Copy link"}
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Take back ${c.code}`} disabled={takeBack.isPending} onClick={() => takeBack.mutate({ params: { code: c.code } })}>
                    Take back
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {d.left > 0 ? (
        <Button
          size="sm"
          variant="primary"
          className="vw-inv__make"
          disabled={make.isPending}
          onClick={async () => {
            setError(null);
            try {
              const c = await make.mutateAsync({});
              await share(c);
            } catch (e) {
              setError(e instanceof ApiError ? e.message : "That didn't work. Try again.");
            }
          }}
        >
          Make an invite
        </Button>
      ) : (
        <p className="vw-y-quiet">You&rsquo;ve used all {d.allowance} of your invites.</p>
      )}
      {error && (
        <p className="vw-y-quiet" role="alert">
          {error}
        </p>
      )}
    </>
  );

  if (form === "phone")
    return (
      <>
        <h2 className="vw-y-psec">Invite friends{d ? <span>{d.left} left</span> : null}</h2>
        <div className="vw-you-p__list vw-inv--phone">{body}</div>
      </>
    );
  return (
    <section className="vw-y-sec" aria-labelledby="vw-you-inv">
      <div className="vw-y-sec-top">{heading}</div>
      {body}
    </section>
  );
}
