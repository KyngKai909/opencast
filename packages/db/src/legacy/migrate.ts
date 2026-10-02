// One-time move from the `opencast_state` blob (or storage/db.json) into the
// new tables. It only reads the old data, never changes it, and is safe to run
// again: rows keep their old ids and existing ones are skipped, so a second run
// at cutover picks up whatever the old app wrote since.

import type pg from "pg";
import type { Asset, Channel, DatabaseSchema, MultistreamDestination } from "@opencast/domain";
import { contrastOnWhite, isValidStationColour } from "@opencast/domain";

export interface Unmapped {
  table: string;
  id: string;
  reason: string;
}

export interface MigrationReport {
  source: string;
  read: Record<string, number>;
  written: Record<string, number>;
  skippedExisting: Record<string, number>;
  unmapped: Unmapped[];
  /** Things that mapped, but not exactly, and need a person to look. */
  notes: Unmapped[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CODE_BY_CATEGORY: Record<string, string> = { program: "PGM", ad: "SPT", sponsor: "UND", bumper: "BMP" };

export async function migrateLegacy(client: pg.ClientBase, db: DatabaseSchema, source: string): Promise<MigrationReport> {
  const report: MigrationReport = {
    source,
    read: Object.fromEntries(Object.entries(db).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : 0])),
    written: {},
    skippedExisting: {},
    unmapped: [],
    notes: []
  };
  const count = (bucket: Record<string, number>, key: string) => (bucket[key] = (bucket[key] ?? 0) + 1);
  const insert = async (table: string, sql: string, params: unknown[]) => {
    const result = await client.query(sql, params);
    count(result.rowCount ? report.written : report.skippedExisting, table);
    return result.rowCount ?? 0;
  };
  const unmapped = (table: string, id: string, reason: string) => report.unmapped.push({ table, id, reason });
  const note = (table: string, id: string, reason: string) => report.notes.push({ table, id, reason });

  // Users: one per owner wallet, matched later when they sign in with Privy and link that wallet.
  const userByWallet = new Map<string, string>();
  const wallets = new Set(db.channels.map((c) => c.ownerWallet).filter((w): w is string => Boolean(w)));
  for (const wallet of wallets) {
    const existing = await client.query<{ user_id: string }>(
      `SELECT user_id FROM accounts.identities WHERE kind = 'wallet' AND value = $1`,
      [wallet]
    );
    if (existing.rows[0]) {
      userByWallet.set(wallet, existing.rows[0].user_id);
      count(report.skippedExisting, "accounts.users");
      continue;
    }
    const created = await client.query<{ id: string }>(`INSERT INTO accounts.users DEFAULT VALUES RETURNING id`);
    const userId = created.rows[0].id;
    await client.query(`INSERT INTO accounts.identities (user_id, kind, value) VALUES ($1, 'wallet', $2)`, [userId, wallet]);
    userByWallet.set(wallet, userId);
    count(report.written, "accounts.users");
  }

