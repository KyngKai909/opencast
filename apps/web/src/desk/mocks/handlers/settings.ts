// Settings (desk-pages 04): the team and its roles, the rules registry, each market's numbering,
// escrow signer proposals, and the change log. The same rules as the API: admins change things,
// the team reads; a change never takes effect before today; signer changes wait for every other admin.
import { http, type HttpHandler } from "msw";
import { deskApi, isRuleKey, RULE_KEYS, ruleDef, type DeskRoleGrant, type SignerProposal } from "@opencast/contracts";
import { now } from "../../../lib/clock";
import { PEOPLE } from "../../../mocks/people";
import { MARKETS } from "../fixtures/markets";
import {
  findPerson,
  isAdminNow,
  logChange,
  nameOf,
  nextId,
  numberingView,
  personOf,
  proposalView,
  rolesOf,
  ruleVersions,
  ruleView,
  saveSettings,
  settingsDb,
  valueAt
} from "../settingsDb";
import { bodyOf, fail, lacks, needsDesk, path, reply } from "../respond";

const ROLE_WORDS = { admin: "an admin", rights_reviewer: "a rights reviewer", market_lead: "market lead" } as const;

function teamView(viewerId: string) {
  const d = settingsDb();
  const ids = [...new Set([...d.admins, ...d.roles.map((r) => r.personId)])];
  const people = ids
    .map((id) => PEOPLE.find((p) => p.id === id))
    .filter((p): p is (typeof PEOPLE)[number] => !!p)
    .map((p) => ({ userId: p.id, name: p.displayName ?? p.email, email: p.email, roles: rolesOf(p), adminByEmail: false, you: p.id === viewerId }))
    .filter((p) => p.roles.length)
    .sort((a, b) => Number(b.roles.some((r) => r.role === "admin")) - Number(a.roles.some((r) => r.role === "admin")) || a.name.localeCompare(b.name));
  return { people, canEdit: d.admins.includes(viewerId) };
}

type RoleIn = { role: DeskRoleGrant["role"]; marketId?: string };

function setRoles(byId: string, personId: string, roles: RoleIn[], note?: string): Response | null {
  const d = settingsDb();
  const person = PEOPLE.find((p) => p.id === personId);
  if (!person) return fail(404, "not_found", "That person wasn't found.");
  for (const r of roles) if ((r.role === "market_lead") !== !!r.marketId) return fail(400, "bad_request", "A market lead needs a market, and only a market lead has one.", { marketId: "Required for a market lead" });
  const wantsAdmin = roles.some((r) => r.role === "admin");
  const wasAdmin = d.admins.includes(personId);
  if (wasAdmin && !wantsAdmin && d.admins.length <= 1) return fail(422, "last_admin", "Opencast needs at least one admin. Make someone else an admin first.");
  const name = person.displayName ?? person.email;
  const market = (id: string | null | undefined) => MARKETS.find((m) => m.id === id)?.name ?? "a market";
  const describe = (r: { role: keyof typeof ROLE_WORDS; marketId?: string | null }) => (r.role === "market_lead" ? `market lead for the ${market(r.marketId)}` : ROLE_WORDS[r.role]);
  if (wasAdmin !== wantsAdmin) {
    d.admins = wantsAdmin ? [...d.admins, personId] : d.admins.filter((a) => a !== personId);
    logChange({ by: byId, kind: "role", subject: personId, summary: wantsAdmin ? `Made ${name} an admin` : `Took admin away from ${name}`, note: note ?? null });
  }
  const key = (r: { role: string; marketId?: string | null }) => `${r.role}:${r.marketId ?? ""}`;
  const wanted = new Set(roles.filter((r) => r.role !== "admin").map(key));
  for (const r of d.roles.filter((x) => x.personId === personId && !wanted.has(key(x)))) logChange({ by: byId, kind: "role", subject: personId, summary: `Took ${name} off as ${describe(r)}`, note: note ?? null });
  const had = new Set(d.roles.filter((x) => x.personId === personId).map(key));
  for (const r of roles.filter((x) => x.role !== "admin" && !had.has(key(x)))) logChange({ by: byId, kind: "role", subject: personId, summary: `Made ${name} ${describe(r)}`, note: note ?? null });
  d.roles = [...d.roles.filter((x) => x.personId !== personId), ...roles.filter((r) => r.role !== "admin").map((r) => ({ personId, role: r.role as "rights_reviewer" | "market_lead", marketId: r.marketId ?? null }))];
  saveSettings();
  return null;
}

