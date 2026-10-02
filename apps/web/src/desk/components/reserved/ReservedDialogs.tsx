// Reserved call signs' dialogs (desk-pages 02): Invite the next 10, Decide (same name twice),
// Suggest (not allowed), Release, and Open (a reservation's details, with Invite again, Extend and
// Release). Each says who gets an email before anything is sent.

import { useEffect, useState, type FormEvent } from "react";
import { waitlistApi, type Market, type Reservation } from "@opencast/contracts";
import { Button, ChoiceList, Field, KeyValueList, Modal, useToast } from "@opencast/ui";
import { useApi, useApiMutation } from "../../../api/hooks";
import { dayMonth } from "../../lib/dates";
import { errorText } from "../../pages/common";
import { shortDay, whoIs, type Line } from "./reserved";

const refresh = [waitlistApi.listReservations, waitlistApi.reservationsOverview];

function Problem({ error }: { error: string | null }) {
  return error ? <p className="nd-form__error">{error}</p> : null;
}

export function InviteNextDialog({ market, next, waiting, onClose }: { market: Market; next: Reservation[]; waiting: number; onClose: () => void }) {
  const toast = useToast();
  const invite = useApiMutation(waitlistApi.inviteNextReservations, { invalidates: refresh });
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setError(null);
    try {
      const res = await invite.mutateAsync({ body: { marketId: market.id, count: 10 } });
      toast.show({ message: res.invited.length ? `Invited ${res.invited.length}: ${res.invited.map((r) => r.callSign).join(", ")}.` : "Nobody was waiting for an invite." });
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={500}
      title={next.length ? `Invite the next ${next.length}` : "Nobody to invite"}
      subtitle={next.length ? `In reservation order, in the ${market.name}. Each gets an email to set up their station with their call sign.` : `Everyone waiting in the ${market.name} has an invite, or needs a decision first.`}
      footer={
        next.length ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={send} disabled={invite.isPending}>
              {`Send ${next.length} ${next.length === 1 ? "invite" : "invites"}`}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {next.length > 0 && (
        <KeyValueList
          items={next.map((r) => ({ label: <b className="nd-reserved__cs">{r.callSign}</b>, value: `${whoIs(r)}${r.channel ? `, ${r.channel}` : ""}` }))}
        />
      )}
      {waiting > next.length && <p className="nd-reserved__quiet">{`${waiting - next.length} more after these.`}</p>}
      <Problem error={error} />
    </Modal>
  );
}

export function DecideDialog({ line, timeZone, onClose }: { line: Line; timeZone: string; onClose: () => void }) {
  const toast = useToast();
  const decide = useApiMutation(waitlistApi.decideReservation, { invalidates: refresh });
  const ideas = useApi(waitlistApi.callSignSuggestions, { params: { callSign: line.callSign } });
  const [keep, setKeep] = useState(line.rows[0]!.id);
  const [instead, setInstead] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const others = line.rows.filter((r) => r.id !== keep);
  // Each other person gets the next suggestion, until the desk types another.
  useEffect(() => {
    const pool = ideas.data?.suggestions;
    if (!pool) return;
    setInstead((cur) => Object.fromEntries(line.rows.map((r, i) => [r.id, cur[r.id] || pool[i] || ""])));
  }, [ideas.data, line.rows]);
  const kept = line.rows.find((r) => r.id === keep)!;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const suggestions = others.map((o) => ({ reservationId: o.id, callSign: (instead[o.id] ?? "").trim().toUpperCase() })).filter((s) => s.callSign);
    try {
      const res = await decide.mutateAsync({ params: { reservationId: keep }, body: { suggestions } });
      const told = res.told.map((t) => t.suggestion).filter(Boolean);
      const who = whoIs(kept);
      toast.show({ message: `${line.callSign} stays with ${who}${who.endsWith(".") ? "" : "."}${told.length ? ` ${told.join(", ")} ${told.length === 1 ? "is" : "are"} held instead for the other${told.length === 1 ? "" : "s"}.` : ""}` });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={520}
      title={`${line.callSign}: ${line.rows.length} people asked`}
      subtitle="The earlier one usually keeps it, but the fairest answer isn't always the earliest. The others keep their place in line with the name held for them instead, and get an email."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="nd-decide" disabled={decide.isPending}>
            {`Keep it for ${whoIs(kept)}`}
          </Button>
        </>
      }
    >
      <form id="nd-decide" className="nd-form" onSubmit={submit} noValidate>
        <ChoiceList
          label={`Who keeps ${line.callSign}`}
          value={keep}
          onChange={setKeep}
          options={line.rows.map((r) => ({ value: r.id, title: whoIs(r), helper: [r.about, `Asked ${shortDay(r.createdAt, timeZone)}`, r.channel ? `holds ${r.channel}` : null].filter(Boolean).join(". ") }))}
        />
        {others.map((o) => (
          <Field
            key={o.id}
            label={`Hold instead for ${whoIs(o)}`}
            mono
            value={instead[o.id] ?? ""}
            onChange={(e) => setInstead((cur) => ({ ...cur, [o.id]: e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5) }))}
            help="Free and allowed. Empty: the first free suggestion."
          />
        ))}
        <Problem error={error} />
      </form>
    </Modal>
  );
}

