// Playlists rewritten so a player on HTTPS can follow them (A237; A238's "all" mode).
//
// HLS: every URI, on its own line or in a `URI="…"` attribute (EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA,
// EXT-X-I-FRAME-STREAM-INF, EXT-X-SESSION-KEY, EXT-X-PART, EXT-X-PRELOAD-HINT,
// EXT-X-RENDITION-REPORT, EXT-X-SESSION-DATA, and a DATERANGE's X-ASSET-URI) is resolved against
// the playlist's own address. `http://` becomes a signed relay address (the relay signs another
// http origin a playlist lists itself: it's following the listed source's own playlist); `https://`
// stays direct, straight from the source, to save the relay's requests (that server's own CORS still
// applies); anything else (`skd://`, `data:`) is left as it is. Query strings are kept.
// A238, "all" mode (/v2/): `https://` is relayed too, for a server browsers can't load from (no CORS
// header), so nothing the player loads comes straight from the source.
//
// DASH: the manifest is served on the relay's path form (`/v1/<sig>/<b64url(origin)>/<path>`), so its
// relative addresses (BaseURL, SegmentTemplate's `media` and `initialization`, SegmentURL, …) resolve
// against the relay as they would against the source, templates (`$Number$`) and all. Only absolute
// and root-relative ones are rewritten: `http://` (and `//host` on an http manifest) onto the relay's
// path form for that origin, `/path` onto the manifest's own origin, and `https://` left direct (in
// "all" mode, `https://` and `//host` on an https manifest go onto the relay's path form as well).

export type ToRelay = (url: URL) => Promise<string>;
export type RelayPrefix = (origin: string) => Promise<string>;

/** One HLS URI, mapped. `relayHttps` (A238's "all" mode): https addresses are relayed too. */
async function hlsUri(raw: string, base: URL, toRelay: ToRelay, relayHttps: boolean): Promise<string> {
  const value = raw.trim();
  if (!value) return raw;
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return raw;
  }
  url.hash = "";
  if (url.protocol === "http:") return toRelay(url);
  if (url.protocol === "https:") return relayHttps ? toRelay(url) : url.href;
  return raw;
}

/** An HLS playlist (master or media) with every URI made absolute and `http://` ones relayed (`https://` too with `relayHttps`). */
export async function rewriteHls(text: string, base: URL, toRelay: ToRelay, relayHttps = false): Promise<string> {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
    } else if (trimmed.startsWith("#")) {
      if (!trimmed.startsWith("#EXT") || !/URI="/.test(trimmed)) {
        out.push(line);
        continue;
      }
      let rewritten = "";
      let last = 0;
      for (const m of line.matchAll(/URI="([^"]*)"/g)) {
        const at = m.index ?? 0;
        rewritten += line.slice(last, at) + `URI="${await hlsUri(m[1] ?? "", base, toRelay, relayHttps)}"`;
        last = at + m[0].length;
      }
      out.push(rewritten + line.slice(last));
    } else {
      out.push(await hlsUri(trimmed, base, toRelay, relayHttps));
    }
  }
  return out.join("\n");
}

/** One DASH address (an attribute's or an element's text, XML-escaped as found), mapped. */
async function mpdValue(value: string, base: URL, prefix: RelayPrefix, relayHttps: boolean): Promise<string> {
  const v = value.trim();
  const abs = /^(https?:)?\/\/([^/?#]+)(.*)$/i.exec(v);
  if (abs) {
    const scheme = (abs[1] ?? base.protocol).toLowerCase();
    const rest = abs[3] ?? "";
    if (scheme === "https:" && !relayHttps) return abs[1] ? value : `https:${v}`;
    let origin: string;
    try {
      origin = new URL(`${scheme === "https:" ? "https" : "http"}://${abs[2]}`).origin;
    } catch {
      return value;
    }
    return (await prefix(origin)) + (rest.startsWith("/") ? rest : `/${rest}`);
  }
  if (v.startsWith("/")) return (await prefix(base.origin)) + v;
  return value;
}

const MPD_ATTRIBUTES = /\b(media|initialization|index|sourceURL|bitstreamSwitching|xlink:href)=(["'])(.*?)\2/g;
const MPD_ELEMENTS = /(<(BaseURL|Location|PatchLocation)\b[^>]*>)([^<]*)(<\/\2\s*>)/g;

async function replaceAsync(text: string, pattern: RegExp, map: (m: RegExpMatchArray) => Promise<string>): Promise<string> {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    out += text.slice(last, at) + (await map(m));
    last = at + m[0].length;
  }
  return out + text.slice(last);
}

/** A DASH manifest with its absolute and root-relative addresses put on the relay (see above; `https://` too with `relayHttps`). */
export async function rewriteMpd(text: string, base: URL, prefix: RelayPrefix, relayHttps = false): Promise<string> {
  const withElements = await replaceAsync(text, MPD_ELEMENTS, async (m) => `${m[1]}${await mpdValue(m[3] ?? "", base, prefix, relayHttps)}${m[4]}`);
  return replaceAsync(withElements, MPD_ATTRIBUTES, async (m) => `${m[1]}=${m[2]}${await mpdValue(m[3] ?? "", base, prefix, relayHttps)}${m[2]}`);
}
