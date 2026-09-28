// Settings, Team (biz-settings 02.1): everyone on the business's account, their role and when they
// were last in, invites waiting, and what each role can do. The owner changes the team; managers
// and viewers read it. Add someone opens ?modal=invite on the web, ?sheet=invite on the phone
// (05.2). The phone shows the plain list the phone frame draws.

import { useState } from "react";
import { accountsApi, type Invite, type TeamMember } from "@opencast/contracts";
import { Avatar, Button, Lines, Menu, PermissionsTable, Table, useToast, type Column, type MenuItem } from "@opencast/ui";
import { ApiError } from "../../api/client";
import { useApi, useApiMutation } from "../../api/hooks";
import type { BusinessState } from "../../business/BusinessContext";
import { useMe } from "../../business/BusinessContext";
import { MARKET_TZ, useNow } from "../../lib/clock";
import { Quiet } from "../../pages/common";
import { inviteState, invitedLine, lastIn, peopleLine } from "./format";
import { READ_ONLY, accessFor } from "./rules";
import "./common.css";
import "./TeamSection.css";

type Row = { kind: "member"; m: TeamMember } | { kind: "invite"; i: Invite };

const ROLE_WORDS: Record<string, string> = { owner: "Owner", manager: "Manager", viewer: "Viewer" };

/** What each role can do (biz-settings 02.1): the same matrix the app checks (business/abilities.ts). */
export const ROLE_TABLE = [
  { label: "See results, airings and statements", can: [true, true, true] },
  { label: "Spots, sponsorships, production orders, redeeming codes", can: [true, true, false] },
  { label: "Add money, approve orders", can: [true, true, false] },
  { label: "Take money out, connections, team, close account", can: [true, false, false] }
];

export function useTeam(businessId: string) {
  return useApi(accountsApi.getBusinessTeam, { params: { businessId } });
}

/** The lede under the heading: "5 people on Orange Street Coffee.", and why it reads only. */
export function TeamLede({ b }: { b: BusinessState }) {
  const team = useTeam(b.id);
  const readOnly = accessFor(b.role).team !== "edit";
  if (!team.data) return readOnly ? <>{READ_ONLY.team}</> : null;
  const line = peopleLine(team.data.members.length + team.data.invites.length, b.business.name);
  return <>{readOnly ? `${line} ${READ_ONLY.team}` : line}</>;
}

