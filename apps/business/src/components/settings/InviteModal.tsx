// Invite someone (biz-settings 05.2; the web's "Add someone" opens the same): an email and a role,
// manager or viewer. They sign in with their own account. Owners only. A modal on the web
// (?modal=invite), a sheet on the phone (?sheet=invite).

import { useState, type FormEvent } from "react";
import { accountsApi } from "@opencast/contracts";
import { Button, Field, Modal, Segmented, Sheet, useToast } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, call } from "../../api/client";
import "./InviteModal.css";

type Role = "manager" | "viewer";

/** An email address as the invite takes it, or null. */
export function emailOf(text: string): string | null {
  const t = text.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null;
}

export function InviteModal({ businessId, open, onClose, phone }: { businessId: string; open: boolean; onClose: () => void; phone: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [to, setTo] = useState("");
  const [role, setRole] = useState<Role>("manager");
  const [error, setError] = useState<{ field: "to" | "form"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    const email = emailOf(to);
    if (!email) return setError({ field: "to", message: "Enter an email address." });
    setBusy(true);
    try {
      await call(accountsApi.inviteToBusiness, { params: { businessId }, body: { email, role } });
      void qc.invalidateQueries({ queryKey: [accountsApi.getBusinessTeam.method, accountsApi.getBusinessTeam.path] });
      toast.show({ message: `Invite sent to ${email}` });
      setTo("");
      setRole("manager");
      onClose();
    } catch (err) {
      // "Already on the team" and "already has an invite waiting" belong to the address.
      const message = err instanceof ApiError ? err.message : "Something went wrong. Try again.";
      setError({ field: err instanceof ApiError && err.status === 409 ? "to" : "form", message });
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <form id="bz-invite" className="bz-invite" onSubmit={send} noValidate>
      <Field
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="off"
        value={to}
        onChange={(e) => (setTo(e.target.value), error?.field === "to" && setError(null))}
        error={error?.field === "to" ? error.message : undefined}
        autoFocus
      />
      <div className="bz-invite__fld">
        <span className="bz-invite__lb" id="bz-invite-role">
          Role
        </span>
        <Segmented<Role>
          label="Role"
          value={role}
          onChange={setRole}
          options={[
            { value: "manager", label: "Manager" },
            { value: "viewer", label: "Viewer" }
          ]}
        />
      </div>
      {error?.field === "form" && (
        <p className="bz-error" role="alert">
          {error.message}
        </p>
      )}
    </form>
  );
  const footer = (
    <Button variant="primary" type="submit" form="bz-invite" block disabled={busy}>
      Send invite
    </Button>
  );
  const props = { open, onClose, title: "Invite someone", subtitle: "They'll get an email and sign in with their own account.", footer };
  return phone ? <Sheet {...props}>{body}</Sheet> : <Modal {...props}>{body}</Modal>;
}
