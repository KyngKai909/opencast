import { networkApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { CurrentUser, RouteRegistrar } from "../../http.js";
import { notFound } from "../../errors.js";

export function networkRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { network, settings } = services;

  // Market-scoped pages (added 2026-09-29): an admin, or the market's lead (desk Settings, Team).
  // A market lead reads a list only for their market: without one, it's admins only.
  const inMarket = (user: CurrentUser, marketId: string | null | undefined) => settings.requireDesk(user, marketId ? { market: marketId } : "admin");
  const creatorsMarket = async (user: CurrentUser, creatorId: string) => {
    if (user.isAdmin) return;
    const marketId = await network.creatorMarket(creatorId);
    if (!marketId) throw notFound("That creator");
    await inMarket(user, marketId);
  };

  r.handle(api.getBoard, async ({ user, params, query }) => {
    if (!user.isAdmin) await inMarket(user, (await network.marketBySlug(params.marketSlug))?.id ?? null);
    return network.board(params.marketSlug, query.band);
  });
  r.handle(api.createMarket, ({ body }) => network.createMarket(body));
  r.handle(api.listCreators, async ({ user, query }) => {
    await inMarket(user, query.marketId);
    return network.creators(query);
  });
  r.handle(api.addCreator, async ({ user, body }) => {
    await inMarket(user, body.marketId);
    return network.addCreator(body);
  });
  r.handle(api.updateCreator, async ({ user, params, body }) => {
    await creatorsMarket(user, params.creatorId);
    return network.updateCreator(params.creatorId, body);
  });
  r.handle(api.listWorks, async ({ user, params }) => {
    await creatorsMarket(user, params.creatorId);
    return network.works(params.creatorId);
  });
  r.handle(api.addWorks, async ({ user, params, body }) => {
    await creatorsMarket(user, params.creatorId);
    return network.addWorks(params.creatorId, body);
  });
  r.handle(api.recordLicence, ({ params, body }) => network.recordLicence(params.workId, body));
  r.handle(api.askPermission, async ({ user, params, body }) => {
    await creatorsMarket(user, params.creatorId);
    return network.askPermission(params.creatorId, user.id, body);
  });
  // The creator's page needs no account.
  r.handle(api.getPermissionPage, ({ params }) => network.permissionPage(params.token));
  // N10: the claim page, by the same link (no account needed to read it).
  r.handle(api.getClaimPage, ({ params }) => network.claimPage(params.token));
  r.handle(api.answerPermission, ({ params, body, req }) => network.answerPermission(params.token, body, req.ip ?? null));
  // B8: stop from the link (no account, like the yes), or claim from it (signed in).
  r.handle(api.stopFromLink, ({ params, req }) => network.stopFromLink(params.token, req.ip ?? null));
  r.handle(api.claimFromLink, ({ user, params }) => network.claimFromLink(user, params.token));
  r.handle(api.remindCreator, async ({ user, params }) => {
    await creatorsMarket(user, params.creatorId);
    return network.remindCreator(params.creatorId);
  });
  r.handle(api.sendClaimInvite, ({ params, body }) => network.sendClaimInvite(params.creatorId, body.kind));
  r.handle(api.listRecipes, () => network.recipes());
  r.handle(api.saveRecipe, ({ body }) => network.saveRecipe(body));
  r.handle(api.setUpClaimable, ({ params, body }) => network.setUpClaimable(params.creatorId, body));
  r.handle(api.heldEarnings, () => network.heldEarnings());
  r.handle(api.startHandover, ({ user, params, body }) => network.startHandover(user, params.stationId, body));
  r.handle(api.approveHandover, ({ params }) => network.approveHandover(params.handoverId));
  r.handle(api.listListedSources, async ({ user, query }) => {
    await inMarket(user, query.marketId);
    return network.listedSources(query.marketId);
  });
  r.handle(api.addListedSource, ({ body }) => network.addListedSource(body));
  r.handle(api.syncListedSource, ({ params }) => network.syncListedSource(params.sourceId));
}
