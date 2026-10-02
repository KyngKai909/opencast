// desk-pages 04, Settings: the team with its roles, and the rules everything else reads. Each rule
// shows its value; a change takes effect from a date, and the old value stays in the change log.
// Markets hold each market's numbering; Escrow signers lists the verifier keys (read-only) and the
// changes proposed here, which need every other admin's approval.
import { useState, type FormEvent } from "react";
import { deskApi, DESK_ROLE_LABELS, type DeskRoleGrant, type MarketNumbering, type RuleView, type SignerProposal, type TeamPerson } from "@opencast/contracts";
import { Button, Checkbox, Field, KeyValueList, Modal, Segmented, SelectField, Table, Tag, TextAreaField, useToast, type Column } from "@opencast/ui";
import { ApiError } from "../../../api/client";
import { useApi, useApiMutation } from "../../../api/hooks";
import { DEFAULT_TZ, now } from "../../../lib/clock";
import { dayMonth } from "../../lib/dates";
import { errorText, ErrorLine, Quiet } from "../../pages/common";
import { fieldsFor, fromWords, GROUPS, shortKey, todayIso, valueFrom, type ValueField } from "./rules";
import "../pipeline/forms.css";

const tz = DEFAULT_TZ;
const date = (iso: string) => dayMonth(iso, tz);
/** Effective dates are midnight UTC on the day chosen: read them in UTC. */
const day = (iso: string) => dayMonth(iso, "UTC");

function roleWords(g: DeskRoleGrant): string {
  return g.role === "market_lead" ? `Market lead, ${g.market?.name ?? "a market"}` : DESK_ROLE_LABELS[g.role];
}

// ---------- Team ----------

function RolesForm({ person, onClose }: { person: TeamPerson | null; onClose: () => void }) {
  const toast = useToast();
  const markets = useApi(deskApi.listNumbering, {});
  const add = useApiMutation(deskApi.addTeamMember, { invalidates: [deskApi.getTeam, deskApi.changeLog] });
  const set = useApiMutation(deskApi.setTeamRoles, { invalidates: [deskApi.getTeam, deskApi.changeLog] });
  const [email, setEmail] = useState("");
  const [admin, setAdmin] = useState(!!person?.roles.some((r) => r.role === "admin"));
  const [reviewer, setReviewer] = useState(!!person?.roles.some((r) => r.role === "rights_reviewer"));
  const [leads, setLeads] = useState<string[]>(person?.roles.filter((r) => r.role === "market_lead").map((r) => r.market!.id) ?? []);
  const [error, setError] = useState<string | null>(null);
  const roles = [...(admin ? [{ role: "admin" as const }] : []), ...(reviewer ? [{ role: "rights_reviewer" as const }] : []), ...leads.map((marketId) => ({ role: "market_lead" as const, marketId }))];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (person) await set.mutateAsync({ params: { userId: person.userId }, body: { roles } });
      else {
        if (!roles.length) return setError("Give them at least one role.");
        await add.mutateAsync({ body: { email: email.trim(), roles } });
      }
      toast.show({ message: person ? (roles.length ? `${person.name}'s roles are changed.` : `${person.name} is off the team.`) : `${email.trim()} is on the team.` });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorText(err));
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={500}
      title={person ? `${person.name}'s roles` : "Add someone to the team"}
      subtitle={person ? "Take every role away to take them off the team." : "They need an Opencast account: ask them to sign in once first."}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="nd-roles" disabled={add.isPending || set.isPending}>
            {person ? "Save roles" : "Add them"}
          </Button>
        </>
      }
    >
      <form id="nd-roles" className="nd-form" onSubmit={submit} noValidate>
        {!person && <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}
        <Checkbox checked={admin} onChange={setAdmin} label="Admin" helper="Changes rules, the team and escrow signers." />
        <Checkbox checked={reviewer} onChange={setReviewer} label="Rights reviewer" helper="Does the second check on catalog items, and handles claims." />
        {(markets.data ?? []).map((m) => (
          <Checkbox key={m.market.id} checked={leads.includes(m.market.id)} onChange={(v) => setLeads((l) => (v ? [...l, m.market.id] : l.filter((x) => x !== m.market.id)))} label={`Market lead, ${m.market.name}`} helper="Runs the pipeline and reservations in this market." />
        ))}
        {error && <p className="nd-form__error">{error}</p>}
      </form>
    </Modal>
  );
}

