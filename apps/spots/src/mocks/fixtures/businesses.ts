// Orange Street Coffee (every business frame): a coffee house on Orange Street in Redlands,
// opening in Colton. Its three live spots and one ended (biz-spots 01.1), its balance and the
// movements the Balance frame draws (biz-funding 03.1); its profile and money settings as
// biz-settings 01.1 and 03.1 draw them. (Colton is seeded as a second location, where 01.1
// suggests adding it: "Now open in Colton" targets it.) And Cypress Dental, which Devon M.'s
// agency also manages, so the business switcher has somewhere to go.

import type { Balance, Business, Movement, Spot } from "@opencast/contracts";
import { MARKET } from "./stations";
import { uid } from "./people";
import { at } from "./time";

export const OSC_ID = uid(60001);
export const CYPRESS_ID = uid(60002);

/** The logo square: letters and colour (the shell's switcher, "OSC"). */
export const LOGOS: Record<string, { initials: string; colour: string }> = {
  [OSC_ID]: { initials: "OSC", colour: "#6B4A2B" },
  [CYPRESS_ID]: { initials: "CD", colour: "#1D6A70" }
};

const $ = (dollars: number) => Math.round(dollars * 1_000_000);

export function seedBusinesses(): Business[] {
  return [
    {
      id: OSC_ID,
      name: "Orange Street Coffee",
      category: "Coffee and food",
      about: "A family coffee house in downtown Redlands since 2014.",
      website: "orangestreet.example",
      logoUrl: null,
      customersWhere: "location",
      locations: [
        { id: uid(61001), kind: "location", label: "Orange Street", streetAddress: "204 Orange St", city: "Redlands", latitude: 34.0556, longitude: -117.1825, radiusMiles: null },
        { id: uid(61002), kind: "location", label: "Colton", streetAddress: "1150 E Washington St", city: "Colton", latitude: 34.0506, longitude: -117.2911, radiusMiles: null }
      ],
      marketIds: [MARKET.id],
      warnDays: [3, 1],
      autoTopUp: { on: false, amountMicros: null, belowDays: 3 },
      receiptsEmail: "books@orangestreet.example",
      legalName: "Orange Street Coffee LLC",
      einLast4: "4471",
      createdAt: at("-120 10:00")
    },
    {
      id: CYPRESS_ID,
      name: "Cypress Dental",
      category: "Health",
      about: "Family dentistry in Loma Linda.",
      website: "cypressdental.example",
      logoUrl: null,
      customersWhere: "location",
      locations: [{ id: uid(61101), kind: "location", label: null, streetAddress: "25455 Barton Rd", city: "Loma Linda", latitude: 34.0483, longitude: -117.2611, radiusMiles: null }],
      marketIds: [MARKET.id],
      warnDays: [3],
      autoTopUp: { on: true, amountMicros: $(200), belowDays: 3 },
      receiptsEmail: null,
      legalName: null,
      einLast4: null,
      createdAt: at("-60 10:00")
    }
  ];
}

export function seedBalances(): Record<string, Balance> {
  return {
    [OSC_ID]: {
      availableMicros: $(412.5),
      heldMicros: $(14.2),
      heldAirings: 41,
      spentThisMonthMicros: $(248.9),
      spentThisMonthAirings: 118,
      pacePerDayMicros: $(9.2),
      runwayDays: 44,
      pendingDeposits: [],
      fundingSources: [
        { id: uid(62001), kind: "clear_bank", label: "Clear, Chase ending 8810", isDefault: true },
        { id: uid(62002), kind: "card", label: "Visa ending 4417", isDefault: false }
      ]
    },
    [CYPRESS_ID]: {
      availableMicros: $(186.0),
      heldMicros: $(6.4),
      heldAirings: 12,
      spentThisMonthMicros: $(92.3),
      spentThisMonthAirings: 38,
      pacePerDayMicros: $(3.4),
      runwayDays: 54,
      pendingDeposits: [],
      fundingSources: [{ id: uid(62101), kind: "card", label: "Visa ending 2210", isDefault: true }]
    }
  };
}