export function TeamSection({ b, phone, onInvite }: { b: BusinessState; phone: boolean; onInvite: () => void }) {
  const team = useTeam(b.id);
  const me = useMe();
  const now = useNow(60_000);
  const toast = useToast();
  const owner = accessFor(b.role).team === "edit";
  const invalidates = [accountsApi.getBusinessTeam];
  const update = useApiMutation(accountsApi.updateBusinessMember, { invalidates });
  const remove = useApiMutation(accountsApi.removeBusinessMember, { invalidates });
  const resend = useApiMutation(accountsApi.resendInvite, { invalidates });
  const [error, setError] = useState<string | null>(null);

  if (team.isLoading) return <Quiet />;
  if (!team.data) return <p className="bz-error" role="alert">{(team.error as Error | null)?.message ?? "Something went wrong. Try again."}</p>;

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
  const nameOf = (m: TeamMember) => m.displayName ?? m.email ?? "Someone";
  const rows: Row[] = [...team.data.members.map((m) => ({ kind: "member" as const, m })), ...team.data.invites.map((i) => ({ kind: "invite" as const, i }))];
  const biz = b.business.name;

  const setRole = (m: TeamMember, role: "manager" | "viewer") => {
    setError(null);
    update.mutate(
      { params: { businessId: b.id, userId: m.userId }, body: { role } },
      { onSuccess: () => toast.show({ message: `${nameOf(m)} is now ${role === "manager" ? "a manager" : "a viewer"}` }), onError: fail }
    );
  };
  const removeMember = (m: TeamMember) => {
    setError(null);
    remove.mutate({ params: { businessId: b.id, userId: m.userId } }, { onSuccess: () => toast.show({ message: `${nameOf(m)} no longer has access to ${biz}` }), onError: fail });
  };
  const resendInvite = (i: Invite) => {
    setError(null);
    resend.mutate({ params: { inviteId: i.id } }, { onSuccess: () => toast.show({ message: `Invite sent again to ${i.email ?? i.phone}` }), onError: fail });
  };
  /** The owner's row, and the owner's own, have no menu. */
  const menuFor = (m: TeamMember): MenuItem[] | null => (owner && m.role !== "owner" && m.userId !== me.data?.id ? [{ label: `Remove from ${biz}`, danger: true, onSelect: () => removeMember(m) }] : null);

  const errorLine = error && (
    <p className="bz-error" role="alert">
      {error}
    </p>
  );

  if (phone) {
    return (
      <div className="bz-team bz-team--phone">
        <ul className="bz-team__plist" aria-label={`${biz}'s team`}>
          {rows.map((r) => {
            if (r.kind === "invite") {
              const state = inviteState(r.i.expiresAt, now);
              return (
                <li key={r.i.id} className="bz-team__prow">
                  <div>
                    <b className="bz-team__pending">{r.i.email ?? r.i.phone}</b>
                    <small>
                      {ROLE_WORDS[r.i.role]}. {state === "Invite expired" ? state : invitedLine(r.i.createdAt, now, MARKET_TZ)}
                    </small>
                  </div>
                  {owner && <Menu label={`More for ${r.i.email ?? r.i.phone}`} items={[{ label: "Resend the invite", onSelect: () => resendInvite(r.i) }]} />}
                </li>
              );
            }
            const m = r.m;
            const items = menuFor(m);
            return (
              <li key={m.userId} className="bz-team__prow">
                <div>
                  <b>{nameOf(m)}</b>
                  <small>{ROLE_WORDS[m.role] ?? m.role}</small>
                </div>
                {items && (
                  <Menu
                    label={`More for ${nameOf(m)}`}
                    items={[m.role === "manager" ? { label: "Make them a viewer", onSelect: () => setRole(m, "viewer") } : { label: "Make them a manager", onSelect: () => setRole(m, "manager") }, ...items]}
                  />
                )}
              </li>
            );
          })}
        </ul>
        {errorLine}
        {owner && (
          <Button variant="primary" block className="bz-team__padd" onClick={onInvite}>
            Add someone
          </Button>
        )}
      </div>
    );
  }

  const columns: Column<Row>[] = [
    {
      key: "avatar",
      width: "44px",
      cell: (r) =>
        r.kind === "member" ? (
          <Avatar name={nameOf(r.m)} size={40} decorative />
        ) : (
          <span className="bz-team__pending-av" aria-hidden="true">
            ?
          </span>
        )
    },
    {
      key: "person",
      header: "Person",
      cell: (r) =>
        r.kind === "member" ? (
          <Lines title={nameOf(r.m)} detail={r.m.note ?? r.m.email} />
        ) : (
          <Lines title={<span className="bz-team__pending">{r.i.email ?? r.i.phone}</span>} detail={invitedLine(r.i.createdAt, now, MARKET_TZ)} />
        )
    },
    {
      key: "role",
      header: "Role",
      width: "170px",
      cell: (r) => {
        if (r.kind === "invite") return <span className="bz-role">{ROLE_WORDS[r.i.role]}</span>;
        const m = r.m;
        if (m.role === "owner") return <span className="bz-role bz-role--fixed">Owner</span>;
        if (!owner || m.userId === me.data?.id) return <span className="bz-role">{ROLE_WORDS[m.role] ?? m.role}</span>;
        return (
          <span className="bz-role bz-role--pick">
            <select aria-label={`${nameOf(m)}'s role`} value={m.role} onChange={(e) => setRole(m, e.target.value as "manager" | "viewer")} disabled={update.isPending}>
              <option value="manager">Manager</option>
              <option value="viewer">Viewer</option>
            </select>
          </span>
        );
      }
    },
    {
      key: "last",
      header: "Last in",
      width: "150px",
      cell: (r) => <span className="bz-team__last">{r.kind === "member" ? lastIn(r.m.lastInAt, now, MARKET_TZ) : inviteState(r.i.expiresAt, now)}</span>
    },
    {
      key: "actions",
      width: "80px",
      align: "start",
      cell: (r) => {
        if (!owner) return null;
        if (r.kind === "invite")
          return (
            <Button size="sm" block disabled={resend.isPending} onClick={() => resendInvite(r.i)} aria-label={`Resend the invite to ${r.i.email ?? r.i.phone}`}>
              Resend
            </Button>
          );
        const items = menuFor(r.m);
        return items ? <Menu label={`More for ${nameOf(r.m)}`} items={items} /> : null;
      }
    }
  ];

  return (
    <>
      {owner && (
        <Button variant="primary" size="sm" className="bz-team__add" onClick={onInvite}>
          Add someone
        </Button>
      )}
      <div className="bz-team">
        <Table label={`${biz}'s team`} columns={columns} rows={rows} rowKey={(r) => (r.kind === "member" ? r.m.userId : r.i.id)} rowPadding={11} gap={14} className="bz-team__table" />
        {errorLine}
        <div className="bz-sec-top bz-team__roles">
          <h4 className="bz-sec-top__h">What each role can do</h4>
        </div>
        <PermissionsTable caption="What each role can do" columnWidth={110} roles={["Owner", "Manager", "Viewer"]} abilities={ROLE_TABLE} className="bz-team__perm" />
      </div>
    </>
  );
}