export function TeamSection() {
  const team = useApi(deskApi.getTeam, {});
  const [editing, setEditing] = useState<TeamPerson | "new" | null>(null);
  if (team.isLoading) return <Quiet />;
  if (team.error || !team.data) return <ErrorLine error={team.error} />;
  const t = team.data;
  const columns: Column<TeamPerson>[] = [
    {
      key: "who",
      header: "Person",
      cell: (p) => (
        <div className="nd-cat__series">
          <b>
            {p.name}
            {p.you ? " (you)" : ""}
          </b>
          <small>{p.email ?? ""}</small>
        </div>
      )
    },
    {
      key: "roles",
      header: "Roles",
      cell: (p) => (
        <span className="nd-roles">
          {p.roles.map((r) => (
            <Tag key={`${r.role}${r.market?.id ?? ""}`} variant={r.role === "admin" ? "solid" : "plain"}>
              {roleWords(r)}
            </Tag>
          ))}
          {p.adminByEmail ? <small className="nd-quiet-text"> Admin by OPENCAST_ADMIN_EMAILS</small> : null}
        </span>
      )
    },
    {
      key: "edit",
      header: <span className="oc-sr-only">Change</span>,
      width: "90px",
      align: "end",
      cell: (p) =>
        t.canEdit ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(p)} aria-label={`Change roles: ${p.name}`}>
            Change
          </Button>
        ) : null
    }
  ];
  return (
    <>
      <div className="nd-set-top">
        <p className="nd-set-p">Admins change rules and signers. Rights reviewers do the second check on catalog items and handle claims. Market leads run the pipeline and reservations in their markets.</p>
        {t.canEdit && (
          <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing("new")}>
            Add someone
          </Button>
        )}
      </div>
      <Table label="The team" columns={columns} rows={t.people} rowKey={(p) => p.userId} rowPadding={10} />
      {editing && <RolesForm person={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

// ---------- Rules ----------

function RuleForm({ rule, onClose }: { rule: RuleView; onClose: () => void }) {
  const toast = useToast();
  const save = useApiMutation(deskApi.setRule, { invalidates: [deskApi.listRules, deskApi.changeLog, deskApi.listNumbering] });
  const [fields, setFields] = useState<ValueField[]>(() => fieldsFor(rule.next?.value ?? rule.current.value));
  const [from, setFrom] = useState(todayIso(now()));
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const setField = (i: number, text: string) => setFields((fs) => fs.map((f, n) => (n === i ? { ...f, text } : f)));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const read = valueFrom(rule.current.value, fields);
    if ("error" in read) return setErrors({ [read.field]: read.error });
    try {
      await save.mutateAsync({ params: { key: rule.key }, body: { value: read.value, effectiveFrom: from, scope: rule.scope || undefined, note: note.trim() || undefined } });
      toast.show({ message: `${rule.title}: set from ${day(`${from}T00:00:00Z`)}.` });
      onClose();
    } catch (err) {
      setErrors(err instanceof ApiError && err.fields ? err.fields : { form: errorText(err) });
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={520}
      title={rule.title}
      subtitle={`Now ${rule.current.display}. The old value stays in the change log.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="nd-rule" disabled={save.isPending}>
            Set it
          </Button>
        </>
      }
    >
      <form id="nd-rule" className="nd-form" onSubmit={submit} noValidate>
        {fields.map((f, i) =>
          f.kind === "choice" ? (
            <SelectField key={f.name || "value"} label={f.label} value={f.text} onChange={(e) => setField(i, e.target.value)}>
              {f.options!.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectField>
          ) : f.kind === "json" || f.kind === "letters" ? (
            <TextAreaField key={f.name} label={f.label} rows={f.kind === "letters" ? 3 : 6} value={f.text} onChange={(e) => setField(i, e.target.value)} error={errors[f.name]} help={f.kind === "letters" ? "Capital letters, a comma between." : undefined} />
          ) : (
            <Field
              key={f.name}
              label={f.label}
              labelAside={f.nullable ? "Empty: not set yet" : undefined}
              inputMode="decimal"
              mono
              value={f.text}
              onChange={(e) => setField(i, e.target.value)}
              error={errors[f.name]}
              end={f.kind === "dollars" ? "$" : f.kind === "percent" ? "%" : undefined}
            />
          )
        )}
        <Field label="Takes effect" type="date" min={todayIso(now())} value={from} onChange={(e) => setFrom(e.target.value)} error={errors.effectiveFrom} help="From midnight that day (UTC). Never before today: statements say which value applied." />
        <Field label="Note" labelAside="Optional" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Decided at the October review" />
        {errors.form || errors.value ? <p className="nd-form__error">{errors.form ?? errors.value}</p> : null}
      </form>
    </Modal>
  );
}

export function RulesSection() {
  const rules = useApi(deskApi.listRules, {});
  const [editing, setEditing] = useState<RuleView | null>(null);
  if (rules.isLoading) return <Quiet />;
  if (rules.error || !rules.data) return <ErrorLine error={rules.error} />;
  const r = rules.data;
  return (
    <>
      {GROUPS.map((g) => {
        const list = r.rules.filter((x) => x.group === g.id);
        if (!list.length) return null;
        return (
          <section key={g.id} aria-label={g.label}>
            <div className="nd-grp">{g.label}</div>
            {list.map((x) => (
              <div className="nd-rule" key={x.key}>
                <div>
                  <b>{x.title}</b>
                  <small>{x.detail}</small>
                  {x.next && (
                    <small className="nd-rule__next">
                      {`${x.next.display} ${fromWords(x.next.effectiveFrom, day).replace(/^From/, "from")}`}
                    </small>
                  )}
                </div>
                <span className={`nd-rule__v${x.current.set ? "" : " nd-rule__v--unset"}`}>{x.current.display === "Not set yet" || x.current.set ? x.current.display : `${x.current.display}`}</span>
                {r.canEdit ? (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(x)} aria-label={`Edit: ${x.title}`}>
                    Edit
                  </Button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </section>
        );
      })}
      {editing && <RuleForm rule={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

// ---------- Markets ----------

function NumberingForm({ row, onClose }: { row: MarketNumbering; onClose: () => void }) {
  const toast = useToast();
  const save = useApiMutation(deskApi.setRule, { invalidates: [deskApi.listNumbering, deskApi.changeLog, deskApi.listRules] });
  const n = row.next?.numbering ?? row.numbering;
  const [f, setF] = useState({ tvFirst: String(n.tv.firstMajor), tvLast: String(n.tv.lastMajor), radioFirst: (n.radio.firstTenths / 10).toFixed(1), radioLast: (n.radio.lastTenths / 10).toFixed(1), from: todayIso(now()) });
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const tenths = (s: string) => Math.round(Number(s) * 10);
    const value = { tv: { firstMajor: Number(f.tvFirst), lastMajor: Number(f.tvLast) }, radio: { firstTenths: tenths(f.radioFirst), lastTenths: tenths(f.radioLast) } };
    try {
      await save.mutateAsync({ params: { key: "numbering.channels" }, body: { value, scope: row.market.id, effectiveFrom: f.from } });
      toast.show({ message: `${row.market.name}'s numbering is set.` });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal
      open
      onClose={onClose}
      width={500}
      title={`${row.market.name}'s numbering`}
      subtitle="Stations choose from these. TV majors each have subchannels; radio is on even tenths, 88.2 to 107.8."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="nd-numbering" disabled={save.isPending}>
            Set it
          </Button>
        </>
      }
    >
      <form id="nd-numbering" className="nd-form" onSubmit={submit} noValidate>
        <div className="nd-form__pair">
          <Field label="TV from" mono inputMode="numeric" value={f.tvFirst} onChange={(e) => set("tvFirst")(e.target.value)} />
          <Field label="TV to" mono inputMode="numeric" value={f.tvLast} onChange={(e) => set("tvLast")(e.target.value)} />
        </div>
        <div className="nd-form__pair">
          <Field label="Radio from" mono inputMode="decimal" value={f.radioFirst} onChange={(e) => set("radioFirst")(e.target.value)} />
          <Field label="Radio to" mono inputMode="decimal" value={f.radioLast} onChange={(e) => set("radioLast")(e.target.value)} />
        </div>
        <Field label="Takes effect" type="date" min={todayIso(now())} value={f.from} onChange={(e) => set("from")(e.target.value)} />
        {error && <p className="nd-form__error">{error}</p>}
      </form>
    </Modal>
  );
}

export function MarketsSection() {
  const list = useApi(deskApi.listNumbering, {});
  const rules = useApi(deskApi.listRules, {});
  const [editing, setEditing] = useState<MarketNumbering | null>(null);
  if (list.isLoading) return <Quiet />;
  if (list.error || !list.data) return <ErrorLine error={list.error} />;
  const canEdit = !!rules.data?.canEdit;
  const columns: Column<MarketNumbering>[] = [
    { key: "market", header: "Market", width: "180px", cell: (m) => <b>{m.market.name}</b> },
    { key: "tv", header: "TV", cell: (m) => m.tvLine },
    { key: "radio", header: "Radio", cell: (m) => m.radioLine },
    { key: "own", header: "Set", width: "150px", cell: (m) => <span className="nd-quiet-text">{m.own ? fromWords(m.effectiveFrom, day) : "Opencast-wide"}</span> },
    {
      key: "edit",
      header: <span className="oc-sr-only">Edit</span>,
      width: "80px",
      align: "end",
      cell: (m) =>
        canEdit ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(m)} aria-label={`Edit numbering: ${m.market.name}`}>
            Edit
          </Button>
        ) : null
    }
  ];
  return (
    <>
      <p className="nd-set-p">Each market's numbering ranges, so a market can grow without code. TV 2 to 69 with subchannels; radio 88.2 to 107.8, on even tenths so no number matches a real FM station.</p>
      <Table label="Numbering by market" columns={columns} rows={list.data} rowKey={(m) => m.market.id} rowPadding={10} />
      {editing && <NumberingForm row={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

// ---------- Escrow signers ----------

const KIND_WORDS: Record<SignerProposal["kind"], string> = { add: "Add a key", remove: "Remove a key", replace: "Replace a key", threshold: "Change how many approve a claim" };

function ProposeForm({ signers, onClose }: { signers: string[]; onClose: () => void }) {
  const toast = useToast();
  const propose = useApiMutation(deskApi.proposeSignerChange, { invalidates: [deskApi.getSigners, deskApi.changeLog] });
  const [kind, setKind] = useState<SignerProposal["kind"]>("replace");
  const [oldAddress, setOld] = useState(signers[0] ?? "");
  const [newAddress, setNew] = useState("");
  const [threshold, setThreshold] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await propose.mutateAsync({
        body: {
          kind,
          oldAddress: kind === "remove" || kind === "replace" ? oldAddress : undefined,
          newAddress: kind === "add" || kind === "replace" ? newAddress.trim() : undefined,
          threshold: threshold ? Number(threshold) : undefined,
          note: note.trim() || undefined
        }
      });
      toast.show({ message: "Proposed. Every other admin has to approve it." });
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
      title="Propose a signer change"
      subtitle="It takes effect here once every other admin approves it. On-chain, keys change only through the timelock."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="nd-propose" disabled={propose.isPending}>
            Propose it
          </Button>
        </>
      }
    >
      <form id="nd-propose" className="nd-form" onSubmit={submit} noValidate>
        <SelectField label="Change" value={kind} onChange={(e) => setKind(e.target.value as SignerProposal["kind"])}>
          {(Object.keys(KIND_WORDS) as SignerProposal["kind"][]).map((k) => (
            <option key={k} value={k}>
              {KIND_WORDS[k]}
            </option>
          ))}
        </SelectField>
        {(kind === "remove" || kind === "replace") && (
          <SelectField label="The key that goes" mono value={oldAddress} onChange={(e) => setOld(e.target.value)}>
            {signers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectField>
        )}
        {(kind === "add" || kind === "replace") && <Field label="The key that comes" mono placeholder="0x…" value={newAddress} onChange={(e) => setNew(e.target.value)} />}
        <Field label="Approvals a claim needs" labelAside={kind === "threshold" ? undefined : "Optional"} mono inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        <Field label="Why" labelAside="Optional" value={note} onChange={(e) => setNote(e.target.value)} placeholder="The key was on a lost laptop" />
        {error && <p className="nd-form__error">{error}</p>}
      </form>
    </Modal>
  );
}

function proposalLine(p: SignerProposal): string {
  const what = { add: `Add ${shortKey(p.newAddress ?? "")}`, remove: `Remove ${shortKey(p.oldAddress ?? "")}`, replace: `Replace ${shortKey(p.oldAddress ?? "")} with ${shortKey(p.newAddress ?? "")}`, threshold: `${p.thresholdAfter} approvals a claim` }[p.kind];
  return `${what}: ${p.thresholdAfter} of ${p.signersAfter.length}`;
}

export function SignersSection() {
  const toast = useToast();
  const signers = useApi(deskApi.getSigners, {});
  const decide = useApiMutation(deskApi.decideSignerChange, { invalidates: [deskApi.getSigners, deskApi.changeLog] });
  const withdraw = useApiMutation(deskApi.withdrawSignerChange, { invalidates: [deskApi.getSigners, deskApi.changeLog] });
  const [proposing, setProposing] = useState(false);
  if (signers.isLoading) return <Quiet />;
  if (signers.error || !signers.data) return <ErrorLine error={signers.error} />;
  const s = signers.data;
  const act = async (f: () => Promise<unknown>, words: string) => {
    try {
      await f();
      toast.show({ message: words });
    } catch (e) {
      toast.show({ message: errorText(e) });
    }
  };
  const source = { contract: "Read from the escrow contract", config: "Read from configuration (ESCROW_VERIFIERS)", none: "No keys configured yet" }[s.source];
  return (
    <>
      <div className="nd-set-top">
        <p className="nd-set-p">The multi-sig verifier keys that approve a creator's claim. {source}. A change needs every other admin's approval here, then goes through the timelock on-chain.</p>
        {s.canPropose && (
          <Button size="sm" variant="primary" onClick={() => setProposing(true)} disabled={s.proposals.some((p) => p.status === "open")}>
            Propose a change
          </Button>
        )}
      </div>
      <KeyValueList
        items={[
          ...s.signers.map((k, n) => ({ label: `Key ${n + 1}`, value: <span className="nd-mono">{k}</span> })),
          { label: "Approvals a claim needs", value: s.threshold ? `${s.threshold} of ${s.signers.length}` : "Not set" }
        ]}
      />
      {s.approved && (
        <p className="nd-note">
          Approved {date(s.approved.decidedAt!)}, waiting for the timelock: {proposalLine(s.approved)}.
        </p>
      )}
      <div className="nd-grp">Proposals</div>
      {s.proposals.length ? (
        s.proposals.map((p) => (
          <div className="nd-rule" key={p.id}>
            <div>
              <b>{proposalLine(p)}</b>
              <small>
                Proposed by {p.proposedBy.name}, {date(p.proposedAt)}
                {p.note ? `. ${p.note}` : ""}
              </small>
              <small>{p.approvals.map((a) => `${a.admin.name}: ${a.decision === "approve" ? "approved" : a.decision === "refuse" ? "refused" : "waiting"}`).join(". ")}</small>
            </div>
            <span className="nd-rule__v">{{ open: "Waiting", approved: "Approved", refused: "Refused", withdrawn: "Withdrawn" }[p.status]}</span>
            <span className="nd-rule__acts">
              {p.canDecide && (
                <>
                  <Button size="sm" variant="primary" onClick={() => void act(() => decide.mutateAsync({ params: { proposalId: p.id }, body: { decision: "approve" } }), "Approved.")}>
                    Approve
                  </Button>
                  <Button size="sm" onClick={() => void act(() => decide.mutateAsync({ params: { proposalId: p.id }, body: { decision: "refuse" } }), "Refused. Nothing changes.")}>
                    Refuse
                  </Button>
                </>
              )}
              {p.canWithdraw && (
                <Button size="sm" variant="ghost" onClick={() => void act(() => withdraw.mutateAsync({ params: { proposalId: p.id } }), "Withdrawn.")}>
                  Withdraw
                </Button>
              )}
            </span>
          </div>
        ))
      ) : (
        <p className="nd-note">No changes proposed.</p>
      )}
      {proposing && <ProposeForm signers={s.signers} onClose={() => setProposing(false)} />}
    </>
  );
}

// ---------- Change log ----------

type Kind = "all" | "rule" | "role" | "signer" | "storage";

export function ChangeLogSection() {
  const [kind, setKind] = useState<Kind>("all");
  const log = useApi(deskApi.changeLog, { query: kind === "all" ? {} : { kind } });
  const columns: Column<NonNullable<typeof log.data>[number]>[] = [
    { key: "at", header: "When", width: "120px", cell: (e) => <span className="nd-quiet-text">{date(e.at)}</span> },
    { key: "by", header: "Who", width: "120px", cell: (e) => e.by?.name ?? "Opencast" },
    {
      key: "what",
      header: "What",
      cell: (e) => (
        <div className="nd-cat__series">
          {e.summary}
          {e.note ? <small>{e.note}</small> : null}
        </div>
      )
    },
    { key: "from", header: "Takes effect", width: "140px", cell: (e) => (e.effectiveFrom ? fromWords(e.effectiveFrom, day) : "") }
  ];
  return (
    <>
      <Segmented<Kind>
        label="Show"
        size="sm"
        value={kind}
        onChange={setKind}
        options={[
          { value: "all", label: "Everything" },
          { value: "rule", label: "Rules" },
          { value: "role", label: "Team" },
          { value: "signer", label: "Signers" },
          { value: "storage", label: "Storage" }
        ]}
      />
      {log.isLoading ? <Quiet /> : log.error || !log.data ? <ErrorLine error={log.error} /> : <Table label="Change log" columns={columns} rows={log.data} rowKey={(e) => e.id} rowPadding={9} className="nd-log" />}
    </>
  );
}
