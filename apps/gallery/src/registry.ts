import type { ReactNode } from "react";

/** Where a component is drawn in docs/reference. */
export interface Source {
  /** Path under docs/reference, e.g. "control/opencast-master-control.html". */
  file: string;
  /** The section's id in that file, e.g. "flow-a". */
  anchor?: string;
  /** Frame ids from docs/apps/inventory.md, e.g. "A.7". */
  frames?: string[];
}

export interface SpecimenState {
  label: string;
  render: () => ReactNode;
  /** A short note under the state: what's special about it. */
  note?: string;
}

export type Group = "Foundation" | "Primitives" | "Broadcast" | "Data" | "Shells";

export interface Specimen {
  /** URL slug, unique: "tally". */
  id: string;
  name: string;
  group: Group;
  from: Source[];
  /** What it is and the rules it keeps, in a sentence or two. */
  notes?: string;
  states: SpecimenState[];
  /** Which grounds to show. Default both; TV specimens use ["tv"]. */
  grounds?: Array<"dark" | "light" | "tv">;
  /** Draw each state at this natural size, scaled down to fit (shells, TV screens, phones). */
  frame?: { width: number; height: number };
  /** Lay the two grounds out one above the other instead of side by side (wide components). */
  stacked?: boolean;
}

export function specimens<T extends Specimen[]>(list: T): T {
  return list;
}
