// Settings, Ownership (no frame; station-settings 01 note "Ownership is last in the rail"):
// transfer the station to another member, or sign off permanently. Signing off permanently frees
// the channel after 90 days and keeps the call sign reserved for a year. Owners only; operators
// read who owns it.

import { useState } from "react";
import { useNavigate } from "react-router";
import { accountsApi, playoutApi } from "@opencast/contracts";
import { Button, Field, Modal, SelectField, useToast } from "@opencast/ui";
import { useApiMutation } from "../../../api/hooks";
import { ApiError } from "../../../api/client";
import type { StationState } from "../../../station/StationContext";
import { Quiet } from "../../../pages/common";
import { useTeam } from "./TeamSection";
import "./common.css";
import "./OwnershipSection.css";

export function OwnershipSection({ s }: { s: StationState }) {
  const cs = s.station.callSign ?? s.station.name;
  const team = useTeam(s);
  const toast = useToast();
  const navigate = useNavigate();
  const owner = s.can("manage");
  const transfer = useApiMutation(accountsApi.transferStationOwnership, { invalidates: [accountsApi.getStationTeam, accountsApi.getMe] });
  const signOff = useApiMutation(playoutApi.signOff, { invalidates: [playoutApi.getStatus] });
  const [to, setTo] = useState("");
  const [confirm, setConfirm] = useState<"transfer" | "sign-off" | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (team.isLoading) return <Quiet />;
  if (!team.data) return <p className="cc-error" role="alert">{(team.error as Error | null)?.message ?? "Something went wrong. Try again."}</p>;

  const members = team.data.members;
  const current = members.find((m) => m.role === "owner");
  const others = members.filter((m) => m.role !== "owner");
  const target = others.find((m) => m.userId === (to || others[0]?.userId));
  const nameOf = (m: { displayName: string | null; email: string | null }) => m.displayName ?? m.email ?? "Someone";
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");

  const doTransfer = () => {
    if (!target) return;
    transfer.mutate(
      { params: { stationId: s.id }, body: { toUserId: target.userId } },
      {
        onSuccess: () => {
          setConfirm(null);
          toast.show({ message: `${nameOf(target)} owns ${cs} now. You're an operator.` });
        },
        onError: (e) => (setConfirm(null), fail(e))
      }
    );
  };
  const doSignOff = () =>
    signOff.mutate(
      { params: { stationId: s.id }, body: { permanently: true } },
      {
        onSuccess: () => {
          setConfirm(null);
          toast.show({ message: `${cs} has signed off for good.` });
          navigate("/");
        },
        onError: (e) => (setConfirm(null), fail(e))
      }
    );

  return (
    <div className="cc-owner">
      <div className="cc-row">
        <div>
          <b>Owner</b>
          <small>{current ? `${nameOf(current)} owns ${cs}.` : `${cs} has no owner on the team.`}</small>
        </div>
      </div>
      {!owner && <p className="cc-readonly cc-owner__ro">Only the owner can transfer {cs} or sign it off permanently.</p>}

      {owner && (
        <>
          <div className="cc-sec-top cc-sec-top--gap">
            <h4 className="cc-sec-top__h">Transfer {cs}</h4>
          </div>
          <p className="cc-owner__p">Make someone on the team the owner. You stay on as an operator. Only the owner can move money, change the team and sign {cs} off.</p>
          {others.length ? (
            <div className="cc-owner__transfer">
              <SelectField label="New owner" value={target?.userId ?? ""} onChange={(e) => setTo(e.target.value)}>
                {others.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {nameOf(m)}
                  </option>
                ))}
              </SelectField>
              <Button onClick={() => setConfirm("transfer")}>Transfer ownership</Button>
            </div>
          ) : (
            <p className="cc-owner__p">Invite someone to the team first. Ownership can only go to someone already on it.</p>
          )}

          <div className="cc-sec-top cc-sec-top--gap">
            <h4 className="cc-sec-top__h">Sign off permanently</h4>
          </div>
          <p className="cc-owner__p">
            {cs} goes off the air and leaves the dial. Channel {s.station.channel ?? ""} is freed after 90 days, and the call sign {cs} stays reserved for a year, so a returning station can reclaim it.
          </p>
          <Button onClick={() => (setTyped(""), setConfirm("sign-off"))}>
            Sign off permanently
          </Button>
        </>
      )}
      {error && (
        <p className="cc-error" role="alert">
          {error}
        </p>
      )}

      <Modal
        open={confirm === "transfer"}
        onClose={() => setConfirm(null)}
        title={`Make ${target ? nameOf(target) : "them"} the owner of ${cs}?`}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Keep it</Button>
            <Button variant="primary" onClick={doTransfer} disabled={transfer.isPending}>
              Transfer
            </Button>
          </>
        }
      >
        <p className="cc-owner__p">You'll stay on as an operator. They'll move money, change the team and decide whether {cs} signs off.</p>
      </Modal>

      <Modal
        open={confirm === "sign-off"}
        onClose={() => setConfirm(null)}
        title={`Sign ${cs} off for good?`}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Keep {cs} on</Button>
            <Button variant="ink" onClick={doSignOff} disabled={typed.trim().toUpperCase() !== cs.toUpperCase() || signOff.isPending}>
              Sign off permanently
            </Button>
          </>
        }
      >
        <p className="cc-owner__p">
          Viewers lose {cs} from the dial and their presets. Channel {s.station.channel ?? ""} is freed after 90 days; the call sign stays reserved for a year.
        </p>
        <Field label={`Type ${cs} to confirm`} value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
      </Modal>
    </div>
  );
}
