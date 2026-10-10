// Which tables each module may read and write. Everything else goes through
// another module's service. Checked by test/boundaries.test.ts.

export const MODULE_TABLES: Record<string, string[]> = {
  accounts: ["accounts.*"],
  stations: [
    "broadcast.stations",
    "broadcast.channels",
    "broadcast.break_rules",
    "broadcast.blocked_categories",
    "broadcast.translators",
    "broadcast.live_sources",
    "broadcast.relay_backgrounds",
    "broadcast.host_assignments",
    "broadcast.speakers",
    "broadcast.lower_thirds"
  ],
  library: [
    "broadcast.programs",
    "broadcast.assets",
    "broadcast.asset_files",
    "broadcast.asset_folders",
    "broadcast.asset_break_points",
    "broadcast.rights_confirmations",
    "broadcast.import_jobs",
    "broadcast.contents",
    "broadcast.content_refs",
    "broadcast.content_previews",
    "broadcast.content_preview_needs",
    "broadcast.caption_tracks",
    // Added 2026-10-02 (A244): programming blocks (the block itself; where it airs is the log's).
    "broadcast.program_blocks"
  ],
  log: [
    "broadcast.log_entries",
    "broadcast.repeat_groups",
    "broadcast.breaks",
    "broadcast.dead_air_events",
    // Added 2026-09-29: day templates and off air hours.
    "broadcast.day_template_entries",
    "broadcast.day_template_dates",
    "broadcast.off_air_hours",
    // Added 2026-09-29: edit mode's history.
    "broadcast.log_changes",
    // Added 2026-10-02 (A244): where programming blocks air, on dates and in day templates.
    "broadcast.program_block_spans",
    "broadcast.day_template_blocks"
  ],
  playout: [
    "broadcast.playout_state",
    "broadcast.commands",
    "broadcast.livepeer_config",
    "broadcast.schedules",
    "broadcast.as_run",
    // Added 2026-09-29 (migration 0020): prepare once, then assemble.
    "broadcast.prepared_items",
    "broadcast.prepared_renditions",
    "broadcast.channel_items",
    "broadcast.translator_sessions",
    // Added 2026-09-29 (migration 0021): captions prepared with each item.
    "broadcast.prepared_captions",
    // Added 2026-10-10 (migration 0063, programming Phase 4): break points suggested for a file as it's prepared.
    "broadcast.break_suggestions"
  ],
  catalog: ["catalog.*"],
  spots: ["spots.*"],
  ledger: ["ledger.*"],
  audience: ["audience.*"],
  trust: ["trust.*"],
  notifications: ["notify.*"],
  waitlist: ["network.waitlist_signups", "network.call_sign_reservations", "network.channel_holds"],
  network: [
    // External stations (follow-up Phase 6): written permissions for stream links, outages, and (A215) each listing's changes.
    "network.stream_permissions",
    "network.external_outages",
    "network.listed_source_changes",
    "network.markets",
    "network.zip_markets",
    "network.creators",
    "network.creator_works",
    "network.permission_requests",
    "network.permission_records",
    "network.permission_record_works",
    "network.licence_records",
    "network.recipes",
    "network.listed_sources",
    "network.listed_airings",
    "network.handovers"
  ],
  tv: ["tv.*"],
  // Added 2026-09-29: Network desk Settings (desk roles, the rules registry, signer proposals, the change log).
  settings: ["network.desk_roles", "network.rules", "network.change_log", "network.signer_proposals", "network.signer_approvals"],
  // Added 2026-09-29: the catalog's shelf. (The catalog module's `catalog.*` is the syndication market's.)
  // Added 2026-09-30: storage maintenance runs from desk Settings.
  maintenance: ["network.storage_runs"],
  // Added 2026-09-30 (follow-up Phase 3): relays, set once per station; each platform's Livepeer target; restarts for platform limits.
  relays: ["broadcast.station_relays", "broadcast.relay_targets", "broadcast.relay_restarts"],
  // Added 2026-09-30 (follow-up Phase 3): platform connections for relays, and the viewers they report.
  platforms: [
    "broadcast.platform_connections",
    "broadcast.platform_sign_ins",
    "broadcast.platform_events",
    "broadcast.platform_viewer_samples",
    "broadcast.platform_geography",
    "broadcast.platform_geography_checks"
  ],
  // Added 2026-09-30 (follow-up Phase 4): direct uploads, from their parts to what they made.
  uploads: ["broadcast.uploads"],
  shelf: ["catalog.shelf_series", "catalog.shelf_items", "catalog.shelf_item_checks", "catalog.shelf_item_evidence", "catalog.shelf_episodes", "catalog.shelf_episode_items", "catalog.shelf_rebuilds"]
};
