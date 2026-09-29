// P10 (interim): an address or a city to coordinates, until the API geocodes. `LocationInput`
// needs latitude and longitude, and the profile takes a typed address ("204 Orange St, Redlands,
// CA 92373") or a city and a radius. The cities of the Inland Empire market, at their centres.

const CITIES: Record<string, [number, number]> = {
  redlands: [34.0556, -117.1825],
  colton: [34.0739, -117.3136],
  "loma linda": [34.0483, -117.2611],
  "san bernardino": [34.1083, -117.2898],
  riverside: [33.9533, -117.3962],
  fontana: [34.0922, -117.435],
  rialto: [34.1064, -117.3703],
  ontario: [34.0633, -117.6509],
  "rancho cucamonga": [34.1064, -117.5931],
  upland: [34.0975, -117.6484],
  highland: [34.1283, -117.2086],
  yucaipa: [34.0336, -117.0431],
  "moreno valley": [33.9425, -117.2297],
  corona: [33.8753, -117.5664],
  chino: [34.0122, -117.6889],
  "grand terrace": [34.0339, -117.3136],
  banning: [33.9256, -116.8764],
  beaumont: [33.9295, -116.9773]
};

export interface Place {
  streetAddress: string | null;
  city: string;
  latitude: number;
  longitude: number;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A city's centre, or null when it isn't one the mock knows. */
export function cityPlace(text: string): Place | null {
  const key = text.trim().toLowerCase().replace(/\s+/g, " ");
  const at = CITIES[key];
  return at ? { streetAddress: null, city: titleCase(key), latitude: at[0], longitude: at[1] } : null;
}

/**
 * "204 Orange St, Redlands, CA 92373" → the street and the city (the state and ZIP are dropped:
 * one market for now). Null when there's no street and city, or the city isn't known.
 */
export function addressPlace(text: string): Place | null {
  const parts = text
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    // "CA 92373", "CA", "92373".
    .filter((p) => !/^([A-Za-z]{2})?\s*\d{5}(-\d{4})?$/.test(p) && !/^[A-Za-z]{2}$/.test(p));
  if (parts.length < 2) return null;
  const city = cityPlace(parts[parts.length - 1]!);
  if (!city) return null;
  return { ...city, streetAddress: parts.slice(0, -1).join(", ") };
}
