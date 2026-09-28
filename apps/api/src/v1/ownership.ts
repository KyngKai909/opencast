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
    "broadcast.host_assignments",
    "broadcast.speakers"
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
    "broadcast.content_preview_needs"
  ],
  log: ["broadcast.log_entries", "broadcast.repeat_groups", "broadcast.breaks", "broadcast.dead_air_events"],
  playout: ["broadcast.playout_state", "broadcast.commands", "broadcast.livepeer_config", "broadcast.schedules", "broadcast.as_run"],
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
  ]
};
