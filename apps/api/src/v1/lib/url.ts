// A117: a path the API serves itself (`/hls/…`, `/objects/…`) as a full URL on the API's public
// origin, so an app on another host loads it from the API. Full URLs pass through unchanged.

import type { Deps } from "../context.js";

export function publicUrl(deps: Pick<Deps, "config">, url: string): string;
export function publicUrl(deps: Pick<Deps, "config">, url: string | null): string | null;
export function publicUrl(deps: Pick<Deps, "config">, url: string | null): string | null {
  if (!url || !url.startsWith("/") || url.startsWith("//")) return url;
  // The worker serves stations' own HLS; on Railway that's its own domain.
  const base = (url.startsWith("/hls/") ? deps.config.hlsBase : null) ?? deps.config.publicBase;
  return base ? `${base.replace(/\/+$/, "")}${url}` : url;
}
