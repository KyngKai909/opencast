# The dial in other apps

Opencast's stations in IPTV apps (programming Phase 5, 2026-10-10): a public channel list (M3U) and a guide (XMLTV), so TiviMate, Jellyfin, Channels DVR, Kodi and VLC can tune Opencast. Viewers find both addresses in You, "Watch in other apps". Undecided parts are in `docs/open-decisions.md`, "The dial in other apps".

## The two files

**`GET /v1/iptv/channels.m3u`**: every Opencast station on the air: independent, claimable and the catalog station, signed on, playing out, with a number on the dial. External stations are never in it (their permission covers Opencast's own apps only), and nor are waitlist numbers (they're not stations).

- `?market=` (a market's slug, `inland-empire`) and `?band=tv|radio`. An unknown market is a 404; another band a 400.
- The header names the guide: `#EXTM3U url-tvg="…/v1/iptv/xmltv.xml" x-tvg-url="…"` (with the same filters), so TiviMate and others find it on their own.
- Each entry: `tvg-id` (`<station id>.opencast`, stable through call sign changes), `tvg-chno` (the dial number, `12.1`), `tvg-name` (the call sign), `tvg-logo` (the station's logo, when it has one), `group-title` (the market's name), and `radio="true"` on the radio band. Its name is "BEAT · Inland Beat". The stream is the station's `master.m3u8` with `?via=iptv`.
- In market order, TV before radio, then by number.

**`GET /v1/iptv/xmltv.xml`** (and **`/v1/iptv/xmltv.xml.gz`**): the guide, valid against the XMLTV project's `xmltv.dtd`. The same filters.

- Channels: the same ids, with display names (call sign, number, name) and the logo as the icon.
- Programmes: from the log, two hours back to seven days ahead, each with its title, `sub-title` (the episode title), `desc` (the airing's or episode's description, else the program's), `category`, `episode-num` (`xmltv_ns`, zero-based, when the season and episode are known; `onscreen`, "Episode 14", when only the episode is), `<new/>` on a first airing (never aired anywhere before, from the as-run log), and `rating` (the TV rating as `VCHIP`, else the advisory, "Language" or "Mature").
- Live blocks have the category "Live": `xmltv.dtd` has no `<live/>`.
- Breaks fold into the program around them: a break's own log entries (spots, bumpers, station IDs) and gaps of 15 minutes or less join the programme before.
- Planned off air (off air hours, a sign-off on the log) is a programme of its own: "Off air", with "Back at 6:00 am." as its description.

Both are public, read-only and cached: each is built when asked for and kept a minute (there's no "log publish" event to rebuild on; log rows are public as soon as they're written), with an `ETag` from its bytes (`If-None-Match` gets a 304), `Cache-Control: public, max-age=60` and CORS `*`. The guide is gzipped for an app that sends `Accept-Encoding: gzip`, and `.xml.gz` is the gzipped file itself.

## Counting: "Other apps"

A station's playlists asked for with `?via=iptv` count as the audience source "Other apps", by station and market (the market from the connection, as the viewer app places a signed-out viewer). Those apps send no heartbeats, so a session is a run of playlist polls from one connection: two minutes without a poll ends it, and it counts once its polls span a minute. The master asked for with `?via=iptv` names its renditions with it too, since players drop a master's query when they read its relative lines.

They're shown apart (`AudienceReport.otherApps`, `AnalyticsOverview.otherApps`) and never counted toward spot billing, the pool or the tuned-in totals until Kai decides (`docs/open-decisions.md`, P5.1). The address is never kept: only a hash of it with the day, cleared a day later.

## Known limit: what other apps don't show

The bug, lower thirds, and a spot's code and QR are drawn by Opencast's own player from `DATERANGE` tags in the playlist. Other apps play the stream and ignore those tags, so they don't show them. Station IDs and spots still air: they're in the picture. Nothing is burned in to make up for it.

Captions are in the stream (the subtitle rendition), so apps that read HLS subtitles show them.

## The apps

- **TiviMate**: Add playlist, then enter the channel list's address. It reads the guide's address from the list; if it doesn't, add the guide under EPG.
- **Jellyfin**: Dashboard, Live TV: add a tuner device of type M3U with the channel list, and a TV guide data provider of type XMLTV with the guide.
- **Channels DVR**: Settings, Sources, Add Source, Custom Channels: the channel list as M3U, and the guide as XMLTV guide data.
- **Kodi**: install the PVR IPTV Simple Client add-on; in its settings, the M3U playlist URL is the channel list and the XMLTV URL is the guide.
- **VLC**: Media, Open Network Stream, with the channel list. VLC plays the channels from its playlist; it doesn't show a guide.
- **Plex**: Plex has no M3U support of its own. Its Live TV reads channels from a tuner it recognises on the local network, not from an M3U address.

## Plex

See Phase 7.
