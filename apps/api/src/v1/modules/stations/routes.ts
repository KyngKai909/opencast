import { logApi, stationsApi as api, type Airing, type StationIdent } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";
import { badRequest, HttpError, notFound } from "../../errors.js";
import { clientIp, isPrivateAddress } from "../../geo.js";
import { RELAY_BACKGROUND_MAX_BYTES, RELAY_BACKGROUND_TOO_BIG } from "./relayBackground.js";
import type { StationProfile } from "./service.js";

/** A246: a break rule's preview covers three hours at most (the tab asks for one). */
const PREVIEW_MAX_MS = 3 * 3_600_000;

/** A thin dial shows nearby markets' stations after its own. */
const THIN_DIAL = 6;

export function stationsRoutes(r: RouteRegistrar, { deps, services }: ModuleContext) {
  const { stations, accounts, network, log, playout } = services;
  const staff = ["owner", "operator"] as const;

  /** An external station's scheduled meeting or program, as the dial and guide show it. */
  const externalAiring = (a: { title: string; startsAt: string; endsAt: string | null }): Airing => ({
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

  /**
   * External stations (follow-up Phase 6) are on the dial, the guide and the swipe order only while
   * their evidence holds and their stream isn't down: the rest are left out here.
   */
  async function onTheDial(profiles: StationProfile[]) {
    const external = await network.externalDial(profiles.filter((p) => p.kind === "listed").map((p) => p.id));
    return { profiles: profiles.filter((p) => p.kind !== "listed" || external.get(p.id)?.onDial), external };
  }

  async function dialRows(profiles: StationProfile[], known?: Awaited<ReturnType<typeof network.externalDial>>) {
    const ids = profiles.map((p) => p.id);
    const listedIds = profiles.filter((p) => p.kind === "listed").map((p) => p.id);
    const now = deps.clock.now();
    const [nowNext, status, external, listedAirings] = await Promise.all([
      log.nowNext(ids, now),
      playout.statusFor(ids),
      known ?? network.externalDial(listedIds),
      // City meetings are often weeks apart: look a month ahead for the next one.
      network.listedAiringsInWindow(listedIds, now, new Date(now.getTime() + 30 * 24 * 3_600_000))
    ]);
    return profiles.map((p) => {
      if (p.kind === "listed") {
        const airings = listedAirings.get(p.id) ?? [];
        const current = airings.find((a) => Date.parse(a.startsAt) <= now.getTime() && Date.parse(a.endsAt ?? new Date(Date.parse(a.startsAt) + 3_600_000).toISOString()) > now.getTime());
        const next = airings.find((a) => Date.parse(a.startsAt) > now.getTime());
        const x = external.get(p.id);
        // On air whenever its stream is on the dial: what's on is the source's own schedule, or
        // nothing named at all (the banner says Live and the source), never a made-up title.
        return {
          station: p.ident,
          onAir: Boolean(x?.onDial && x.playback),
          now: current ? externalAiring(current) : null,
          next: next ? externalAiring(next) : null,
          playback: x?.playback ?? null,
          ...(x ? { external: x.info } : {})
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
        ...(onAir ? { signal: s?.standingBy && current?.now?.kind === "live" ? ("standby" as const) : ("ok" as const) } : {}),
        // Planned off air: when it's back.
        ...(current?.now?.kind === "off_air" && current.now.backAt ? { backAt: current.now.backAt } : {})
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
    const here = await onTheDial(await stations.onDial(market.id, query.band));
    const rows = await dialRows(here.profiles, here.external);
    const nearby =
      rows.length < THIN_DIAL
        ? await Promise.all(
            (await network.nearbyMarkets(market.id)).map(async (n) => {
              const there = await onTheDial(await stations.onDial(n.market.id, query.band));
              return { ...n, rows: await dialRows(there.profiles, there.external) };
            })
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
    const { profiles } = await onTheDial(await stations.onDial(market.id, query.band));
    const listedIds = profiles.filter((p) => p.kind === "listed").map((p) => p.id);
    const own = profiles.filter((p) => p.kind !== "listed" && p.kind !== "claimable").map((p) => p.id);
    const [window, listed, bands] = await Promise.all([
      log.window(profiles.map((p) => p.id), from, to),
      network.listedAiringsInWindow(listedIds, from, to),
      // A244: programming blocks (external and claimable stations have none).
      log.blockBands(own, from, to)
    ]);
    return {
      market,
      from: from.toISOString(),
      to: to.toISOString(),
      rows: profiles.map((p) => {
        const blocks = bands.get(p.id) ?? [];
        return {
          station: p.ident,
          airings: p.kind === "listed" ? (listed.get(p.id) ?? []).map(externalAiring) : (window.get(p.id) ?? []),
          ...(blocks.length ? { blocks } : {})
        };
      })
    };
  });

  r.handle(api.getStation, async ({ params }) => {
    const profile = await stations.byRef(params.stationRef);
    // A215: an external station taken off the dial for good is gone like a full station that signed
    // off for good (not found), and says so.
    if (profile && !profile.public && profile.kind === "listed" && profile.status === "signed_off") {
      throw new HttpError(404, "not_found", `${[profile.ident.callSign, profile.ident.name].filter(Boolean).join(", ")} is no longer on the dial.`);
    }
    if (!profile || !profile.public) throw notFound("That station");
    const external = profile.kind === "listed" ? (await network.externalDial([profile.id])).get(profile.id) : undefined;
    const [[row], programs, claimable, upcoming, blocks] = await Promise.all([
      dialRows([profile], external ? new Map([[profile.id, external]]) : undefined),
      services.library.programsForStation(profile.id),
      profile.kind === "claimable" ? network.claimableInfo(profile.id) : Promise.resolve(null),
      log.window([profile.id], deps.clock.now(), new Date(deps.clock.now().getTime() + 24 * 3_600_000)),
      // A244: its programming blocks in the next 14 days (external and claimable stations have none).
      profile.kind === "listed" || profile.kind === "claimable" ? Promise.resolve([]) : log.stationPageBlocks(profile.id)
    ]);
    return {
      station: profile.ident,
      description: profile.description,
      onAir: row.onAir,
      now: row.now,
      upNext:
        profile.kind === "listed"
          ? row.next
            ? [row.next]
            : []
          : (upcoming.get(profile.id) ?? []).filter((a) => !(a.logEntryId === (row.now?.logEntryId ?? null) && a.startsAt === row.now?.startsAt)).slice(0, 8),
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
      playback: row.playback,
      ...(external ? { external: { ...external.info, down: external.down } } : {}),
      ...(blocks.length ? { blocks } : {})
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
    // External stations off the dial (waiting for evidence, or down) aren't found.
    const offDial = new Set(
      [...(await network.externalDial([...found.stations.filter((s) => s.kind === "listed").map((s) => s.id), ...listed.map((l) => l.stationId), ...(found.tuneTo?.kind === "listed" ? [found.tuneTo.id] : [])])).entries()]
        .filter(([, x]) => !x.onDial)
        .map(([id]) => id)
    );
    const results: Array<{ station: StationIdent; airing: Airing; listed: boolean }> = [];
    for (const u of upcoming) {
      const p = profiles.get(u.stationId);
      const airing = (windowed.get(u.stationId) ?? []).find((a) => a.logEntryId === u.id);
      if (p?.public && airing && airings.has(u.id) && (!market || p.marketId === market.id)) results.push({ station: p.ident, airing, listed: false });
    }
    for (const l of listed) {
      const p = profiles.get(l.stationId);
      if (!p?.public || offDial.has(l.stationId) || (market && p.marketId !== market.id)) continue;
      results.push({ station: p.ident, airing: externalAiring(l), listed: true });
    }
    results.sort((a, b) => a.airing.startsAt.localeCompare(b.airing.startsAt));
    const tuneTo = found.tuneTo && !offDial.has(found.tuneTo.id) ? found.tuneTo.ident : null;
    return { tuneTo, stations: found.stations.filter((s) => !offDial.has(s.id)).map((s) => s.ident), airings: results.slice(0, 30) };
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
  r.handle(api.availableChannels, async ({ user, params, query }) => {
    const market = await network.marketBySlug(params.marketSlug);
    if (!market) throw notFound("That market");
    const [channels, ownSubchannels] = await Promise.all([stations.availableChannels(market.id, query.band), stations.ownSubchannels(user, market.id, query.band)]);
    return { market, band: query.band, channels, ownSubchannels };
  });
  r.handle(api.chooseChannel, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, ["owner"]);
    return stations.chooseChannel(params.stationId, body, user);
  });

  r.handle(api.getBreakRule, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return stations.breakRule(params.stationId);
  });
  r.handle(api.setBreakRule, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return stations.setBreakRule(params.stationId, body);
  });
  // A246: the breaks in a window rebuilt with a rule that isn't saved: the same checks and merging
  // as setBreakRule (resolveBreakRule), then the log's own walk with that rule. Nothing is written.
  r.handle(logApi.previewBreakRule, async ({ user, params, body }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    const from = new Date(body.from);
    const to = new Date(body.to);
    if (to.getTime() <= from.getTime()) throw badRequest("The preview ends after it starts.", { to: "After from" });
    if (to.getTime() - from.getTime() > PREVIEW_MAX_MS) throw badRequest("Preview three hours at most.", { to: "Three hours at most" });
    const rule = await stations.resolveBreakRule(params.stationId, body.rule);
    const preview = await log.previewBreaks(params.stationId, from, to, rule);
    return { rule, from: from.toISOString(), to: to.toISOString(), ...preview };
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

  // A radio station's relay background (added 2026-09-29).
  r.handle(api.getRelayBackground, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    return { background: await stations.getRelayBackground(params.stationId) };
  });
  r.handle(api.setRelayBackground, ({ params, file }) => stations.setRelayBackground(params.stationId, file), {
    maxBytes: RELAY_BACKGROUND_MAX_BYTES,
    tooBig: RELAY_BACKGROUND_TOO_BIG,
    authorize: ({ user, params }) => accounts.requireStation(user, params.stationId, [...staff])
  });
  r.handle(api.removeRelayBackground, async ({ user, params }) => {
    await accounts.requireStation(user, params.stationId, [...staff]);
    await stations.removeRelayBackground(params.stationId);
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
