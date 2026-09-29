import { stationsApi as api, type Airing, type StationIdent } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";
import { badRequest, HttpError, notFound } from "../../errors.js";
import { clientIp, isPrivateAddress } from "../../geo.js";
import type { StationProfile } from "./service.js";

/** A thin dial shows nearby markets' stations after its own. */
const THIN_DIAL = 6;

export function stationsRoutes(r: RouteRegistrar, { deps, services }: ModuleContext) {
  const { stations, accounts, network, log, playout } = services;
  const staff = ["owner", "operator"] as const;

  async function dialRows(profiles: StationProfile[]) {
    const ids = profiles.map((p) => p.id);
    const listedIds = profiles.filter((p) => p.kind === "listed").map((p) => p.id);
    const now = deps.clock.now();
    const [nowNext, status, listed, listedAirings] = await Promise.all([
      log.nowNext(ids, now),
      playout.statusFor(ids),
      network.listedPlayback(listedIds),
      // City meetings are often weeks apart: look a month ahead for the next one.
      network.listedAiringsInWindow(listedIds, now, new Date(now.getTime() + 30 * 24 * 3_600_000))
    ]);
    return profiles.map((p) => {
      if (p.kind === "listed") {
        const airings = listedAirings.get(p.id) ?? [];
        const toAiring = (a: (typeof airings)[number]): Airing => ({
          logEntryId: null,
          title: a.title,
          episodeTitle: null,
          code: "PGM",
          kind: "listed",
          startsAt: a.startsAt,
          endsAt: a.endsAt ?? new Date(Date.parse(a.startsAt) + 3_600_000).toISOString(),
          live: true,
          carriedFrom: null,
          programId: null
        });
        const current = airings.find((a) => Date.parse(a.startsAt) <= now.getTime() && Date.parse(a.endsAt ?? a.startsAt) > now.getTime());
        const next = airings.find((a) => Date.parse(a.startsAt) > now.getTime());
        return {
          station: p.ident,
          onAir: Boolean(current),
          now: current ? toAiring(current) : null,
          next: next ? toAiring(next) : null,
          playback: listed.has(p.id) ? { kind: "embed" as const, url: listed.get(p.id)! } : null
        };
      }
      const s = status.get(p.id);
      const current = nowNext.get(p.id);
      const onAir = Boolean(s?.onAir && current?.now && current.now.kind !== "off_air");
      return {
        station: p.ident,
        onAir,
        now: current?.now ?? null,
        next: current?.next ?? null,
        playback: s?.playbackUrl ? { kind: "hls" as const, url: s.playbackUrl } : null,
        // S13: a live block on the stand-by slate, waiting for its signal.
        ...(onAir ? { signal: s?.standingBy && current?.now?.kind === "live" ? ("standby" as const) : ("ok" as const) } : {})
      };
    });
  }

  r.handle(api.listMarkets, () => network.allMarkets());
  r.handle(api.marketForZip, async ({ params }) => {
    const market = await network.marketForZip(params.zip);
    return { market, nearby: market ? await network.nearbyMarkets(market.id) : [] };
  });

  // S10: the market from where someone is. Neither the address nor the point is stored or logged.
  r.handle(api.marketForConnection, async ({ req }) => {
    const ip = clientIp(req);
    const found = ip && !isPrivateAddress(ip) && deps.geo.configured ? await deps.geo.lookup(ip) : null;
    if (found?.zip) {
      const market = await network.marketForZip(found.zip);
      if (market) return { market, nearby: await network.nearbyMarkets(market.id) };
    }
    if (found?.point) return network.marketNear(found.point);
    return { market: null, nearby: (await network.openMarkets()).map((market) => ({ market, miles: null })) };
  });
  r.handle(api.marketForLocation, ({ query }) => network.marketNear({ lat: query.lat, lng: query.lng }));

  r.handle(api.getDial, async ({ params, query }) => {
    const market = await network.marketBySlug(params.marketSlug);
    if (!market) throw notFound("That market");
    const rows = await dialRows(await stations.onDial(market.id, query.band));
    const nearby =
      rows.length < THIN_DIAL
        ? await Promise.all(
            (await network.nearbyMarkets(market.id)).map(async (n) => ({ ...n, rows: await dialRows(await stations.onDial(n.market.id, query.band)) }))
          )
        : [];
    return { market, band: query.band, rows, nearby: nearby.filter((n) => n.rows.length) };
  });

  r.handle(api.getGuide, async ({ params, query }) => {
    const market = await network.marketBySlug(params.marketSlug);
    if (!market) throw notFound("That market");
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (to <= from || to.getTime() - from.getTime() > 24 * 3_600_000) throw badRequest("Ask for up to 24 hours.");
    const profiles = await stations.onDial(market.id, query.band);
    const listedIds = profiles.filter((p) => p.kind === "listed").map((p) => p.id);
    const [window, listed] = await Promise.all([
      log.window(profiles.map((p) => p.id), from, to),
      network.listedAiringsInWindow(listedIds, from, to)
    ]);
    return {
      market,
      from: from.toISOString(),
      to: to.toISOString(),
      rows: profiles.map((p) => ({
        station: p.ident,
        airings:
          p.kind === "listed"
            ? (listed.get(p.id) ?? []).map((a) => ({
                logEntryId: null,
                title: a.title,
                episodeTitle: null,
                code: "PGM" as const,
                kind: "listed" as const,
                startsAt: a.startsAt,
                endsAt: a.endsAt ?? new Date(Date.parse(a.startsAt) + 3_600_000).toISOString(),
                live: true,
                carriedFrom: null,
                programId: null
              }))
            : (window.get(p.id) ?? [])
      }))
    };
  });

  r.handle(api.getStation, async ({ params }) => {
    const profile = await stations.byRef(params.stationRef);
    if (!profile || !profile.public) throw notFound("That station");
    const [[row], programs, claimable, upcoming] = await Promise.all([
      dialRows([profile]),
      services.library.programsForStation(profile.id),
      profile.kind === "claimable" ? network.claimableInfo(profile.id) : Promise.resolve(null),
      log.window([profile.id], deps.clock.now(), new Date(deps.clock.now().getTime() + 24 * 3_600_000))
    ]);
    return {
      station: profile.ident,
      description: profile.description,
      onAir: row.onAir,
      now: row.now,
      upNext: (upcoming.get(profile.id) ?? []).filter((a) => a.logEntryId !== row.now?.logEntryId).slice(0, 8),
      programs: programs.map((p) => ({ id: p.id, title: p.title, description: p.description, live: p.live })),
      claimable: claimable
        ? {
            runFor: claimable.runFor,
            claimed: claimable.claimed,
            escrowContract: deps.config.escrowContractAddress,
            escrowStationId: profile.escrowId
          }
        : null,
      pledgesTaxDeductible: profile.pledgesTaxDeductible,
      playback: row.playback
    };
  });

  r.handle(api.search, async ({ query }) => {
    const market = query.market ? await network.marketBySlug(query.market) : null;
    const now = deps.clock.now();
    const [found, programs, listed] = await Promise.all([
      stations.search(query.q, market?.id),
      services.library.searchPrograms(query.q),
      network.searchListedAirings(query.q, now)
    ]);
    const upcoming = (await Promise.all(programs.slice(0, 10).map((p) => log.upcomingForProgram(p.id, 3)))).flat();
    const airings = await log.airingsByIds(upcoming.map((u) => u.id));
    const windowed = await log.window([...new Set(upcoming.map((u) => u.stationId))], now, new Date(now.getTime() + 14 * 86_400_000));
    const profiles = await stations.profiles([...upcoming.map((u) => u.stationId), ...listed.map((l) => l.stationId)]);
    const results: Array<{ station: StationIdent; airing: Airing; listed: boolean }> = [];
    for (const u of upcoming) {
      const p = profiles.get(u.stationId);
      const airing = (windowed.get(u.stationId) ?? []).find((a) => a.logEntryId === u.id);
      if (p?.public && airing && airings.has(u.id) && (!market || p.marketId === market.id)) results.push({ station: p.ident, airing, listed: false });
    }
    for (const l of listed) {
      const p = profiles.get(l.stationId);
      if (!p?.public || (market && p.marketId !== market.id)) continue;
      results.push({
        station: p.ident,
        airing: {
          logEntryId: null,
          title: l.title,
          episodeTitle: null,
          code: "PGM",
          kind: "listed",
          startsAt: l.startsAt,
          endsAt: l.endsAt ?? new Date(Date.parse(l.startsAt) + 3_600_000).toISOString(),
          live: true,
          carriedFrom: null,
          programId: null
        },
        listed: true
      });
    }
    results.sort((a, b) => a.airing.startsAt.localeCompare(b.airing.startsAt));
    return { tuneTo: found.tuneTo?.ident ?? null, stations: found.stations.map((s) => s.ident), airings: results.slice(0, 30) };
  });

  r.handle(api.createStation, ({ user, body }) => stations.create(user, body));
  r.handle(api.getSetup, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, ["owner", "operator", "host"]);
    return stations.setup(params.stationId);
  });
  r.handle(api.updateSetup, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    return stations.updateSetup(user, params.stationId, body);
  });
  r.handle(api.availableChannels, async ({ params, query }) => {
    const market = await network.marketBySlug(params.marketSlug);
    if (!market) throw notFound("That market");
    return { market, band: query.band, channels: await stations.availableChannels(market.id, query.band) };
  });
  r.handle(api.chooseChannel, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    return stations.chooseChannel(params.stationId, body);
  });

  r.handle(api.getBreakRule, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return stations.breakRule(params.stationId);
  });
  r.handle(api.setBreakRule, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return stations.setBreakRule(params.stationId, body);
  });

  r.handle(api.listTranslators, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return stations.translators(params.stationId);
  });
  r.handle(api.addTranslator, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return stations.addTranslator(params.stationId, body);
  });
  r.handle(api.updateTranslator, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return stations.updateTranslator(params.stationId, params.translatorId, body);
  });
  r.handle(api.removeTranslator, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    await stations.removeTranslator(params.stationId, params.translatorId);
    return { ok: true as const };
  });

  r.handle(api.listLiveSources, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, ["owner", "operator", "host"]);
    return stations.liveSources(params.stationId);
  });
  r.handle(api.addLiveSource, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return stations.addLiveSource(params.stationId, body);
  });
  r.handle(api.resetLiveSourceKey, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return stations.resetLiveSourceKey(params.stationId, params.sourceId);
  });
  r.handle(api.removeLiveSource, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    await stations.removeLiveSource(params.stationId, params.sourceId);
    return { ok: true as const };
  });

  r.handle(api.setHosts, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    if ((await services.library.stationOfProgram(params.programId)) !== params.stationId) throw notFound("That program");
    return { userIds: await stations.setHosts(params.stationId, params.programId, body.userIds) };
  });
  // A4: who hosts each live program. Hosts see their own.
  r.handle(api.listHosts, async ({ user, params }) => {
    const role = await accounts.requireStation(user, params.stationId, ["owner", "operator", "host"]);
    return { programs: await stations.hosts(params.stationId, role === "host" ? user.id : undefined) };
  });

  // S15: the lower third on a live block, for owners, operators and the block's hosts.
  async function liveBlockFor(user: Parameters<typeof accounts.requireStation>[0], stationId: string, entryId: string) {
    const role = await accounts.requireStation(user, stationId, ["owner", "operator", "host"]);
    const entry = await log.liveEntry(stationId, entryId);
    if (role === "host" && !(await stations.isHost(user.id, stationId, entry.programId))) throw new HttpError(403, "not_your_block", "Hosts run their own live blocks.");
    return entry;
  }
  r.handle(api.getLowerThird, async ({ user, params }) => {
    const entry = await liveBlockFor(user, params.stationId, params.entryId);
    return stations.lowerThird(params.stationId, entry.id, entry.programId);
  });
  r.handle(api.setLowerThird, async ({ user, params, body }) => {
    const entry = await liveBlockFor(user, params.stationId, params.entryId);
    return stations.setLowerThird(params.stationId, entry.id, entry.programId, user.id, body);
  });

  r.handle(api.getSpeakers, async ({ user, params }) => {
    const stationId = await services.library.stationOfProgram(params.programId);
    const role = await accounts.requireStation(user, stationId, ["owner", "operator", "host"]);
    if (role === "host" && !(await stations.isHost(user.id, stationId, params.programId))) throw notFound("That program");
    return stations.speakers(params.programId);
  });
  r.handle(api.setSpeakers, async ({ user, params, body }) => {
    const stationId = await services.library.stationOfProgram(params.programId);
    const role = await accounts.requireStation(user, stationId, ["owner", "operator", "host"]);
    if (role === "host" && !(await stations.isHost(user.id, stationId, params.programId))) throw notFound("That program");
    return stations.setSpeakers(params.programId, body);
  });
}
