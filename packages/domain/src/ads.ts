// What an ad request would say about a station, a program and a break, for ads from partners
// (the programmatic backfill, not built yet). IAB Tech Lab's taxonomies are how ad exchanges
// read content and ad categories: Opencast's own categories map onto them here, so every
// station and program has IAB content categories, and a station's blocked spot categories
// become IAB ad product categories to block on each request.
//
// Ids are from IAB Tech Lab's published TSVs (github.com/InteractiveAdvertisingBureau/Taxonomies):
// "Content Taxonomy 3.0" and "Ad Product Taxonomy 2.0".

/** IAB Content Taxonomy 3.0 ids for Opencast's station and program categories. */
export const IAB_CONTENT_BY_CATEGORY: Readonly<Record<string, readonly string[]>> = {
  Music: ["338"], // Entertainment > Music
  Talk: ["A0AH3G", "371"], // Genres > Talk Show, Genres > Talk Radio
  "Public affairs": ["386", "8YPBBL"], // Politics, Politics > Civic affairs
  Food: ["210"], // Food & Drink
  Classic: ["324", "640"], // Entertainment > Movies, Entertainment > Television (classic films and series)
  Sports: ["483"], // Sports
  Kids: ["645"], // Genres > Family/Children
  Comedy: ["646"], // Genres > Comedy
  Documentary: ["332"], // Genres > Documentary
  History: ["EZWB7V"], // Genres > History
  Nature: ["VKIV56"], // Genres > Nature
  Arts: ["201"], // Fine Art
  Faith: ["453"], // Religion & Spirituality
  Education: ["132"], // Education
  Science: ["464"], // Science
  Movies: ["324"], // Entertainment > Movies
  Television: ["640"] // Entertainment > Television
};

/** When a station or program has no category Opencast can map: Entertainment. */
export const IAB_CONTENT_FALLBACK: readonly string[] = ["JLBCU7"];

/** IAB Ad Product Taxonomy 2.0 ids for spot (business) categories, including the ones stations block. */
export const IAB_AD_PRODUCT_BY_CATEGORY: Readonly<Record<string, readonly string[]>> = {
  Alcohol: ["1002"], // Alcohol
  Gambling: ["1361"], // Gambling
  Cannabis: ["1049"], // Cannabis
  Political: ["1474"], // Politics
  "Payday loans": ["1349"], // Finance and Insurance > Payday and Emergency Loans
  Vaping: ["1548", "1549", "1550"], // Tobacco > Vaping, Vaping Cartridges, Vaporizors
  Tobacco: ["1544"], // Tobacco
  Dating: ["1259"], // Dating
  Adult: ["1001"], // Adult Products and Services
  Weapons: ["1576"], // Weapons and Ammunition
  "Coffee and food": ["1355", "1133"], // Food and Beverage Services, Coffee and Tea
  Food: ["1355"], // Food and Beverage Services
  Retail: ["1494"], // Retail
  Services: ["1012", "1396"], // Business Services, Home and Garden Services
  Auto: ["1551"], // Vehicles
  Health: ["1378"], // Health and Medical Services
  Underwriting: ["1452"], // Non-Profits
  Nonprofit: ["1452"], // Non-Profits
  "Real estate": ["1482"], // Real Estate
  Legal: ["1416"], // Legal Services
  Religion: ["1487"], // Religion and Spirituality
  Education: ["1295"], // Education and Careers
  Events: ["1315"], // Events and Performances
  Fitness: ["1510"], // Fitness Activities
  Travel: ["1529"], // Travel and Tourism
  Finance: ["1335"] // Finance and Insurance
};

const lookup = (table: Readonly<Record<string, readonly string[]>>, category: string | null | undefined): string[] | null => {
  const wanted = category?.trim().toLowerCase();
  if (!wanted) return null;
  const key = Object.keys(table).find((k) => k.toLowerCase() === wanted);
  return key ? [...table[key]] : null;
};

/** IAB content ids for one of Opencast's station or program categories, or null if it has none. */
export function iabContentFor(category: string | null | undefined): string[] | null {
  return lookup(IAB_CONTENT_BY_CATEGORY, category);
}

/**
 * A station's or program's IAB content categories: its own override if it has one; else from its
 * category; else (a program) from its station's category; else Entertainment. Never empty.
 */
export function iabContentCategories(input: { override?: readonly string[] | null; category?: string | null; fallbackCategory?: string | null }): string[] {
  if (input.override && input.override.length) return [...new Set(input.override)];
  return iabContentFor(input.category) ?? iabContentFor(input.fallbackCategory) ?? [...IAB_CONTENT_FALLBACK];
}

/** IAB ad product ids for a spot category, or null if it has none. */
export function iabAdProductsFor(category: string | null | undefined): string[] | null {
  return lookup(IAB_AD_PRODUCT_BY_CATEGORY, category);
}

/** What a station's blocked spot categories block on an ad request: IAB ad product ids, each once. Unknown ones are skipped. */
export function blockedIabAdProducts(blockedCategories: readonly string[]): string[] {
  return [...new Set(blockedCategories.flatMap((c) => iabAdProductsFor(c) ?? []))];
}

/** IAB ids are short letters and digits ("338", "JLBCU7"). */
export const isIabId = (value: string) => /^[A-Za-z0-9]{1,8}$/.test(value);

/** US TV parental guidelines, youngest first. */
export const CONTENT_RATINGS = ["TV-Y", "TV-Y7", "TV-G", "TV-PG", "TV-14", "TV-MA"] as const;
export type ContentRating = (typeof CONTENT_RATINGS)[number];

/** Ratings for programs made for children: a program with one is child-directed unless it says otherwise. */
export const isChildrensRating = (rating: ContentRating | null | undefined) => rating === "TV-Y" || rating === "TV-Y7";
