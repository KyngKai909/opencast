// You: Watch in other apps (programming Phase 5). Opencast's channel list (M3U) and guide (XMLTV),
// as two addresses with a copy button each, and a line for each app on where they go: TiviMate,
// Jellyfin, Channels DVR, Kodi (PVR IPTV Simple) and VLC. Plex has no M3U support of its own, and
// it says so. What those apps don't show (the bug, lower thirds, a spot's code and QR) is in docs/iptv.md.

import { Button, useToast } from "@opencast/ui";
import { config } from "../../../config";
import "./OtherAppsSection.css";

type Form = "web" | "phone";

/** The two addresses, from the API's origin (this page's own when the API shares it). */
export function iptvUrls(apiBase: string, origin: string): { channels: string; guide: string } {
  const base = (apiBase || origin).replace(/\/+$/, "");
  return { channels: `${base}/v1/iptv/channels.m3u`, guide: `${base}/v1/iptv/xmltv.xml` };
}

/** One line each: where the channel list and the guide go in each app. */
export const OTHER_APPS: Array<{ app: string; line: string }> = [
  { app: "TiviMate", line: "Add playlist, then enter the channel list’s address. It finds the guide on its own; if not, add the guide under EPG." },
  { app: "Jellyfin", line: "Live TV: add an M3U tuner with the channel list, and an XMLTV guide provider with the guide." },
  { app: "Channels DVR", line: "Add a source, Custom Channels: the channel list as M3U, the guide as XMLTV." },
  { app: "Kodi", line: "Install the PVR IPTV Simple Client add-on, then give it the channel list (M3U) and the guide (XMLTV)." },
  { app: "VLC", line: "Open Network Stream with the channel list. VLC plays the channels; it doesn’t show a guide." }
];

export function OtherAppsSection({ form, apiBase = config.apiBase, origin = typeof window === "undefined" ? "" : window.location.origin }: { form: Form; apiBase?: string; origin?: string }) {
  const toast = useToast();
  const urls = iptvUrls(apiBase, origin);
  const copy = async (url: string, what: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.show({ message: `${what} copied.` });
    } catch {
      // No clipboard here: the address is on screen to select.
    }
  };

  const body = (
    <>
      <p className="vw-y-quiet vw-oa__lede">Opencast&rsquo;s stations in an IPTV app: paste the channel list, then the guide.</p>
      <dl className="vw-oa">
        {(
          [
            ["Channel list", "M3U", urls.channels],
            ["Guide", "XMLTV", urls.guide]
          ] as const
        ).map(([label, kind, url]) => (
          <div key={label} className="vw-oa__row">
            <dt>
              {label} <span>{kind}</span>
            </dt>
            <dd className="vw-oa__url">{url}</dd>
            <dd className="vw-oa__act">
              <Button size="sm" aria-label={`Copy the ${label.toLowerCase()} address`} onClick={() => void copy(url, label)}>
                Copy
              </Button>
            </dd>
          </div>
        ))}
      </dl>
      <ul className="vw-oa__apps">
        {OTHER_APPS.map((a) => (
          <li key={a.app}>
            <b>{a.app}</b> {a.line}
          </li>
        ))}
        <li>
          <b>Plex</b> Plex has no M3U support of its own, so these addresses don&rsquo;t go into Plex.
        </li>
      </ul>
      <p className="vw-y-quiet">Other apps show the programs, station IDs and spots, but not the bug, lower thirds, or a spot&rsquo;s code and QR.</p>
    </>
  );

  if (form === "phone")
    return (
      <>
        <h2 className="vw-y-psec">Watch in other apps</h2>
        <div className="vw-you-p__list vw-oa--phone">{body}</div>
      </>
    );
  return (
    <section className="vw-y-sec" aria-labelledby="vw-you-oa">
      <div className="vw-y-sec-top">
        <h2 id="vw-you-oa">Watch in other apps</h2>
        <span className="vw-y-sec-top__sub">TiviMate, Jellyfin, Channels DVR, Kodi, VLC</span>
      </div>
      {body}
    </section>
  );
}