function currentSigners() {
  const approved = valueAt("escrow.signers") as { signers: string[] | null; threshold: number | null };
  const d = settingsDb();
  return approved.signers ? { signers: approved.signers, threshold: approved.threshold ?? 1 } : { signers: d.signers.list, threshold: d.signers.threshold ?? 2 };
}

const short = (a: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export const settingsHandlers: HttpHandler[] = [
  http.get(path(deskApi.getTeam), ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    return reply(deskApi.getTeam.response, teamView(p.id));
  }),

  http.post(path(deskApi.addTeamMember), async ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "admin");
    if (no) return no;
    const body = await bodyOf<{ email?: string; roles?: RoleIn[] }>(request);
    const person = findPerson(body?.email ?? "");
    if (!person || !PEOPLE.includes(person)) return fail(422, "no_account", `No one has signed in to Opencast as ${(body?.email ?? "").trim()} yet. Ask them to sign in once, then add them.`);
    const current = rolesOf(person).map((g) => ({ role: g.role, marketId: g.market?.id }));
    const failed = setRoles(p.id, person.id, [...current, ...(body?.roles ?? [])]);
    return failed ?? reply(deskApi.addTeamMember.response, teamView(p.id));
  }),

  http.put(path(deskApi.setTeamRoles), async ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "admin");
    if (no) return no;
    const body = await bodyOf<{ roles?: RoleIn[]; note?: string }>(request);
    const failed = setRoles(p.id, String(params.userId), body?.roles ?? [], body?.note);
    return failed ?? reply(deskApi.setTeamRoles.response, teamView(p.id));
  }),

  http.get(path(deskApi.listRules), ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const url = new URL(request.url);
    const at = url.searchParams.get("at") ? new Date(url.searchParams.get("at")!) : now();
    const scope = url.searchParams.get("scope") ?? "";
    return reply(deskApi.listRules.response, { at: at.toISOString(), rules: RULE_KEYS.map((k) => ruleView(k, at, scope)), canEdit: isAdminNow(p) });
  }),

  http.get(path(deskApi.ruleValue), ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const key = String(params.key);
    if (!isRuleKey(key)) return fail(404, "not_found", "That rule wasn't found.");
    const url = new URL(request.url);
    const at = url.searchParams.get("at") ? new Date(url.searchParams.get("at")!) : now();
    const view = ruleView(key, at, url.searchParams.get("scope") ?? "");
    return reply(deskApi.ruleValue.response, { key, scope: view.scope, at: at.toISOString(), value: view.current.value, effectiveFrom: view.current.effectiveFrom, versionId: view.current.id });
  }),

  http.get(path(deskApi.ruleVersions), ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const key = String(params.key);
    if (!isRuleKey(key)) return fail(404, "not_found", "That rule wasn't found.");
    return reply(deskApi.ruleVersions.response, ruleVersions(key, new URL(request.url).searchParams.get("scope") ?? ""));
  }),

  http.post(path(deskApi.setRule), async ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "admin");
    if (no) return no;
    const key = String(params.key);
    if (!isRuleKey(key)) return fail(404, "not_found", "That rule wasn't found.");
    const def = ruleDef(key);
    if (def.readOnly) return fail(409, "use_proposal", "Escrow signers change through a proposal the other admins approve (Settings, Escrow signers).");
    const body = await bodyOf<{ value?: unknown; effectiveFrom?: string; scope?: string; note?: string }>(request);
    const parsed = def.schema.safeParse(body?.value);
    if (!parsed.success) return fail(400, "bad_request", `That value doesn't fit this rule: ${parsed.error.issues[0]?.message ?? "invalid"}.`, { value: parsed.error.issues[0]?.message ?? "Invalid" });
    const raw = body?.effectiveFrom ?? "";
    const from = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00.000Z`) : new Date(raw);
    if (Number.isNaN(from.getTime())) return fail(400, "bad_request", "Choose the date it takes effect.", { effectiveFrom: "Invalid" });
    const n = now();
    if (from.getTime() < Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())) return fail(422, "retroactive", "A change takes effect from today or later, never before: statements say which value applied.");
    const scope = def.scoped ? (body?.scope ?? "") : "";
    const before = ruleView(key, from, scope).current;
    settingsDb().rules.push({ id: nextId(), key, scope, value: parsed.data, effectiveFrom: from.toISOString(), setBy: p.id, note: body?.note?.trim() || null, createdAt: n.toISOString() });
    const market = MARKETS.find((m) => m.id === scope);
    logChange({
      by: p.id,
      kind: "rule",
      subject: key,
      scope,
      summary: `${def.title}${market ? ` (${market.name})` : ""}: ${before.display} to ${def.display(parsed.data, from)}`,
      before: before.value,
      after: parsed.data,
      effectiveFrom: from.toISOString(),
      note: body?.note?.trim() || null
    });
    saveSettings();
    return reply(deskApi.setRule.response, ruleView(key, now(), scope));
  }),

  http.get(path(deskApi.changeLog), ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    const limit = Number(url.searchParams.get("limit") ?? 200);
    const rows = settingsDb()
      .log.filter((e) => !kind || e.kind === kind)
      .slice(0, limit)
      .map((e) => ({ ...e, by: personOf(e.by) }));
    return reply(deskApi.changeLog.response, rows);
  }),

  http.get(path(deskApi.listNumbering), ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    return reply(deskApi.listNumbering.response, numberingView());
  }),

  http.get(path(deskApi.getSigners), ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const d = settingsDb();
    const approved = d.proposals.filter((x) => x.status === "approved").sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))[0];
    return reply(deskApi.getSigners.response, {
      source: d.signers.source,
      contract: null,
      signers: d.signers.list,
      threshold: d.signers.threshold,
      approved: approved ? proposalView(approved, p) : null,
      proposals: [...d.proposals].sort((a, b) => b.proposedAt.localeCompare(a.proposedAt)).map((x) => proposalView(x, p)),
      canPropose: isAdminNow(p)
    });
  }),

  http.post(path(deskApi.proposeSignerChange), async ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "admin");
    if (no) return no;
    const d = settingsDb();
    const approvers = d.admins.filter((a) => a !== p.id);
    if (!approvers.length) return fail(422, "needs_another_admin", "A signer change needs another admin to approve it. Add a second admin first.");
    if (d.proposals.some((x) => x.status === "open")) return fail(409, "proposal_open", "Another signer change is waiting for approval. Decide or withdraw it first.");
    const body = await bodyOf<{ kind?: SignerProposal["kind"]; oldAddress?: string; newAddress?: string; threshold?: number; note?: string }>(request);
    const kind = body?.kind ?? "add";
    const { signers, threshold } = currentSigners();
    const has = (a?: string) => signers.some((x) => x.toLowerCase() === a?.toLowerCase());
    const address = (a?: string) => !!a && /^0x[0-9a-fA-F]{40}$/.test(a);
    let after = [...signers];
    if (kind === "add" || kind === "replace") {
      if (!address(body?.newAddress)) return fail(400, "bad_request", "Say which key comes, as an address.", { newAddress: "An address: 0x and 40 hex digits" });
      if (has(body?.newAddress)) return fail(422, "already_a_signer", "That key is already a signer.");
    }
    if (kind === "remove" || kind === "replace") {
      if (!has(body?.oldAddress)) return fail(422, "not_a_signer", "That key isn't a signer.");
    }
    if (kind === "add") after.push(body!.newAddress!);
    if (kind === "remove") after = after.filter((x) => x.toLowerCase() !== body!.oldAddress!.toLowerCase());
    if (kind === "replace") after = after.map((x) => (x.toLowerCase() === body!.oldAddress!.toLowerCase() ? body!.newAddress! : x));
    if (kind === "threshold" && !body?.threshold) return fail(400, "bad_request", "Say how many approvals a claim needs.", { threshold: "Required" });
    const thresholdAfter = body?.threshold ?? Math.min(threshold, after.length);
    if (thresholdAfter < 1 || thresholdAfter > after.length) return fail(422, "bad_threshold", `A claim needs between 1 and ${Math.max(1, after.length)} approvals with ${after.length} keys.`);
    const proposal = {
      id: nextId(),
      kind,
      oldAddress: kind === "remove" || kind === "replace" ? body!.oldAddress! : null,
      newAddress: kind === "add" || kind === "replace" ? body!.newAddress! : null,
      signersAfter: after,
      thresholdAfter,
      note: body?.note?.trim() || null,
      proposedBy: p.id,
      proposedAt: now().toISOString(),
      approvers,
      decisions: [],
      status: "open" as const,
      decidedAt: null
    };
    d.proposals.push(proposal);
    const words = { add: `Proposed adding ${short(proposal.newAddress)}`, remove: `Proposed removing ${short(proposal.oldAddress)}`, replace: `Proposed replacing ${short(proposal.oldAddress)} with ${short(proposal.newAddress)}`, threshold: `Proposed ${thresholdAfter} approvals a claim` };
    logChange({ by: p.id, kind: "signer", subject: proposal.id, summary: `${words[kind]}: ${thresholdAfter} of ${after.length}`, note: proposal.note });
    saveSettings();
    return reply(deskApi.proposeSignerChange.response, proposalView(proposal, p));
  }),

  http.post(path(deskApi.decideSignerChange), async ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "admin");
    if (no) return no;
    const d = settingsDb();
    const x = d.proposals.find((y) => y.id === String(params.proposalId));
    if (!x) return fail(404, "not_found", "That proposal wasn't found.");
    if (x.status !== "open") return fail(409, "not_open", "That proposal has been decided.");
    if (x.proposedBy === p.id) return fail(403, "forbidden", "You proposed it: the other admins decide it.");
    if (!x.approvers.includes(p.id)) return fail(403, "forbidden", "Only the admins it names decide it.");
    if (x.decisions.some((y) => y.adminId === p.id)) return fail(409, "already_decided", "You've already said.");
    const body = await bodyOf<{ decision?: "approve" | "refuse"; note?: string }>(request);
    const decision = body?.decision === "refuse" ? "refuse" : "approve";
    const at = now().toISOString();
    x.decisions.push({ adminId: p.id, decision, at, note: body?.note?.trim() || null });
    if (decision === "refuse") {
      x.status = "refused";
      x.decidedAt = at;
      logChange({ by: p.id, kind: "signer", subject: x.id, summary: `${nameOf(p.id)} refused the signer change`, note: body?.note?.trim() || null });
    } else {
      logChange({ by: p.id, kind: "signer", subject: x.id, summary: `${nameOf(p.id)} approved the signer change`, note: body?.note?.trim() || null });
      if (x.approvers.every((a) => x.decisions.some((y) => y.adminId === a && y.decision === "approve"))) {
        x.status = "approved";
        x.decidedAt = at;
        d.rules.push({ id: nextId(), key: "escrow.signers", scope: "", value: { signers: x.signersAfter, threshold: x.thresholdAfter }, effectiveFrom: at, setBy: p.id, note: "Approved in Settings. On-chain only through the timelock", createdAt: at });
        logChange({ by: p.id, kind: "signer", subject: x.id, summary: `Signer change approved: ${x.thresholdAfter} of ${x.signersAfter.length}. Next, the timelock`, effectiveFrom: at });
      }
    }
    saveSettings();
    return reply(deskApi.decideSignerChange.response, proposalView(x, p));
  }),

  http.post(path(deskApi.withdrawSignerChange), ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const x = settingsDb().proposals.find((y) => y.id === String(params.proposalId));
    if (!x) return fail(404, "not_found", "That proposal wasn't found.");
    if (x.proposedBy !== p.id) return fail(403, "forbidden", "Only whoever proposed it can withdraw it.");
    if (x.status !== "open") return fail(409, "not_open", "That proposal has been decided.");
    x.status = "withdrawn";
    x.decidedAt = now().toISOString();
    logChange({ by: p.id, kind: "signer", subject: x.id, summary: "Withdrew the signer change" });
    saveSettings();
    return reply(deskApi.withdrawSignerChange.response, proposalView(x, p));
  })
];
