import { deskApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

export function settingsRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { settings } = services;
  const at = (iso?: string) => (iso ? new Date(iso) : undefined);

  r.handle(api.getTeam, ({ user }) => settings.team(user));
  r.handle(api.addTeamMember, ({ user, body }) => settings.addTeamMember(user, body));
  r.handle(api.setTeamRoles, ({ user, params, body }) => settings.setTeamRoles(user, params.userId, body));

  r.handle(api.listRules, ({ user, query }) => settings.listRules(user, at(query.at), query.scope));
  r.handle(api.ruleValue, ({ params, query }) => settings.ruleValue(params.key, at(query.at), query.scope));
  r.handle(api.ruleVersions, ({ params, query }) => settings.ruleVersions(params.key, query.scope));
  r.handle(api.setRule, ({ user, params, body }) => settings.setRule(user, params.key, body));
  r.handle(api.changeLog, ({ query }) => settings.changeLog(query));

  r.handle(api.listNumbering, () => settings.numbering());

  r.handle(api.getSigners, ({ user }) => settings.signers(user));
  r.handle(api.proposeSignerChange, ({ user, body }) => settings.proposeSigner(user, body));
  r.handle(api.decideSignerChange, ({ user, params, body }) => settings.decideSigner(user, params.proposalId, body));
  r.handle(api.withdrawSignerChange, ({ user, params }) => settings.withdrawSigner(user, params.proposalId));
}
