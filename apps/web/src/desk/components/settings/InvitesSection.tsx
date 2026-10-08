// Settings, Invites (added 2026-10-07, invite-only sign-ups), admins only: whether sign-ups need a
// code (the Sign-ups rules, changed under Rules), the desk's own codes made in batches for the
// first people (any number of uses each, a note, an end date), who's signed in and waiting with
// "Let in", how everyone came in, and whose invites brought the most people.

import { useState } from "react";
import { invitesApi, type InviteCodeView } from "@opencast/contracts";
import { Button, Field, KeyValueList, Modal, TextAreaField, useToast } from "@opencast/ui";
import { ApiError } from "../../../api/client";
import { useApi, useApiMutation } from "../../../api/hooks";
import { deskPath } from "../../../areas";
import { DEFAULT_TZ } from "../../../lib/clock";
import { joinLink } from "../../../invites/code";
import { dateAtTime } from "../../lib/dates";
import { ErrorLine, errorText, Quiet, SecTop } from "../../pages/common";

const when = (iso: string) => dateAtTime(iso, DEFAULT_TZ);
const ALL = [invitesApi.desk];

function usesText(c: InviteCodeView): string {
  if (c.revokedAt) return `Stopped. ${c.uses} came in`;
  if (c.expiresAt && Date.parse(c.expiresAt) <= Date.now()) return `Ended. ${c.uses} came in`;
  return c.maxUses == null ? `${c.uses} came in, no limit` : `${c.uses} of ${c.maxUses} used`;
}

export function InvitesSection() {
  const toast = useToast();
  const q = useApi(invitesApi.desk);
  const letIn = useApiMutation(invitesApi.letIn, { invalidates: ALL });
  const revoke = useApiMutation(invitesApi.deskRevoke, { invalidates: ALL });
  const [making, setMaking] = useState(false);
  if (q.isLoading) return <Quiet />;
  if (q.error || !q.data) return <ErrorLine error={q.error} />;
  const d = q.data;
  const c = d.counts;

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(joinLink(code));
      toast.show({ message: "Invite link copied." });
    } catch {
      toast.show({ message: `The code is ${code}.` });
    }
  };

  return (
    <>
      <SecTop title="Sign-ups" first />
      <KeyValueList
        variant="rows"
        items={[
          { title: "Invite only", detail: d.inviteOnly ? "New accounts need an invite code, a team invite, or you to let them in" : "Anyone can sign up", value: d.inviteOnly ? "On" : "Off" },
          { title: "Invite codes each", detail: "Everyone who's in can make this many, one person each", value: String(d.codesPerPerson) },
          {
            title: "Everyone in",
            detail: `${c.byPersonalCode} by a friend's code, ${c.byInternalCode} by the desk's codes, ${c.byTeamInvite} by a team invite, ${c.byDesk} let in here; the rest were here before invites or are admins. ${c.personalCodesMade} friends' codes made.`,
            value: String(c.admitted)
          },
          {
            title: "Change these",
            detail: "Under Rules, Sign-ups, from a date",
            actions: (
              <Button size="sm" href={deskPath("/settings/rules")}>
                Open Rules
              </Button>
            )
          }
        ]}
      />

      <SecTop
        title="Waiting to come in"
        sub={c.waiting ? `${c.waiting} signed in without a code` : "Nobody waiting"}
      />
      {d.waiting.length > 0 ? (
        <ul className="nd-inv">
          {d.waiting.map((w) => (
            <li key={w.userId} className="nd-inv__row">
              <span className="nd-inv__who">
                <b>{w.name ?? w.email ?? "No name or email"}</b>
                <small>
                  {w.name && w.email ? `${w.email}, ` : ""}signed in {when(w.signedUpAt)}
                </small>
              </span>
              <Button
                size="sm"
                disabled={letIn.isPending}
                onClick={() =>
                  letIn
                    .mutateAsync({ body: { userId: w.userId } })
                    .then(() => toast.show({ message: `${w.name ?? w.email ?? "They"} can come in now.` }))
                    .catch((e) => toast.show({ message: errorText(e) }))
                }
              >
                Let in
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="nd-quiet-text nd-inv__quiet">When someone signs in without a code, they wait here.</p>
      )}

      <SecTop
        title="The desk's codes"
        sub="For the first people: any number of uses each"
        end={
          <Button size="sm" variant="primary" onClick={() => setMaking(true)}>
            Make codes
          </Button>
        }
      />
      {d.internal.length > 0 ? (
        <ul className="nd-inv" aria-label="The desk's codes">
          {d.internal.map((code) => (
            <li key={code.code} className="nd-inv__row">
              <span className="nd-inv__who">
                <b className="nd-inv__code">{code.code}</b>
                <small>
                  {usesText(code)}
                  {code.note ? `. ${code.note}` : ""}
                  {code.expiresAt ? `. Ends ${when(code.expiresAt)}` : ""}
                </small>
              </span>
              {!code.revokedAt && (
                <span className="nd-inv__acts">
                  <Button size="sm" onClick={() => void copy(code.code)}>
                    Copy link
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Stop ${code.code}`} disabled={revoke.isPending} onClick={() => revoke.mutate({ params: { code: code.code } })}>
                    Stop
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="nd-quiet-text nd-inv__quiet">No codes yet. Make a batch for the first people.</p>
      )}

      {d.topInviters.length > 0 && (
        <>
          <SecTop title="Who's bringing people in" sub="By people who came in with their codes" />
          <ul className="nd-inv">
            {d.topInviters.map((t, i) => (
              <li key={`${t.email}-${i}`} className="nd-inv__row">
                <span className="nd-inv__who">
                  <b>{t.name ?? t.email ?? "No name"}</b>
                  {t.name && t.email && <small>{t.email}</small>}
                </span>
                <b>{t.joined}</b>
              </li>
            ))}
          </ul>
        </>
      )}
      {making && <MakeCodes onClose={() => setMaking(false)} />}
    </>
  );
}

function MakeCodes({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const make = useApiMutation(invitesApi.deskMake, { invalidates: ALL });
  const [count, setCount] = useState("10");
  const [uses, setUses] = useState("1");
  const [note, setNote] = useState("");
  const [ends, setEnds] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const n = Number(count);
    const u = uses.trim() === "" ? null : Number(uses);
    if (!Number.isInteger(n) || n < 1 || n > 100) return setError("Make 1 to 100 codes at a time.");
    if (u !== null && (!Number.isInteger(u) || u < 1)) return setError("Uses each: a whole number, or empty for no limit.");
    setError(null);
    try {
      const made = await make.mutateAsync({ body: { count: n, maxUses: u, note: note.trim() || null, expiresAt: ends ? new Date(`${ends}T23:59:59`).toISOString() : null } });
      toast.show({ message: made.length === 1 ? `Made ${made[0]!.code}.` : `Made ${made.length} codes.` });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : errorText(e));
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={480}
      title="Make invite codes"
      subtitle="The desk's codes, for the first people. Each says it's from Opencast."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={make.isPending}>
            Make them
          </Button>
        </>
      }
    >
      <div className="nd-inv__form">
        <Field label="How many codes" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
        <Field label="Uses each" help="Empty for no limit: one code for a whole group" inputMode="numeric" value={uses} onChange={(e) => setUses(e.target.value)} />
        <TextAreaField label="Note" help="Who they're for, for the desk only" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        <Field label="Ends" help="Optional: they stop working after this day" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />
        {error && (
          <p className="nd-form__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