export function SuggestDialog({ reservation, onClose }: { reservation: Reservation; onClose: () => void }) {
  const toast = useToast();
  const suggest = useApiMutation(waitlistApi.suggestCallSign, { invalidates: refresh });
  const ideas = useApi(waitlistApi.callSignSuggestions, { params: { callSign: reservation.callSign } });
  const pool = ideas.data?.suggestions ?? [];
  const [choice, setChoice] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const picked = typed || choice || pool[0] || "";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!picked) return setError("Choose a name to hold instead.");
    try {
      await suggest.mutateAsync({ params: { reservationId: reservation.id }, body: { callSign: picked, alternatives: pool.filter((s) => s !== picked).slice(0, 3) } });
      toast.show({ message: `${picked} is held for ${whoIs(reservation)} instead of ${reservation.callSign}.` });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={500}
      title={`${reservation.callSign} isn't allowed`}
      subtitle={reservation.refusal?.reason}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="nd-suggest" disabled={suggest.isPending || !picked}>
            {picked ? `Hold ${picked} instead` : "Hold a name instead"}
          </Button>
        </>
      }
    >
      <form id="nd-suggest" className="nd-form" onSubmit={submit} noValidate>
        <p className="nd-reserved__quiet">{`${whoIs(reservation)} keeps their place in line and any channel held, and gets an email saying why, with the other names as well.`}</p>
        {pool.length > 0 && (
          <ChoiceList
            label="Hold instead"
            value={typed ? null : (choice ?? pool[0]!)}
            onChange={(v) => {
              setTyped("");
              setChoice(v);
            }}
            options={pool.map((s) => ({ value: s, title: s, helper: "Free, and allowed" }))}
          />
        )}
        <Field label="Or another name" labelAside="Optional" mono value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5))} />
        <Problem error={error} />
      </form>
    </Modal>
  );
}

export function ReleaseDialog({ reservation, onClose }: { reservation: Reservation; onClose: () => void }) {
  const toast = useToast();
  const release = useApiMutation(waitlistApi.releaseReservation, { invalidates: refresh });
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setError(null);
    try {
      const res = await release.mutateAsync({ params: { reservationId: reservation.id }, body: {} });
      toast.show({ message: `${res.callSign}${res.channel ? ` and ${res.channel}` : ""} ${res.channel ? "are" : "is"} free.` });
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={460}
      title={`Release ${reservation.callSign}?`}
      subtitle={`${whoIs(reservation)}'s hold ends now${reservation.channel ? `, and channel ${reservation.channel} is free again` : ""}.${reservation.reason === "waitlist" && reservation.email ? " They get an email saying so." : ""}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={go} disabled={release.isPending}>
            {`Release ${reservation.callSign}`}
          </Button>
        </>
      }
    >
      <Problem error={error} />
    </Modal>
  );
}

export function OpenDialog({ reservation: r, timeZone, onRelease, onClose }: { reservation: Reservation; timeZone: string; onRelease: () => void; onClose: () => void }) {
  const toast = useToast();
  const invite = useApiMutation(waitlistApi.inviteReservation, { invalidates: refresh });
  const extend = useApiMutation(waitlistApi.extendReservation, { invalidates: refresh });
  const [error, setError] = useState<string | null>(null);
  const act = async (f: () => Promise<string>) => {
    setError(null);
    try {
      toast.show({ message: await f() });
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };
  const canInvite = r.reason === "waitlist" && !!r.email && !r.refusal && !r.sameName.length;
  return (
    <Modal
      open
      onClose={onClose}
      width={500}
      title={r.callSign}
      subtitle={[r.name, r.about].filter(Boolean).join(", ") || undefined}
      footer={
        <>
          {canInvite && (
            <Button variant="ghost" disabled={invite.isPending} onClick={() => act(async () => (await invite.mutateAsync({ params: { reservationId: r.id }, body: {} }), `Invited ${whoIs(r)} again.`))}>
              {r.invitedAt ? "Invite again" : "Invite"}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={extend.isPending}
            onClick={() => act(async () => `${r.callSign} is held until ${dayMonth((await extend.mutateAsync({ params: { reservationId: r.id }, body: {} })).heldUntil!, timeZone)}.`)}
          >
            Extend
          </Button>
          <Button variant="ghost" onClick={onRelease}>
            Release
          </Button>
        </>
      }
    >
      <KeyValueList
        items={[
          { label: "Email", value: r.email ?? "None" },
          { label: "Reserved", value: dayMonth(r.createdAt, timeZone) },
          { label: "Ends", value: r.heldUntil ? dayMonth(r.heldUntil, timeZone) : "No end date" },
          { label: "Channel held", value: r.channel ?? "None yet" },
          { label: "Invited", value: r.invitedAt ? dayMonth(r.invitedAt, timeZone) : "Not yet" },
          { label: "Their station", value: r.stationId ? "Being set up" : "Not started" }
        ]}
      />
      <Problem error={error} />
    </Modal>
  );
}
