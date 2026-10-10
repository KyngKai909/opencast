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

They're shown apart (`AudienceReport.otherApps`, `AnalyticsOverview.otherApps`) and never counted toward the pool or the tuned-in totals. The address is never kept: only a hash of it with the day, cleared a day later.

Per-thousand spots count them where they can be attributed (the user's decision, P5.1 in `docs/open-decisions.md`): a session is billed for a spot when its polls ran from the spot's start (or before) to its end (or after), it counts (a minute of polls), and its polls average at least one every 30 seconds; one per connection. Online businesses pay for every such session; local businesses only for those placed in a market inside the spot's area (a session Opencast couldn't place isn't billed to them). It's the airing's "Other apps" part (`spots/otherAppViewers.ts`, `spots.other_app_charges`): held as the spot airs and settled two minutes after it, once the polls after the spot are in, and shown as its own line on the business's results and statements.

## A program not cleared for other apps (programming Phase 6)

Other apps are an outlet of their own (`other_apps`): a program airs there only when its rights, the carriage agreement it's carried under, and any network licence covering it allow it, for the viewer's country (`@opencast/domain`'s `clearance`). One that isn't (a carried program its maker cleared for Opencast only; a licensed one outside its territories) still airs on Opencast's own apps as planned. In other apps:

- **The stream** shows the station's "Airing on Opencast, channel 12.1" slate (the call sign above it, in the station's colour; silence on the radio band) for the program's whole length, the same picture a relay shows. A media playlist asked for with `?via=iptv` is a variant of the plain one: each of the program's segments is replaced by a prepared slate segment of the same length (1 to 4 seconds), at the same media sequence number, with the program's own tags left out and its captions empty. The slate's segments come from `/hls/elsewhere/<slate>/<rendition>/<n>-<ms>.ts` (the API's and the worker's), the prepared segment with its timestamps moved on to its place in the program, so the slate plays as one continuous stretch: the discontinuities and sequences are the plain playlist's. Its breaks are untouched, so spots, station IDs and bumpers in them air as usual.
- **The guide** lists that slot as "Airing on Opencast", described "On Opencast only. Watch it on BEAT, channel 12.1, in the Opencast app.", with nothing of the program's own (title, episode, rating).
- **Where the viewer is.** A licence for some countries clears other apps only for viewers there. The country comes from the same lookup that places a viewer in a market (`GEOIP_URL`, when it answers with a country), remembered in memory for ten minutes per address, never stored. When it can't be told (no lookup configured, a private address, an answer without one), only a worldwide licence clears it, as on a relay. The playlists and the guide are each built per country.
- **Prepared ahead.** The slates are prepared once per station look (stills of 1 to 4 seconds), queued by the engine when a station's log has a program not cleared for other apps: at the hourly readiness check, two days ahead, and every five minutes for the next two hours. If one isn't ready when the program airs, the generated station ID stands in; with neither, the playlist holds before the program until one is (it never shows the program). Either is logged.
- **The licensor's minutes** have an "other_apps" line: the airing's time while at least one session in another app was tuned in, for airings cleared for other apps (with no country, or in one of the licence's countries), and those sessions' hours as viewer hours.

Opencast's own players never ask with `?via=iptv`, so their playlists are the plain ones.

## Known limit: what other apps don't show

The bug, lower thirds, and a spot's code and QR are drawn by Opencast's own player from `DATERANGE` tags in the playlist. Other apps play the stream and ignore those tags, so they don't show them. Station IDs and spots still air: they're in the picture. Nothing is burned in to make up for it.

Captions are in the stream (the subtitle rendition), so apps that read HLS subtitles show them.

## The apps

- **TiviMate**: Add playlist, then enter the channel list's address. It reads the guide's address from the list; if it doesn't, add the guide under EPG.
- **Jellyfin**: Dashboard, Live TV: add a tuner device of type M3U with the channel list, and a TV guide data provider of type XMLTV with the guide.
- **Channels DVR**: Settings, Sources, Add Source, Custom Channels: the channel list as M3U, and the guide as XMLTV guide data.
- **Kodi**: install the PVR IPTV Simple Client add-on; in its settings, the M3U playlist URL is the channel list and the XMLTV URL is the guide.
- **VLC**: Media, Open Network Stream, with the channel list. VLC plays the channels from its playlist; it doesn't show a guide.
- **Plex**: Plex has no M3U support of its own. Run Threadfin (xTeVe's maintained successor) on the same network as the Plex server, give it the channel list and the guide, then add it in Plex under Settings, Live TV & DVR, Set Up Plex DVR (if it isn't found, enter Threadfin's address, `<its IP>:34400`). Live TV & DVR needs Plex Pass. See below.

## Plex (programming Phase 7, checked 2026-10-10)

**Can Plex add Opencast as a tuner at a public HTTPS address?** Not as anything Plex supports. Plex's Live TV & DVR finds tuners on its own network (HDHomeRun discovery over UDP 65001, and SSDP), and its "enter the address" field is documented, everywhere we looked, as a bare `IP:port` over HTTP. The Plex Media Server is what connects to the tuner, so "local" means reachable from the server; a tuner on another subnet works once firewalls allow it. Plex's own API adds a tuner from a full URL (`POST /media/grabbers/devices?uri=http://ip:port`), so an `https://` address might be accepted, but nothing shows it working, and the server would then pull every stream and recording from us over the internet. So we don't build an HDHomeRun address (`discover.json`, `lineup.json`, `lineup_status.json`) for Plex now.

**What Plex users do instead:** Threadfin (or xTeVe) on their own network, pointed at the channel list and the guide, added in Plex as a network tuner. Plex allows one guide per DVR, so our guide is the one Plex shows for those channels. Live TV & DVR has needed Plex Pass since it launched (2017), and Plex's page still says so.

**Recording, for Kai.** Plex records from such a tuner as from an HDHomeRun: one-offs and series, saved on the viewer's server. So the Threadfin route already lets viewers record our stream; a tuner of our own would make it a feature we offer. If one is built later, it carries only stations whose programs are all cleared for `recording` (programming Phase 6), or swaps the rest to the slate, as relays do.

**Sources.** Plex's own support site and forums couldn't be opened from where this was checked; their lines below come from search results, not the pages read whole.
- Plex support, "Live TV & DVR" (support.plex.tv/articles/225877347-live-tv-dvr/, current page): a premium feature that needs Plex Pass; the tuner is "connected to your Plex Media Server"; a link to manually specify the device's location.
- Plex forums, "HDHomeRun Emulator" (forums.plex.tv/t/hdhomerun-emulator/156498, about 2017): emulators had to be discoverable like the hardware; manual entry came later.
- Plex forums, "Unable to add tuner" (/t/883704, about 2024) and "Plex Can't Find HDHomeRun" (/t/904981, about 2025): "problem adding the device: 192.168.x.x"; the tuner must be on the server's network, or reachable through the firewall.
- Plex forums, "Tuner setup loads forever" (/t/933610, 2025 to 2026): a Threadfin tuner added only through `POST /media/grabbers/devices` with `uri=http://ip:port`.
- Telly wiki, "Adding Telly to Plex" (github.com/tellytv/telly/wiki): enter `TELLY_IP:TELLY_PORT`.
- hdhriptv 1.1.1 (pkg.go.dev/github.com/arodd/hdhriptv, August 2026): found by Plex over UDP 65001, "also supports manual IP entry".
- ErsatzTV Legacy's HDHomeRun page (a mirror of its docs): Network Tuner, with the address `ersatztv.local:8409`.
- A Threadfin hosting guide (Bytesized Hosting): even behind a public HTTPS proxy, Plex is given Threadfin's internal address.
