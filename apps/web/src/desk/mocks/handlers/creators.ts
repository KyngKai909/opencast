// The creator pipeline: creators and their works, asking permission, the answer (the public
// permission endpoints, so mock mode's "answer as the creator" works), the one reminder (N2),
// recipes, and setting up a claimable station. The rules are the API's (apps/api/src/v1/modules/
// network/desk.ts): asking is refused after a no; a yes records the exact works; setting up needs a
// yes or a licence, a free channel the waitlist doesn't hold, and a free call sign.

import { http, type HttpHandler } from "msw";
import { Creator, networkApi, type StationIdent } from "@opencast/contracts";
import { stationColourPasses } from "@opencast/ui";
import { now } from "../../../lib/clock";
import type { DbCreator } from "../fixtures/creators";
import { team } from "../fixtures/people";
import { advance, callSignTaken, channelTakenBy, creatorById, creatorView, getDb, marketById, newId, permissionView, saveDb, stationById, worksOf, workView } from "../db";
import { bodyOf, fail, needsAdmin, path, reply } from "../respond";
import { mockToken, permissionLink } from "./permission";

const DAY = 86_400_000;

/** The market's date `days` from now, `YYYY-MM-DD`. */
function dateIn(days: number, timeZone = "America/Los_Angeles"): string {
  const t = new Date(now().getTime() + days * DAY);
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  return f;
}

/** Whether a channel is on the band: TV 2.1 to 69.9; radio 88.1 to 107.9 on odd tenths. */
export function channelOnBand(band: "tv" | "radio", channel: string): boolean {
  if (!/^\d{1,3}\.\d$/.test(channel)) return false;
  const t = Math.round(Number(channel) * 10);
  if (band === "tv") return t >= 21 && t <= 699 && t % 10 !== 0;
  return t >= 881 && t <= 1079 && t % 2 === 1;
}

function view(c: DbCreator) {
  return reply(Creator, creatorView(c));
}