  // Stations. The old model has no call sign, market, band or channel, so every
  // station arrives in setup and signs on through the new flow.
  const stationIds = new Set<string>();
  for (const channel of db.channels) {
    if (!UUID.test(channel.id)) {
      unmapped("channels", channel.id, "id isn't a UUID");
      continue;
    }
    stationIds.add(channel.id);
    const colour = stationColour(channel);
    if (channel.brandColor && !colour) {
      note(
        "channels",
        channel.id,
        `colour ${channel.brandColor} reads ${contrastOnWhite(channel.brandColor).toFixed(2)}:1 on white (needs 4.5:1); left unset`
      );
    }
    await insert(
      "broadcast.stations",
      `INSERT INTO broadcast.stations (id, kind, name, description, colour, logo_url, status, legacy_owner_wallet, legacy_slug, created_at, updated_at)
       VALUES ($1, 'station', $2, $3, $4, $5, 'setting_up', $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        channel.id,
        channel.name,
        channel.description || null,
        colour,
        channel.profileImageUrl ?? null,
        channel.ownerWallet ?? null,
        channel.slug,
        channel.createdAt,
        channel.updatedAt
      ]
    );
    note("channels", channel.id, `"${channel.name}" needs a call sign, market, band and channel before it signs on`);
    if (channel.bannerImageUrl) note("channels", channel.id, "banner image has no place in the new station page; kept only in the old data");
    if (channel.streamMode === "radio") note("channels", channel.id, "was a radio-mode station: choose the radio band when it sets up");
    if (channel.playerLabel && channel.playerLabel !== channel.name) {
      note("channels", channel.id, `player label "${channel.playerLabel}" dropped (the bug shows call sign and channel)`);
    }

    if (channel.ownerWallet) {
      await insert(
        "accounts.station_memberships",
        `INSERT INTO accounts.station_memberships (station_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
        [channel.id, userByWallet.get(channel.ownerWallet)]
      );
    } else {
      note("channels", channel.id, "no owner wallet: no one can manage it until an admin assigns an owner");
    }

    const rule = breakRule(channel);
    if (rule.note) note("channels", channel.id, rule.note);
    await insert(
      "broadcast.break_rules",
      `INSERT INTO broadcast.break_rules (station_id, mode, every_minutes) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [channel.id, rule.mode, rule.everyMinutes]
    );
  }

  // Folders, parents first.
  const folders = [...db.assetFolders].sort((a, b) => depth(db, a.id) - depth(db, b.id));
  for (const folder of folders) {
    if (!stationIds.has(folder.channelId)) {
      unmapped("assetFolders", folder.id, `station ${folder.channelId} wasn't migrated`);
      continue;
    }
    await insert(
      "broadcast.asset_folders",
      `INSERT INTO broadcast.asset_folders (id, station_id, name, parent_folder_id, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [folder.id, folder.channelId, folder.name, folder.parentFolderId ?? null, folder.createdAt]
    );
  }

  // Assets. Library items were copied into stations by the old app, so a library
  // item is migrated through its copies; one with no copy has no station to go to.
  const stationCopies = new Set(db.assets.filter((a) => stationIds.has(a.channelId)).map((a) => a.localPath));
  for (const asset of db.assets) {
    if (asset.channelId.startsWith("library:")) {
      if (stationCopies.has(asset.localPath)) {
        count(report.skippedExisting, "library copies (migrated via their station copy)");
      } else {
        unmapped("assets", asset.id, `"${asset.title}" is only in ${asset.channelId}'s creator library; there are no libraries outside stations now`);
      }
      continue;
    }
    if (!stationIds.has(asset.channelId)) {
      unmapped("assets", asset.id, `station ${asset.channelId} wasn't migrated`);
      continue;
    }
    const code = CODE_BY_CATEGORY[asset.insertionCategory ?? asset.type] ?? (asset.type === "ad" ? "SPT" : "PGM");
    const written = await insert(
      "broadcast.assets",
      `INSERT INTO broadcast.assets (id, station_id, folder_id, title, code, source, source_url, media_kind, duration_ms, status, legacy_id, created_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, 'ready', $1::text, $10)
       ON CONFLICT (id) DO NOTHING`,
      [
        asset.id,
        asset.channelId,
        asset.folderId ?? null,
        asset.title,
        code,
        asset.sourceType === "external" ? "link" : "upload",
        asset.sourceUrl ?? null,
        asset.mediaKind === "audio" ? "audio" : "video",
        asset.durationSec != null ? Math.round(asset.durationSec * 1000) : null,
        asset.createdAt
      ]
    );
    if (written) {
      await client.query(
        `INSERT INTO broadcast.asset_files (asset_id, version, storage, location, r2_key, ipfs_cid, compression, created_at)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
        [
          asset.id,
          storageOf(asset),
          asset.localPath,
          asset.r2Key ?? null,
          asset.ipfsCid ?? null,
          asset.compression ? JSON.stringify(asset.compression) : null,
          asset.createdAt
        ]
      );
      count(report.written, "broadcast.asset_files");
    }
    note("assets", asset.id, `"${asset.title}" needs its rights confirmed before it can go on the log`);
    if (asset.durationSec == null) note("assets", asset.id, `"${asset.title}" has no duration; probe it before scheduling`);
  }

  // The playlist has no times, and its items have no rights confirmations, so it
  // can't become a program log. Its order is listed so each station can rebuild it.
  const byChannel = new Map<string, string[]>();
  for (const item of [...db.playlistItems].sort((a, b) => a.position - b.position)) {
    const title = db.assets.find((a) => a.id === item.assetId)?.title ?? item.assetId;
    byChannel.set(item.channelId, [...(byChannel.get(item.channelId) ?? []), title]);
  }
  for (const [channelId, titles] of byChannel) {
    unmapped("playlistItems", channelId, `${titles.length} queued items have no air times; old order: ${titles.join(", ")}`);
  }

  for (const state of db.playoutStates) {
    if (!stationIds.has(state.channelId)) continue;
    await insert(
      "broadcast.playout_state",
      `INSERT INTO broadcast.playout_state (station_id, on_air, last_error, updated_at) VALUES ($1, false, $2, $3) ON CONFLICT DO NOTHING`,
      [state.channelId, state.lastError ?? null, state.updatedAt]
    );
    if (state.isRunning) note("playoutStates", state.channelId, "was running; arrives off air until it signs on");
  }

  for (const schedule of db.streamSchedules) {
    if (!stationIds.has(schedule.channelId)) {
      unmapped("streamSchedules", schedule.id, `station ${schedule.channelId} wasn't migrated`);
      continue;
    }
    await insert(
      "broadcast.schedules",
      `INSERT INTO broadcast.schedules (id, station_id, start_at, end_at, enabled, started_at, ended_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [
        schedule.id,
        schedule.channelId,
        schedule.startAt,
        schedule.endAt ?? null,
        schedule.enabled,
        schedule.startedAt ?? null,
        schedule.endedAt ?? null,
        schedule.createdAt
      ]
    );
  }

  for (const destination of db.destinations) {
    if (!stationIds.has(destination.channelId)) {
      unmapped("destinations", destination.id, `station ${destination.channelId} wasn't migrated`);
      continue;
    }
    await insert(
      "broadcast.translators",
      `INSERT INTO broadcast.translators (id, station_id, service, name, rtmp_url, stream_key, enabled, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [
        destination.id,
        destination.channelId,
        translatorService(destination),
        destination.name,
        destination.rtmpUrl,
        destination.streamKey,
        destination.enabled,
        destination.createdAt
      ]
    );
  }

  for (const config of db.livepeerConfigs) {
    if (!stationIds.has(config.channelId)) {
      unmapped("livepeerConfigs", config.channelId, "station wasn't migrated");
      continue;
    }
    await insert(
      "broadcast.livepeer_config",
      `INSERT INTO broadcast.livepeer_config (station_id, enabled, stream_id, stream_key, playback_id, playback_url, ingest_url, last_error, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
      [
        config.channelId,
        config.enabled,
        config.streamId ?? null,
        config.streamKey ?? null,
        config.playbackId ?? null,
        config.playbackUrl ?? null,
        config.ingestUrl ?? null,
        config.lastError ?? null,
        config.updatedAt
      ]
    );
  }

  for (const job of db.externalIngestJobs) {
    if (!stationIds.has(job.channelId)) {
      unmapped("externalIngestJobs", job.id, `station ${job.channelId} wasn't migrated`);
      continue;
    }
    await insert(
      "broadcast.import_jobs",
      `INSERT INTO broadcast.import_jobs (id, station_id, requested_urls, expand_playlists, status, items, error, created_at, finished_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
      [
        job.id,
        job.channelId,
        JSON.stringify(job.requestedUrls),
        job.expandPlaylists,
        job.status,
        JSON.stringify(job.items),
        job.error ?? null,
        job.createdAt,
        job.finishedAt ?? null
      ]
    );
  }

  if (db.commands.length > 0) {
    note("commands", "-", `${db.commands.length} pending playout commands dropped (they only mean something to the old worker)`);
  }

  return report;
}

function stationColour(channel: Channel): string | null {
  const colour = channel.brandColor?.trim();
  return colour && isValidStationColour(colour) ? colour.toUpperCase() : null;
}

function breakRule(channel: Channel): { mode: string; everyMinutes: number | null; note?: string } {
  if (channel.adTriggerMode === "disabled") {
    return { mode: "none", everyMinutes: null };
  }
  if (channel.adTriggerMode === "time_interval") {
    const minutes = Math.max(1, Math.round(channel.adTimeIntervalSec / 60));
    return {
      mode: "every_n_minutes",
      everyMinutes: minutes,
      note: channel.adTimeIntervalSec % 60 ? `ad interval ${channel.adTimeIntervalSec}s rounded to ${minutes} min` : undefined
    };
  }
  return {
    mode: "after_every_program",
    everyMinutes: null,
    note: channel.adInterval > 1 ? `was "an ad after every ${channel.adInterval} programs"; now a break after every program` : undefined
  };
}

function storageOf(asset: Asset): "local" | "r2" | "ipfs" {
  if (asset.storageProvider === "r2") return "r2";
  if (asset.storageProvider === "ipfs" && /^https?:/.test(asset.localPath)) return "ipfs";
  return /^https?:/.test(asset.localPath) ? "r2" : "local";
}

function translatorService(destination: MultistreamDestination): "youtube" | "twitch" | "rtmp" {
  const url = destination.rtmpUrl.toLowerCase();
  if (url.includes("youtube.com")) return "youtube";
  if (url.includes("twitch.tv")) return "twitch";
  return "rtmp";
}

function depth(db: DatabaseSchema, folderId: string, seen = new Set<string>()): number {
  const folder = db.assetFolders.find((f) => f.id === folderId);
  if (!folder?.parentFolderId || seen.has(folderId)) return 0;
  seen.add(folderId);
  return 1 + depth(db, folder.parentFolderId, seen);
}
