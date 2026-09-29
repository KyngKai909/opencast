// Station colours on the desk (rules.md: 4.5:1 against white). Every station in the mock's
// fixtures, and every colour the setup page gives a new claimable station (colourFor), measured
// with WCAG's formula here and by the picker's rule in @opencast/ui (stationColourPasses).
import { describe, expect, it } from "vitest";
import { stationColourPasses } from "@opencast/ui";
import { seedStations } from "../../mocks/fixtures/stations";
import { colourFor } from "./draft";

function luminance(hex: string): number {
  const n = hex.replace("#", "");
  return [0, 2, 4]
    .map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
}
const againstWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

describe("station colours hold 4.5:1 against white", () => {
  const fixtures = seedStations().flatMap((s) => (s.ident.colour ? [[s.ident.callSign ?? s.ident.id, s.ident.colour] as const] : []));

  it("has fixture colours to check", () => {
    expect(fixtures.length).toBeGreaterThan(5);
  });

  it.each(fixtures)("%s %s", (_callSign, colour) => {
    expect(againstWhite(colour)).toBeGreaterThanOrEqual(4.5);
    expect(stationColourPasses(colour)).toBe(true);
  });

  it("every colour the setup page picks", () => {
    const picked = new Set(Array.from({ length: 400 }, (_, i) => colourFor(`creator-${i}`)));
    expect(picked.size).toBeGreaterThanOrEqual(8);
    for (const c of picked) {
      expect(againstWhite(c), c).toBeGreaterThanOrEqual(4.5);
      expect(stationColourPasses(c), c).toBe(true);
    }
  });

  it("the picker's rule refuses a colour under 4.5:1", () => {
    expect(againstWhite("#E07B39")).toBeLessThan(4.5);
    expect(stationColourPasses("#E07B39")).toBe(false);
  });
});
