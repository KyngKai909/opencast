import { catalogShelfApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";

export function shelfRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { shelf } = services;

  r.handle(api.getShelf, ({ user }) => shelf.shelf(user));
  r.handle(api.createSeries, ({ user, body }) => shelf.createSeries(user, body));
  r.handle(api.getSeries, ({ user, params }) => shelf.series(user, params.seriesId));
  r.handle(api.libraryChoices, ({ params }) => shelf.libraryChoices(params.seriesId));
  r.handle(api.addItem, ({ user, params, body }) => shelf.addItem(user, params.seriesId, body));
  r.handle(api.getItem, ({ user, params }) => shelf.item(user, params.itemId));
  r.handle(api.setCheck, ({ user, params, body }) => shelf.setCheck(user, params.itemId, params.line, body));
  r.handle(api.addEvidence, ({ user, params, file }) => shelf.addEvidence(user, params.itemId, params.line, file));
  r.handle(api.sendForSecondCheck, ({ user, params }) => shelf.send(user, params.itemId));
  r.handle(api.secondCheck, ({ user, params, body }) => shelf.secondCheck(user, params.itemId, body));
  r.handle(api.failItem, ({ user, params, body }) => shelf.fail(user, params.itemId, body.reason));
  r.handle(api.setEpisode, ({ user, params, body }) => shelf.setEpisode(user, params.seriesId, params.number, body));
  r.handle(api.rebuildEpisodes, ({ user, params }) => shelf.rebuild(user, params.seriesId));
}
