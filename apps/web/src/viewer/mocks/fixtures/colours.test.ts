// Every station colour the viewer draws white text on holds 4.5:1 against white (rules.md, station
// colours): the stations on the dials, the carriers outside the market, and the colour the app falls
// back to when a station has none. The viewer never picks a colour (the API checks each one when a
// station sets it: contracts' Colour); its only rule is that fallback, "#33507A".

import { describe, expect, it } from "vitest";
import { contrastRatio, stationColourPasses } from "@opencast/ui";
import { PROGRAM_EXTRA } from "./station";
import { STATIONS } from "./stations";

const WHITE = "#FFFFFF";

function holds(label: string, colours: Array<[string, string | null | undefined]>) {
  describe(label, () => {
    const list = colours.filter((c): c is [string, string] => !!c[1]);
    it("has colours to check", () => expect(list.length).toBeGreaterThan(0));
    it.each(list)("%s (%s) holds 4.5:1 against white", (_name, hex) => {
      expect(contrastRatio(hex, WHITE)).toBeGreaterThanOrEqual(4.5);
      expect(stationColourPasses(hex)).toBe(true);
    });
  });
}

holds("the stations on the dials", STATIONS.map((s) => [s.ident.callSign ?? s.ident.name, s.ident.colour]));
holds(
  "carriers outside the market",
  Object.values(PROGRAM_EXTRA).flatMap((p) => (p.carriers?.outside ?? []).map((c): [string, string] => [c.callSign, c.colour]))
);

// Every colour written in the app's source next to a station's colour: a fixture's `colour: "#…"`
// (the permission page's station among them) and the fallback `colour ?? "#…"`.
const sources = import.meta.glob(["../../**/*.{ts,tsx}", "!../../**/*.test.{ts,tsx}"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const written = Object.entries(sources).flatMap(([file, text]) =>
  [...text.matchAll(/colour\s*(?::|\?\?)\s*"(#[0-9a-fA-F]{6})"/g)].map((m): [string, string] => [`${file.replace("../../", "")}: ${m[0]}`, m[1]!])
);
holds("colours written in the source", written);

describe("the fallback", () => {
  it("is the same colour everywhere a station has none", () => {
    const fallbacks = new Set(written.filter(([where]) => where.includes("??")).map(([, hex]) => hex.toUpperCase()));
    expect([...fallbacks]).toEqual(["#33507A"]);
  });
});

describe("the colour rule", () => {
  it("draws the line at 4.5:1", () => {
    // #767676 is the palest grey that holds 4.5:1 on white; #777777 is just under.
    expect(stationColourPasses("#767676")).toBe(true);
    expect(stationColourPasses("#777777")).toBe(false);
  });
});
