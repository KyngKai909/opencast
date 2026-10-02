// The platforms seam (contracts relay.ts, `PlatformsSeam`): where the relay gets a station's
// destinations and keys, and asks connected accounts for their next broadcast. The platforms
// module provides it as `services.platforms`. Until that's there, the station's old translators
// stand in: every one is a pasted key (never "connected"), so restarts toggle its push and paid
// promotion is a reminder.

import type { PlatformsSeam, RelayDestination, RelayPlatformKind } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";

/** A translator's service as a platform kind (`rtmp` is any other address; a Facebook or Kick address is recognised). */
export function kindOfTranslator(service: string, rtmpUrl: string): RelayPlatformKind {
  if (service === "youtube" || service === "twitch") return service;
  if (/facebook\.com|fbcdn\.net/i.test(rtmpUrl)) return "facebook";
  if (/kick\.com|live-video\.net\/kick/i.test(rtmpUrl)) return "kick";
  return "custom";
}

/** The translators the station set up before platform connections, as destinations (all pasted keys). */
export function translatorPlatforms({ services }: ModuleContext): PlatformsSeam {
  return {
    async destinationsFor(stationId) {
      const rows = await services.stations.translatorDestinations(stationId);
      return rows.map(
        (r): RelayDestination => ({ platformId: r.id, kind: kindOfTranslator(r.service, r.rtmpUrl), name: r.name, rtmpUrl: r.rtmpUrl, streamKey: r.streamKey, connected: false })
      );
    },
    async prepareNextBroadcast() {
      return null;
    },
    async endBroadcast() {
      // Nothing to end: a pasted key's broadcast ends when its push does.
    },
    async setPaidPromotion() {
      return { applied: false };
    }
  };
}

/**
 * The platforms module's seam, with the old translators folded in: a translator turned off is left
 * out (its key is a platform connection since it moved, and the platforms module doesn't know the
 * switch), and one whose key couldn't move yet (no PLATFORM_SECRETS_KEY) is read as it was.
 * Without a platforms module, the old translators alone.
 */
export function platformsSeam(ctx: ModuleContext): PlatformsSeam {
  const provided = (ctx.services as unknown as { platforms?: Partial<PlatformsSeam> }).platforms;
  if (!provided || typeof provided.destinationsFor !== "function" || typeof provided.prepareNextBroadcast !== "function" || typeof provided.endBroadcast !== "function") return translatorPlatforms(ctx);
  const legacy = translatorPlatforms(ctx);
  return {
    async destinationsFor(stationId) {
      const [connections, off, unmoved] = await Promise.all([provided.destinationsFor!(stationId), ctx.services.stations.disabledTranslatorPlatforms(stationId), legacy.destinationsFor(stationId)]);
      const out = connections.filter((d) => !off.has(d.platformId));
      for (const d of unmoved) if (!out.some((x) => x.platformId === d.platformId)) out.push(d);
      return out;
    },
    prepareNextBroadcast: (id) => provided.prepareNextBroadcast!(id),
    endBroadcast: (id, broadcastId) => provided.endBroadcast!(id, broadcastId),
    setPaidPromotion: (id, on) => (typeof provided.setPaidPromotion === "function" ? provided.setPaidPromotion(id, on) : Promise.resolve({ applied: false }))
  };
}