export const creatorHandlers: HttpHandler[] = [
  http.get(path(networkApi.listCreators), ({ request }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    advance();
    const q = new URL(request.url).searchParams;
    const marketId = q.get("marketId");
    const stage = q.get("stage");
    // The API's order: next action's date first (none last), then newest.
    const rows = getDb()
      .creators.filter((c) => (!marketId || c.marketId === marketId) && (!stage || c.stage === stage))
      .sort((a, b) => (a.nextActionDue ?? "9999").localeCompare(b.nextActionDue ?? "9999") || b.createdAt.localeCompare(a.createdAt));
    return reply(networkApi.listCreators.response, rows.map(creatorView));
  }),

  http.post(path(networkApi.addCreator), async ({ request }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const parsed = networkApi.addCreator.body.safeParse(await bodyOf(request));
    if (!parsed.success) {
      const fields = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
      return fail(400, "invalid", "Check the highlighted fields.", fields);
    }
    const b = parsed.data;
    if (!marketById(b.marketId)) return fail(404, "not_found", "That market wasn't found.");
    const c: DbCreator = {
      id: newId(),
      marketId: b.marketId,
      displayName: b.displayName,
      personName: b.personName ?? null,
      description: b.description ?? null,
      sourcePlatform: b.sourcePlatform,
      sourceUrl: b.sourceUrl,
      contactEmail: b.contactEmail ?? null,
      stage: "found",
      proposedOptions: null,
      nextAction: null,
      nextActionDue: null,
      doNotAsk: false,
      stationId: null,
      askedAt: null,
      remindedAt: null,
      answeredAt: null,
      claimInviteSentAt: null,
      claimLinkSentAt: null,
      claimedAt: null,
      licenceName: null,
      pronoun: "they",
      createdAt: now().toISOString(),
      setup: null
    };
    getDb().creators.push(c);
    saveDb();
    return reply(Creator, creatorView(c), 201);
  }),

  http.patch(path(networkApi.updateCreator), async ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const c = creatorById(String(params.creatorId));
    if (!c) return fail(404, "not_found", "That creator wasn't found.");
    const parsed = networkApi.updateCreator.body.safeParse(await bodyOf(request));
    if (!parsed.success) return fail(400, "invalid", "That change isn't valid.");
    const b = parsed.data;
    if (b.stage !== undefined) {
      c.stage = b.stage;
      if (b.stage === "declined") c.doNotAsk = true;
      if (b.stage === "no_answer" || b.stage === "declined") {
        c.nextAction = null;
        c.nextActionDue = null;
      }
    }
    if (b.proposed !== undefined) {
      if (b.proposed && !channelOnBand(b.proposed.band, b.proposed.channel)) return fail(400, "bad_channel", "That channel isn't in the band.");
      c.proposedOptions = b.proposed ? { band: b.proposed.band, channels: [b.proposed.channel] } : null;
    }
    if (b.nextAction !== undefined) c.nextAction = b.nextAction;
    if (b.nextActionDue !== undefined) c.nextActionDue = b.nextActionDue;
    if (b.contactEmail !== undefined) c.contactEmail = b.contactEmail;
    if (b.personName !== undefined) c.personName = b.personName;
    saveDb();
    return view(c);
  }),

  http.get(path(networkApi.listWorks), ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const c = creatorById(String(params.creatorId));
    if (!c) return fail(404, "not_found", "That creator wasn't found.");
    return reply(networkApi.listWorks.response, worksOf(c.id).map(workView));
  }),

  http.post(path(networkApi.askPermission), async ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const c = creatorById(String(params.creatorId));
    if (!c) return fail(404, "not_found", "That creator wasn't found.");
    if (c.doNotAsk) return fail(422, "do_not_ask", "They said no. Don't ask again.");
    const raw = await bodyOf<Record<string, unknown>>(request);
    const parsed = networkApi.askPermission.body.safeParse(raw);
    if (!parsed.success) return fail(400, "invalid", "Say where the message goes.");
    const b = parsed.data;
    if (b.proposed && !channelOnBand(b.proposed.band, b.proposed.channel)) return fail(400, "bad_channel", "That channel isn't in the band.");
    // B7 (proposed): the ticked works. Unticked ones are left out; ticking one brings it back in.
    const works = worksOf(c.id);
    const workIds = Array.isArray(raw?.workIds) ? new Set((raw!.workIds as unknown[]).map(String)) : new Set(works.filter((w) => !w.leftOutReason).map((w) => w.id));
    if (!works.some((w) => workIds.has(w.id))) return fail(422, "no_works", "Tick at least one work to ask about.");
    for (const w of works) {
      if (workIds.has(w.id)) w.leftOutReason = null;
      else w.leftOutReason ??= "Left out when asking";
    }
    const market = marketById(c.marketId);
    const proposed = b.proposed ?? (c.proposedOptions?.channels[0] ? { band: c.proposedOptions.band, channel: c.proposedOptions.channels[0] } : null);
    const token = mockToken(c, works, workIds, proposed, b.note ?? null, market?.name ?? "");
    const request_ = { id: newId(), token, creatorId: c.id, sentVia: b.sentVia, note: b.note ?? null, proposed, recipeId: b.recipeId ?? null, sentAt: now().toISOString(), answer: null };
    getDb().requests.push(request_);
    c.stage = "asked";
    c.askedAt = request_.sentAt;
    c.remindedAt = null;
    c.nextAction = "Reminder";
    c.nextActionDue = dateIn(7, market?.timezone);
    saveDb();
    return reply(networkApi.askPermission.response, { requestId: request_.id, link: permissionLink(token), preview: permissionView(request_) }, 201);
  }),

  http.post(path(networkApi.remindCreator), ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const c = creatorById(String(params.creatorId));
    if (!c) return fail(404, "not_found", "That creator wasn't found.");
    if (c.stage !== "asked") return fail(422, "not_asked", "There's no question out to remind them of.");
    if (c.remindedAt) return fail(422, "reminded", "They've had their one reminder.");
    c.remindedAt = now().toISOString();
    c.nextAction = "No answer";
    c.nextActionDue = dateIn(7, marketById(c.marketId)?.timezone);
    saveDb();
    return reply(Creator, creatorView(c), 201);
  }),

  // N3: invite them to claim (on air), or send the claim link (their permission page's Claim).
  http.post(path(networkApi.sendClaimInvite), async ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const c = creatorById(String(params.creatorId));
    if (!c) return fail(404, "not_found", "That creator wasn't found.");
    const parsed = networkApi.sendClaimInvite.body.safeParse(await bodyOf(request));
    if (!parsed.success) return fail(400, "invalid", "Say whether it's an invite or the link.");
    if (!c.stationId || stationById(c.stationId)?.ident.kind !== "claimable") return fail(422, "no_station", "Set up their station first.");
    if (!c.contactEmail) return fail(422, "no_contact", "Add their email first.");
    const at = now().toISOString();
    if (parsed.data.kind === "invite") c.claimInviteSentAt = at;
    else c.claimLinkSentAt = at;
    saveDb();
    return reply(Creator, creatorView(c), 201);
  }),

  // The creator's side, answered here too so mock mode can take a creator through the flow.
  http.get(path(networkApi.getPermissionPage), ({ params }) => {
    const r = getDb().requests.find((x) => x.token === String(params.token));
    if (!r) return fail(404, "not_found", "That page wasn't found.");
    return reply(networkApi.getPermissionPage.response, permissionView(r));
  }),

  http.post(path(networkApi.answerPermission), async ({ request, params }) => {
    const d = getDb();
    const r = d.requests.find((x) => x.token === String(params.token));
    if (!r) return fail(404, "not_found", "That page wasn't found.");
    if (r.answer) return fail(422, "already_answered", "This has been answered. Write to us to change it.");
    const parsed = networkApi.answerPermission.body.safeParse(await bodyOf(request));
    if (!parsed.success) return fail(400, "invalid", "Answer yes or no.");
    const c = creatorById(r.creatorId)!;
    const at = now().toISOString();
    const included = worksOf(c.id).filter((w) => !w.leftOutReason).map((w) => w.id);
    r.answer = { answer: parsed.data.answer, answeredAt: at, workIds: parsed.data.answer === "yes" ? included : [] };
    c.answeredAt = at;
    if (parsed.data.answer === "yes") Object.assign(c, { stage: "said_yes", nextAction: "Set up", nextActionDue: null });
    else Object.assign(c, { stage: "declined", doNotAsk: true, nextAction: null, nextActionDue: null });
    saveDb();
    return reply(networkApi.answerPermission.response, permissionView(r));
  }),

  http.get(path(networkApi.listRecipes), ({ request }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    return reply(networkApi.listRecipes.response, [...getDb().recipes].sort((a, b) => a.name.localeCompare(b.name)));
  }),

  http.post(path(networkApi.setUpClaimable), async ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const d = getDb();
    const c = creatorById(String(params.creatorId));
    if (!c) return fail(404, "not_found", "That creator wasn't found.");
    const parsed = networkApi.setUpClaimable.body.safeParse(await bodyOf(request));
    if (!parsed.success) {
      const fields = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
      return fail(400, "invalid", "Check the station's details.", fields);
    }
    const b = parsed.data;
    if (!["said_yes", "already_licensed"].includes(c.stage)) return fail(422, "no_permission", "Set up a station only after they say yes, or when their work is already licensed.");
    if (c.stationId) return fail(422, "already_set_up", "This creator already has a station.");
    if (!channelOnBand(b.band, b.channel)) return fail(400, "bad_channel", "That channel isn't in the band.");
    const recipe = d.recipes.find((r) => r.id === b.recipeId);
    if (!recipe) return fail(404, "not_found", "That recipe wasn't found.");
    const taken = channelTakenBy(b.marketId, b.band, b.channel);
    if (taken?.hold) return fail(409, "channel_held", `The waitlist holds ${b.channel} for ${taken.hold.callSign}. Pick another.`, { channel: "held" });
    if (taken?.station) return fail(409, "channel_taken", `${b.channel} is ${taken.station.ident.callSign ?? "taken"}'s. Pick another.`, { channel: "taken" });
    if (callSignTaken(b.callSign)) return fail(409, "call_sign_taken", `${b.callSign} is taken. Try another.`, { callSign: "taken" });
    if (b.colour && !stationColourPasses(b.colour)) return fail(400, "colour", "That colour doesn't hold 4.5:1 against white.", { colour: "contrast" });
    if (!team().some((t) => t.id === b.operatorUserId)) return fail(404, "not_found", "That team member wasn't found.");
    const market = marketById(b.marketId)!;
    const escrowId = Math.max(0, ...d.stations.map((s) => s.escrowId ?? 0)) + 1;
    const ident: StationIdent = { id: newId(), kind: "claimable", callSign: b.callSign, handle: b.callSign.toLowerCase(), name: b.name, colour: b.colour ?? null, band: b.band, channel: b.channel, marketSlug: market.slug, homeCity: null };
    d.stations.push({ ident, marketId: market.id, public: false, firstSignedOnAt: null, escrowId, signOnAt: b.signOnAt ?? null });
    d.balances[ident.id] = { heldMicros: 0, owedMicros: 0 };
    // Only the works the yes (or a licence) covers are imported.
    const covered = worksOf(c.id).map(workView).filter((w) => w.covered !== "none");
    c.stationId = ident.id;
    c.stage = "setting_up";
    c.nextAction = "Sign on";
    c.nextActionDue = null;
    c.proposedOptions = { band: b.band, channels: [b.channel] };
    c.setup = { recipeId: recipe.id, operatorId: b.operatorUserId, importTotal: covered.length, importDone: 0, setupAt: now().toISOString(), running: true };
    saveDb();
    return reply(networkApi.setUpClaimable.response, { station: ident, importable: covered.length }, 201);
  })
];
