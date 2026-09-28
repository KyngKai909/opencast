import type { Group, Specimen } from "../registry";
import { foundation } from "./foundation";
import { primitives } from "./primitives";
import { broadcast } from "./broadcast";
import { data } from "./data";
import { shells } from "./shells";

export const GROUPS: Group[] = ["Foundation", "Primitives", "Broadcast", "Data", "Shells"];
export const ALL: Specimen[] = [...foundation, ...primitives, ...broadcast, ...data, ...shells];

const ids = new Set<string>();
for (const s of ALL) {
  if (ids.has(s.id)) throw new Error(`Two specimens are called ${s.id}`);
  ids.add(s.id);
}

export function byId(id: string): Specimen | undefined {
  return ALL.find((s) => s.id === id);
}
