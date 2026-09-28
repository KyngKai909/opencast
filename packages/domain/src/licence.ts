// Licences under which a creator's published work can be carried on a
// claimable station without a permission record.

export const LICENCES = [
  "cc0",
  "cc_by",
  "cc_by_sa",
  "cc_by_nd",
  "cc_by_nc",
  "cc_by_nc_sa",
  "cc_by_nc_nd",
  "other"
] as const;

export type Licence = (typeof LICENCES)[number];

/**
 * A licence record only counts when the licence allows commercial use and
 * derivatives: CC BY and CC BY-SA do; any non-commercial or no-derivatives
 * variant doesn't. CC0 waives everything. Anything else needs a permission
 * record instead.
 */
export function licenceAllowsCarriage(licence: Licence): boolean {
  return licence === "cc0" || licence === "cc_by" || licence === "cc_by_sa";
}

/** Licences whose attribution must appear in the program's listing and credit. */
export function licenceRequiresAttribution(licence: Licence): boolean {
  return licence !== "cc0";
}
