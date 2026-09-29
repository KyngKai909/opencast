// The categories a business can pick (S17: the contracts keep `Business.category` free text, and
// stations block categories by name, so both sides need one list). Until the API has it, this is
// the list, with the frames' "Coffee and food" first.

export const CATEGORIES = [
  "Coffee and food",
  "Restaurants",
  "Shops",
  "Health",
  "Beauty and fitness",
  "Home services",
  "Auto",
  "Professional services",
  "Arts and events",
  "Education",
  "Nonprofits",
  "Alcohol",
  "Gambling"
] as const;

/** The category as it runs into a sentence: "Every station can carry coffee and food". */
export function categoryInSentence(category: string): string {
  return category.charAt(0).toLowerCase() + category.slice(1);
}
