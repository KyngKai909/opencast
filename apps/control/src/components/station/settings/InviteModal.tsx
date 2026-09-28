// Invite someone (station-settings 03.2): an email or phone, a role (operator, or host with the
// blocks they'll host), and a link they sign in from with their own account. Owners aren't
// offered: ownership moves from the Ownership section. A modal on the web, a sheet on the phone.

import { useState, type FormEvent } from "react";
import { accountsApi, libraryApi } from "@opencast/contracts";
import { Button, ChoiceList, Field, Modal, SelectField, Sheet, useToast } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { call } from "../../../api/client";
import { ApiError } from "../../../api/client";
import { useApi } from "../../../api/hooks";
import type { InviteBodyX } from "../../../api/ext/station";
import type { StationState } from "../../../station/StationContext";
import "./InviteModal.css";

type Role = "operator" | "host";

/** An email address or a phone number, as the invite takes it; null when it's neither. */
export function contactOf(text: string): { email: string } | { phone: string } | null {
  const t = text.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return { email: t.toLowerCase() };
  const digits = t.replace(/[\s().-]/g, "");
  if (/^\+?\d{10,15}$/.test(digits)) return { phone: digits };
  return null;
}

export function InviteModal({ s, open, onClose, phone }: { s: StationState; open: boolean; onClose: () => void; phone: boolean }) {
  const cs = s.station.callSign ?? s.station.name;
  const library = useApi(libraryApi.getLibrary, { params: { stationId: s.id }, query: {} }, { enabled: open });
  const qc = useQueryClient();
  const toast = useToast();
  const [to, setTo] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [block, setBlock] = useState("");
  const [error, setError] = useState<{ field: "to" | "blocks" | "form"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const live = (library.data?.programs ?? []).filter((p) => p.live);
  const chosen = block || live[0]?.id || "";

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    const contact = contactOf(to);
    if (!contact) return setError({ field: "to", message: "Enter an email address or a phone number." });
    if (role === "host" && !chosen) return setError({ field: "blocks", message: "Choose the blocks they'll host." });
    const program = live.find((p) => p.id === chosen);
    const body: InviteBodyX = { ...contact, role, ...(role === "host" && program ? { programIds: [program.id], note: program.title } : {}) };
    setBusy(true);
    try {
      await call(accountsApi.inviteToStation, { params: { stationId: s.id }, body });
      void qc.invalidateQueries({ queryKey: [accountsApi.getStationTeam.method, accountsApi.getStationTeam.path] });
      toast.show({ message: `Invite sent to ${"email" in contact ? contact.email : contact.phone}` });
      setTo("");
      setRole("operator");
      onClose();
    } catch (err) {
      setError({ field: "form", message: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <form id="cc-invite" className="cc-invite" onSubmit={send} noValidate>
      <Field
        label="Email or phone"
        type="text"
        inputMode="email"
        autoComplete="off"
        value={to}
        onChange={(e) => (setTo(e.target.value), error?.field === "to" && setError(null))}
        error={error?.field === "to" ? error.message : undefined}
        autoFocus
      />
      <p className="cc-invite__label" id="cc-invite-role">
        Role
      </p>
      <ChoiceList<Role>
        label="Role"
        value={role}
        onChange={setRole}
        options={[
          { value: "operator", title: "Operator", helper: "Runs the station day to day, but not money or the team" },
          { value: "host", title: "Host", helper: "Goes live on the blocks you give them" }
        ]}
      />
      {role === "host" && (
        <SelectField label="Their blocks" value={chosen} onChange={(e) => setBlock(e.target.value)} error={error?.field === "blocks" ? error.message : undefined} disabled={!live.length}>
          {live.length ? (
            live.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))
          ) : (
            <option value="">{library.isLoading ? " " : `${cs} has no live blocks yet`}</option>
          )}
        </SelectField>
      )}
      {error?.field === "form" && (
        <p className="cc-invite__error" role="alert">
          {error.message}
        </p>
      )}
    </form>
  );
  const footer = (
    <Button variant="primary" type="submit" form="cc-invite" block disabled={busy}>
      Send invite
    </Button>
  );
  const props = { open, onClose, title: `Invite someone to ${cs}`, subtitle: "They'll get a link and sign in with their own account.", footer };
  return phone ? <Sheet {...props}>{body}</Sheet> : <Modal {...props}>{body}</Modal>;
}
