// Addresses and cities to coordinates, for a business's locations (P10). Pluggable like the GEOIP
// lookup: PLACES_URL is a URL with `{q}` in it (a geocoding service), answering JSON in one of the
// common shapes: Nominatim's (`[{ lat, lon, address: { house_number, road, city } }]`), Mapbox's
// (`{ features: [{ center: [lng, lat], ... }] }`), Google's (`{ results: [{ geometry: { location } }] }`)
// or a plain `{ latitude, longitude, city, streetAddress }`. What's typed is sent to that service
// and forgotten: never stored, never logged. With nothing configured there's no lookup.

export interface FoundPlace {
  /** Null when what was found is a city, not a street address. */
  streetAddress: string | null;
  city: string;
  latitude: number;
  longitude: number;
}

export interface PlaceLookup {
  readonly configured: boolean;
  lookup(q: string): Promise<FoundPlace | null>;
}

export const noPlaceLookup: PlaceLookup = { configured: false, lookup: async () => null };

export function placeLookupFromUrl(template: string, options: { timeoutMs?: number; userAgent?: string } = {}): PlaceLookup {
  return {
    configured: true,
    async lookup(q) {
      try {
        const response = await fetch(template.replace("{q}", encodeURIComponent(q)), {
          signal: AbortSignal.timeout(options.timeoutMs ?? 3_000),
          // Nominatim's usage policy asks for an identifying user agent.
          headers: { accept: "application/json", "user-agent": options.userAgent ?? "Opencast place lookup" }
        });
        if (!response.ok) return null;
        return parsePlace(await response.json());
      } catch {
        return null;
      }
    }
  };
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0);

/** Reads a lookup's answer: the first match, in any of the shapes above. */
export function parsePlace(body: unknown): FoundPlace | null {
  // Nominatim: an array of places.
  if (Array.isArray(body)) {
    const first = body[0] as Record<string, unknown> | undefined;
    if (!first) return null;
    const lat = num(first.lat);
    const lng = num(first.lon);
    if (!valid(lat, lng)) return null;
    const address = (first.address ?? {}) as Record<string, unknown>;
    const city = str(address.city) ?? str(address.town) ?? str(address.village) ?? str(address.hamlet) ?? str(address.municipality) ?? str(address.county) ?? str(first.name);
    if (!city) return null;
    const road = str(address.road);
    const street = road ? [str(address.house_number), road].filter(Boolean).join(" ") : null;
    return { streetAddress: street, city, latitude: lat, longitude: lng };
  }
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  // Mapbox: features with [lng, lat] and a context of place, region…
  if (Array.isArray(b.features)) {
    const f = b.features[0] as Record<string, unknown> | undefined;
    const center = f?.center as unknown[] | undefined;
    if (!f || !center) return null;
    const lng = num(center[0]);
    const lat = num(center[1]);
    if (!valid(lat, lng)) return null;
    const types = (f.place_type as string[] | undefined) ?? [];
    const context = (f.context as Array<Record<string, unknown>> | undefined) ?? [];
    const place = context.find((c) => String(c.id ?? "").startsWith("place."));
    const isAddress = types.includes("address");
    const city = isAddress ? str(place?.text) : (str(f.text) ?? str(place?.text));
    if (!city) return null;
    return { streetAddress: isAddress ? [str(f.address), str(f.text)].filter(Boolean).join(" ") || null : null, city, latitude: lat, longitude: lng };
  }
  // Google: results with geometry.location and address components.
  if (Array.isArray(b.results)) {
    const r = b.results[0] as Record<string, unknown> | undefined;
    const location = ((r?.geometry as Record<string, unknown> | undefined)?.location ?? {}) as Record<string, unknown>;
    const lat = num(location.lat);
    const lng = num(location.lng);
    if (!r || !valid(lat, lng)) return null;
    const parts = (r.address_components as Array<{ long_name: string; types: string[] }> | undefined) ?? [];
    const part = (type: string) => parts.find((p) => p.types.includes(type))?.long_name ?? null;
    const city = part("locality") ?? part("postal_town") ?? part("sublocality") ?? part("administrative_area_level_2");
    if (!city) return null;
    const route = part("route");
    return { streetAddress: route ? [part("street_number"), route].filter(Boolean).join(" ") : null, city, latitude: lat, longitude: lng };
  }
  // A plain answer.
  const lat = num(b.latitude ?? b.lat);
  const lng = num(b.longitude ?? b.lng ?? b.lon);
  const city = str(b.city);
  if (!valid(lat, lng) || !city) return null;
  return { streetAddress: str(b.streetAddress ?? b.street_address ?? b.street), city, latitude: lat, longitude: lng };
}

export function placesFromEnv(env: NodeJS.ProcessEnv): PlaceLookup {
  const url = env.PLACES_URL?.trim();
  if (!url) return noPlaceLookup;
  if (!url.includes("{q}")) {
    console.warn("[v1] PLACES_URL has no {q} in it: looking up addresses is off.");
    return noPlaceLookup;
  }
  return placeLookupFromUrl(url, { userAgent: env.PLACES_USER_AGENT?.trim() || undefined });
}