let m = 0;
const mv = (o: Omit<Movement, "id">): Movement => ({ id: uid(63000 + ++m), ...o });

export function seedMovements(): Record<string, Movement[]> {
  return {
    [OSC_ID]: [
      mv({ at: at("20:28"), kind: "aired", label: "Aired on BEAT 12.1", amountMicros: -$(2.1), detail: ":30 spot, 262 tuned in, $8.00 per 1,000" }),
      mv({ at: at("20:14"), kind: "held", label: "Held for 9 airings tonight", amountMicros: $(4.6), detail: "BEAT 12.1 and SAZN 18.1 scheduled your spot" }),
      mv({ at: at("-1 21:59"), kind: "returned", label: "Returned: airing cut short", amountMicros: $(0.84), detail: "CIVC 7.1, the town hall ran over. Aired :12 of :30" }),
      mv({ at: at("-1 19:40"), kind: "aired", label: "Aired on CIVC 7.1", amountMicros: -$(3.28), detail: ":30 spot, 410 tuned in" }),
      mv({ at: at("-25 10:00"), kind: "added", label: "Added by bank transfer", amountMicros: $(500), detail: "Through Clear, from Chase ending 8810" })
    ],
    [CYPRESS_ID]: [mv({ at: at("-20 10:00"), kind: "added", label: "Added by card", amountMicros: $(200), detail: "Visa ending 2210" })]
  };
}

const noTargeting = { withinMiles: 10, locationIds: [], marketIds: [], stationCategories: [], dayparts: [], excludedStationIds: [] };

export function seedSpots(): Spot[] {
  const spot = (o: Partial<Spot> & Pick<Spot, "id" | "title" | "lengthSec" | "state">): Spot => ({
    businessId: OSC_ID,
    category: "Food",
    inRotationOn: 0,
    rate: { kind: "per_thousand", micros: $(8), perAiringMaxMicros: null },
    budget: { totalMicros: $(300), dailyCapMicros: null, usedMicros: 0, usedTodayMicros: 0 },
    startsOn: null,
    endsOn: null,
    targeting: { ...noTargeting, locationIds: [uid(61001)] },
    code: null,
    file: { url: "/mock-media/spot.mp4", previewUrl: null, durationMs: o.lengthSec * 1000, originalFilename: null, checks: [] },
    productionOrderId: null,
    createdAt: at("-40 10:00"),
    ...o
  });
  return [
    spot({ id: uid(64001), title: "Fall menu", lengthSec: 30, state: "in_rotation", inRotationOn: 3, budget: { totalMicros: $(300), dailyCapMicros: null, usedMicros: $(176.4), usedTodayMicros: $(4.6) }, code: { code: "ORANGE10", offer: "10% off", windowDays: 7 }, startsOn: "2026-09-01" }),
    spot({ id: uid(64002), title: "Pumpkin latte", lengthSec: 15, state: "paused_daily_cap", rate: { kind: "per_thousand", micros: $(5), perAiringMaxMicros: null }, budget: { totalMicros: $(120), dailyCapMicros: $(4), usedMicros: $(38), usedTodayMicros: $(4) }, code: { code: "PUMPKIN", offer: "A free pastry with a latte", windowDays: 7 }, inRotationOn: 2 }),
    spot({ id: uid(64003), title: "Now open in Colton", lengthSec: 30, state: "in_review", rate: { kind: "per_airing", micros: $(4), perAiringMaxMicros: null }, budget: { totalMicros: $(200), dailyCapMicros: null, usedMicros: 0, usedTodayMicros: 0 }, code: { code: "COLTON", offer: "A free coffee on opening week", windowDays: 7 }, targeting: { ...noTargeting, locationIds: [uid(61002)] }, createdAt: at("14:00") }),
    spot({ id: uid(64004), title: "Summer cold brew", lengthSec: 30, state: "ended", budget: { totalMicros: $(240), dailyCapMicros: null, usedMicros: $(240), usedTodayMicros: 0 }, endsOn: "2026-08-31", createdAt: at("-110 10:00") })
  ];
}
