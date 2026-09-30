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
    "broadcast.caption_tracks"
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
    "broadcast.log_changes"
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
    "broadcast.prepared_captions"
  ],
  catalog: ["catalog.*"],
  spots: ["spots.*"],
  ledger: ["ledger.*"],
  audience: ["audience.*"],
  trust: ["trust.*"],
  notifications: ["notify.*"],
  waitlist: ["network.waitlist_signups", "network.call_sign_reservations", "network.channel_holds"],
  network: [
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
  tv: ["tv.*"]
};
