// `/invites/:inviteId`: the link in an invite email. Signed in (sign-in comes first, like every
// page), it joins the team and opens the business; otherwise it says why.

import { useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi, type Me } from "@opencast/contracts";
import { Button } from "@opencast/ui";
import { ApiError, call } from "../api/client";
import { keyFor } from "../api/hooks";
import { Quiet } from "./common";

export default function AcceptInvite() {
  const { inviteId = "" } = useParams();
  const qc = useQueryClient();
  const [result, setResult] = useState<{ to: string } | { error: string } | null>(null);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    call(accountsApi.acceptInvite, { params: { inviteId } })
      .then((me: Me) => {
        qc.setQueryData([...keyFor(accountsApi.getMe), 0], me);
        const newest = me.memberships.filter((m) => m.kind === "business").at(-1);
        setResult({ to: newest && newest.kind === "business" ? `/${newest.business.id}/${newest.role === "viewer" ? "results" : "spots"}` : "/" });
      })
      .catch((e) => setResult({ error: e instanceof ApiError ? e.message : "Something went wrong. Try again." }));
  }, [inviteId, qc]);

  if (!result) return <Quiet />;
  if ("to" in result) return <Navigate to={result.to} replace />;
  return (
    <main className="bz-center">
      <h1 className="bz-center__h">That invite didn't work.</h1>
      <p className="bz-center__p">{result.error}</p>
      <Button href="/">Opencast for business</Button>
    </main>
  );
}
