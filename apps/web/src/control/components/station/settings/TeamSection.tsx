// Settings, Team (station-settings 03.1): everyone who runs the station, their role and when they
// were last in, invites waiting, and what each role can do. Owners change the team; operators
// read it. Invite someone (03.2) opens over it at /settings/team/invite.

import { useState } from "react";
import { accountsApi, type Invite, type TeamMember } from "@opencast/contracts";
import { Avatar, Button, Lines, Menu, PermissionsTable, Table, useToast, type Column } from "@opencast/ui";
import { useApi, useApiMutation } from "../../../../api/hooks";
import { ApiError } from "../../../../api/client";
import { STATION_TZ, useNow } from "../../../../lib/clock";
import { useMe, type StationState } from "../../../station/StationContext";
import { Quiet } from "../../../pages/common";
import { expiresIn, invitedLine, lastIn } from "../format";
import "./common.css";
import "./TeamSection.css";

type Row = { kind: "member"; m: TeamMember } | { kind: "invite"; i: Invite };

const ROLE_WORDS: Record<string, string> = { owner: "Owner", operator: "Operator", host: "Host", manager: "Manager", viewer: "Viewer" };

/** What each role can do (station-settings 03.1), the same matrix the app checks (station/abilities.ts). */
export const ROLE_TABLE = [
  { label: "Go live on their assigned blocks, change lower thirds, cue breaks", can: [true, true, true] },
  { label: "Library, program log, listings, breaks, carriage", can: [true, true, false] },
  { label: "Spot market and rotations", can: [true, true, false] },
  { label: "Earnings, payouts and the station account", can: [true, "See only", false] },
  { label: "Team, identity, sign off", can: [true, false, false] }
];

export function peopleLine(n: number, callSign: string): string {
  return `${n} ${n === 1 ? "person runs" : "people run"} ${callSign}.`;
}

/** The count in the lede: members and invites waiting, as the frame counts dee@example.com. */
export function useTeam(s: StationState) {
  return useApi(accountsApi.getStationTeam, { params: { stationId: s.id } }, { enabled: s.can("programming") });
}

export function TeamSection({ s, phone = false }: { s: StationState; phone?: boolean }) {
  const team = useTeam(s);
  const me = useMe();
  const now = useNow(60_000);
  const toast = useToast();
  const cs = s.label;
  const owner = s.can("manage");
  const invalidates = [accountsApi.getStationTeam, accountsApi.getMe];
  const update = useApiMutation(accountsApi.updateStationMember, { invalidates });
  const remove = useApiMutation(accountsApi.removeStationMember, { invalidates });
  const resend = useApiMutation(accountsApi.resendInvite, { invalidates });
  const [error, setError] = useState<string | null>(null);

  if (team.isLoading) return <Quiet />;
  if (!team.data) return <p className="cc-error" role="alert">{(team.error as Error | null)?.message ?? "Something went wrong. Try again."}</p>;

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
  const nameOf = (m: TeamMember) => m.displayName ?? m.email ?? "Someone";
  const rows: Row[] = [...team.data.members.map((m) => ({ kind: "member" as const, m })), ...team.data.invites.map((i) => ({ kind: "invite" as const, i }))];

  const columns: Column<Row>[] = [
    {
      key: "avatar",
      width: "44px",
      cell: (r) =>
        r.kind === "member" ? (
          <Avatar name={nameOf(r.m)} size={40} decorative />
        ) : (
          <span className="cc-team__pending-av" aria-hidden="true">
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
          <Lines title={<span className="cc-team__pending">{r.i.email ?? r.i.phone}</span>} detail={invitedLine(r.i.createdAt, now, STATION_TZ)} />
        )
    },
    {
      key: "role",
      header: "Role",
      width: "170px",
      cell: (r) => {
        if (r.kind === "invite") return <span className="cc-role">{ROLE_WORDS[r.i.role]}</span>;
        if (r.m.role === "owner" || !owner) return <span className={r.m.role === "owner" ? "cc-role cc-role--fixed" : "cc-role"}>{ROLE_WORDS[r.m.role] ?? r.m.role}</span>;
        return (
          <span className="cc-role cc-role--pick">
            <select
              aria-label={`${nameOf(r.m)}'s role`}
              value={r.m.role}
              onChange={(e) => {
                setError(null);
                update.mutate(
                  { params: { stationId: s.id, userId: r.m.userId }, body: { role: e.target.value } },
                  { onSuccess: () => toast.show({ message: `${nameOf(r.m)} is now ${e.target.value === "host" ? "a host" : "an operator"}` }), onError: fail }
                );
              }}
            >
              <option value="operator">Operator</option>
              <option value="host">Host</option>
            </select>
          </span>
        );
      }
    },
    {
      key: "last",
      header: "Last in",
      width: "150px",
      cell: (r) => <span className="cc-team__last">{r.kind === "member" ? lastIn(r.m.lastInAt, now, STATION_TZ) : expiresIn(r.i.expiresAt, now)}</span>
    },
    {
      key: "actions",
      width: "80px",
      align: "start",
      cell: (r) => {
        if (!owner) return null;
        if (r.kind === "invite")
          return (
            <Button
              size="sm"
              block
              disabled={resend.isPending}
              onClick={() => resend.mutate({ params: { inviteId: r.i.id } }, { onSuccess: () => toast.show({ message: `Invite sent again to ${r.i.email ?? r.i.phone}` }), onError: fail })}
            >
              Resend
            </Button>
          );
        if (r.m.role === "owner" || r.m.userId === me.data?.id) return null;
        return (
          <Menu
            label={`More for ${nameOf(r.m)}`}
            items={[
              {
                label: `Remove from ${cs}`,
                danger: true,
                onSelect: () =>
                  remove.mutate(
                    { params: { stationId: s.id, userId: r.m.userId } },
                    { onSuccess: () => toast.show({ message: `${nameOf(r.m)} no longer has access to ${cs}` }), onError: fail }
                  )
              }
            ]}
          />
        );
      }
    }
  ];

  return (
    <div className="cc-team">
      {owner && (
        <Button variant="primary" size="sm" className="cc-team__invite" href={`${s.base}/settings/team/invite`}>
          Invite someone
        </Button>
      )}
      {phone ? (
        <ul className="cc-team__list" aria-label={`${cs}'s team`}>
          {rows.map((r) => {
            const cell = (k: string) => columns.find((c) => c.key === k)!.cell!(r);
            return (
              <li key={r.kind === "member" ? r.m.userId : r.i.id} className="cc-team__prow">
                {cell("avatar")}
                <div className="cc-team__pwho">
                  {cell("person")}
                  {cell("last")}
                </div>
                <div className="cc-team__pend">
                  {cell("role")}
                  {cell("actions")}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <Table
          label={`${cs}'s team`}
          columns={columns}
          rows={rows}
          rowKey={(r) => (r.kind === "member" ? r.m.userId : r.i.id)}
          rowPadding={11}
          gap={14}
          className="cc-team__table"
        />
      )}
      {error && (
        <p className="cc-error" role="alert">
          {error}
        </p>
      )}
      <div className="cc-sec-top cc-team__roles">
        <h4 className="cc-sec-top__h">What each role can do</h4>
      </div>
      <PermissionsTable caption="What each role can do" roles={["Owner", "Operator", "Host"]} abilities={ROLE_TABLE} />
    </div>
  );
}

/** The lede under the heading: "4 people run BEAT." */
export function TeamLede({ s }: { s: StationState }) {
  const team = useTeam(s);
  if (!team.data) return null;
  return <>{peopleLine(team.data.members.length + team.data.invites.length, s.label)}</>;
}

