// A business's logo square (the shell's switcher, "OSC"): the P11 logo mark when the API gives
// one, otherwise the first letters of its name on a neutral colour.

import type { Business } from "@opencast/contracts";

export function logoOf(b: Pick<Business, "name" | "logoMark"> | undefined, fallbackName: string): { initials: string; colour: string } {
  if (b?.logoMark) return b.logoMark;
  const name = b?.name ?? fallbackName;
  return {
    initials: name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((w) => w[0]!.toUpperCase())
      .join(""),
    colour: "#525C73"
  };
}
