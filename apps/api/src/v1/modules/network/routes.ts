import { networkApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

export function networkRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { network } = services;

  r.handle(api.getBoard, ({ params, query }) => network.board(params.marketSlug, query.band));
  r.handle(api.createMarket, ({ body }) => network.createMarket(body));
  r.handle(api.listCreators, ({ query }) => network.creators(query));
  r.handle(api.addCreator, ({ body }) => network.addCreator(body));
  r.handle(api.updateCreator, ({ params, body }) => network.updateCreator(params.creatorId, body));
  r.handle(api.listWorks, ({ params }) => network.works(params.creatorId));
  r.handle(api.addWorks, ({ params, body }) => network.addWorks(params.creatorId, body));
  r.handle(api.recordLicence, ({ params, body }) => network.recordLicence(params.workId, body));
  r.handle(api.askPermission, ({ user, params, body }) => network.askPermission(params.creatorId, user.id, body));
  // The creator's page needs no account.
  r.handle(api.getPermissionPage, ({ params }) => network.permissionPage(params.token));
  r.handle(api.answerPermission, ({ params, body, req }) => network.answerPermission(params.token, body, req.ip ?? null));
  // B8: stop from the link (no account, like the yes), or claim from it (signed in).
  r.handle(api.stopFromLink, ({ params, req }) => network.stopFromLink(params.token, req.ip ?? null));
  r.handle(api.claimFromLink, ({ user, params }) => network.claimFromLink(user, params.token));
  r.handle(api.remindCreator, ({ params }) => network.remindCreator(params.creatorId));
  r.handle(api.sendClaimInvite, ({ params, body }) => network.sendClaimInvite(params.creatorId, body.kind));
  r.handle(api.listRecipes, () => network.recipes());
  r.handle(api.saveRecipe, ({ body }) => network.saveRecipe(body));
  r.handle(api.setUpClaimable, ({ params, body }) => network.setUpClaimable(params.creatorId, body));
  r.handle(api.heldEarnings, () => network.heldEarnings());
  r.handle(api.startHandover, ({ user, params, body }) => network.startHandover(user, params.stationId, body));
  r.handle(api.approveHandover, ({ params }) => network.approveHandover(params.handoverId));
  r.handle(api.listListedSources, ({ query }) => network.listedSources(query.marketId));
  r.handle(api.addListedSource, ({ body }) => network.addListedSource(body));
  r.handle(api.syncListedSource, ({ params }) => network.syncListedSource(params.sourceId));
}
