// Every colour the mock draws white text on holds 4.5:1 against white (rules.md, station colours):
// the stations, the market's other stations and makers, the programs' title cards, the businesses'
// cards, and the swatches both colour pickers offer. The pickers' own rule is tested in
// components/station/rules.test.ts; e2e/tests/control.contrast.spec.ts checks it in the page.

import { describe, expect, it } from "vitest";
import { contrastRatio, stationColourPasses } from "@opencast/ui";
import { SWATCHES as SETUP_SWATCHES } from "../../components/onair/StationForm";
import { SWATCHES as SETTINGS_SWATCHES } from "../../components/station/ColourPicker";
import { MARKET_STATIONS, seedOffers } from "./market";
import { PREVIEW_CARDS } from "./onair";
import { seedSpots } from "./spots";
import { STATIONS } from "./stations";

const WHITE = "#FFFFFF";

function holds(label: string, colours: [string, string | null][]) {
  describe(label, () => {
    it.each(colours.filter((c): c is [string, string] => !!c[1]))("%s (%s) holds 4.5:1 against white", (_name, hex) => {
      expect(contrastRatio(hex, WHITE)).toBeGreaterThanOrEqual(4.5);
      expect(stationColourPasses(hex)).toBe(true);
    });
  });
}

holds("master control's stations", STATIONS.map((s) => [s.callSign ?? s.name, s.colour]));
holds("the market's other stations and makers", MARKET_STATIONS.map((s) => [s.callSign ?? s.name, s.colour]));
holds("programs' title cards in the market", seedOffers().map((o) => [o.program.title, o.program.colour ?? null]));
holds("businesses' cards", seedSpots().businesses.map((b) => [b.name, b.colour]));
holds("spot cards on the preview monitor", Object.entries(PREVIEW_CARDS).map(([name, c]) => [name, c.colour]));
holds("the setup picker's swatches (A.1)", SETUP_SWATCHES.map((c) => [c, c]));
holds("the settings picker's swatches (station-settings 01.1)", SETTINGS_SWATCHES.map((c) => [c, c]));

describe("the colour rule", () => {
  it("draws the line at 4.5:1", () => {
    // #767676 is the palest grey that holds 4.5:1 on white; #777777 is just under.
    expect(contrastRatio("#767676", WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(stationColourPasses("#767676")).toBe(true);
    expect(contrastRatio("#777777", WHITE)).toBeLessThan(4.5);
    expect(stationColourPasses("#777777")).toBe(false);
  });
});
