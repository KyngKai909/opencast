// Listed sources: city and county streams, listed not restreamed. Adding one puts its station on
// the dial at once (the API marks it signed on); a calendar syncs straight away. The mock "finds" a
// calendar whose address ends in .ics; anything else is "Calendar not found".
import { http, type HttpHandler } from "msw";
import { networkApi, type ListedSource, type StationIdent } from "@opencast/contracts";
import { now } from "../../lib/clock";
import type { DbListed } from "../fixtures/listed";
import { callSignTaken, channelTakenBy, getDb, marketById, newId, saveDb, stationById } from "../db";
import { bodyOf, fail, needsAdmin, path, reply } from "../respond";
import { channelOnBand } from "./creators";

function view(l: DbListed): ListedSource | null {
  const s = stationById(l.stationId);
  if (!s) return null;
  const { stationId: _s, ...rest } = l;
  return { ...rest, station: s.ident };
}

function sync(l: DbListed) {
  if (l.calendarUrl && /\.ics($|\?)/i.test(l.calendarUrl)) {
    l.calendarSync = "synced";
    l.lastSyncedAt = now().toISOString();
    l.upcoming = Math.max(l.upcoming, 3);
  } else if (l.calendarUrl) l.calendarSync = "calendar_not_found";
}

export const listedHandlers: HttpHandler[] = [
  http.get(path(networkApi.listListedSources), ({ request }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const marketId = new URL(request.url).searchParams.get("marketId");
    const d = getDb();
    const rows = d.listed.filter((l) => !marketId || stationById(l.stationId)?.marketId === marketId).sort((a, b) => a.name.localeCompare(b.name));
    return reply(networkApi.listListedSources.response, rows.map(view).filter((x): x is ListedSource => !!x));
  }),

  http.post(path(networkApi.addListedSource), async ({ request }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const parsed = networkApi.addListedSource.body.safeParse(await bodyOf(request));
    if (!parsed.success) {
      const fields = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
      return fail(400, "invalid", "Check the highlighted fields.", fields);
    }
    const b = parsed.data;
    const market = marketById(b.marketId);
    if (!market) return fail(404, "not_found", "That market wasn't found.");
    if (!channelOnBand(b.band, b.channel)) return fail(400, "bad_channel", "That channel isn't in the band.", { channel: "band" });
    const taken = channelTakenBy(b.marketId, b.band, b.channel);
    // Subchannels of a listed slot can take more city streams (9.1, 9.2, 9.3); anything else is taken.
    if (taken?.hold || (taken?.station && (taken.station.ident.channel === b.channel || taken.station.ident.kind !== "listed"))) return fail(409, "channel_taken", `${b.channel} is taken. Pick another.`, { channel: "taken" });
    if (callSignTaken(b.callSign)) return fail(409, "call_sign_taken", `${b.callSign} is taken. Try another.`, { callSign: "taken" });
    const d = getDb();
    const ident: StationIdent = { id: newId(), kind: "listed", callSign: b.callSign, handle: b.callSign.toLowerCase(), name: b.name, colour: null, band: b.band, channel: b.channel, marketSlug: market.slug, homeCity: null };
    d.stations.push({ ident, marketId: market.id, public: true, firstSignedOnAt: now().toISOString(), escrowId: null, signOnAt: null });
    const l: DbListed = { id: newId(), stationId: ident.id, name: b.name, description: b.description ?? null, streamUrl: b.streamUrl, embedTerms: b.embedTerms, calendarUrl: b.calendarUrl ?? null, calendarSync: "not_set", listingState: b.embedTerms === "allowed" ? "listed" : "checking", lastSyncedAt: null, upcoming: 0 };
    sync(l);
    d.listed.push(l);
    saveDb();
    return reply(networkApi.addListedSource.response, view(l)!, 201);
  }),

  http.post(path(networkApi.syncListedSource), ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const l = getDb().listed.find((x) => x.id === String(params.sourceId));
    if (!l) return fail(404, "not_found", "That listed source wasn't found.");
    if (!l.calendarUrl) return fail(422, "no_calendar", "Add the source's agenda calendar first.");
    sync(l);
    saveDb();
    return reply(networkApi.syncListedSource.response, view(l)!);
  })
];
