import { describe, expect, it } from "vitest";
import {
  IAB_AD_PRODUCT_BY_CATEGORY,
  IAB_CONTENT_BY_CATEGORY,
  IAB_CONTENT_FALLBACK,
  blockedIabAdProducts,
  iabAdProductsFor,
  iabContentCategories,
  iabContentFor,
  isChildrensRating,
  isIabId
} from "../src/ads.js";

// Every id used, with its name in IAB Tech Lab's published TSVs, so a typo can't slip in.
const CONTENT_3_0: Record<string, string> = {
  "338": "Music",
  A0AH3G: "Talk Show",
  "371": "Talk Radio",
  "386": "Politics",
  "8YPBBL": "Civic affairs",
  "210": "Food & Drink",
  "324": "Movies",
  "640": "Television",
  "483": "Sports",
  "645": "Family/Children",
  "646": "Comedy",
  "332": "Documentary",
  EZWB7V: "History",
  VKIV56: "Nature",
  "201": "Fine Art",
  "453": "Religion & Spirituality",
  "132": "Education",
  "464": "Science",
  JLBCU7: "Entertainment"
};
const AD_PRODUCT_2_0: Record<string, string> = {
  "1002": "Alcohol",
  "1361": "Gambling",
  "1049": "Cannabis",
  "1474": "Politics",
  "1349": "Payday and Emergency Loans",
  "1548": "Vaping",
  "1549": "Vaping Cartridges",
  "1550": "Vaporizors",
  "1544": "Tobacco",
  "1259": "Dating",
  "1001": "Adult Products and Services",
  "1576": "Weapons and Ammunition",
  "1355": "Food and Beverage Services",
  "1133": "Coffee and Tea",
  "1494": "Retail",
  "1012": "Business Services",
  "1396": "Home and Garden Services",
  "1551": "Vehicles",
  "1378": "Health and Medical Services",
  "1452": "Non-Profits",
  "1482": "Real Estate",
  "1416": "Legal Services",
  "1487": "Religion and Spirituality",
  "1295": "Education and Careers",
  "1315": "Events and Performances",
  "1510": "Fitness Activities",
  "1529": "Travel and Tourism",
  "1335": "Finance and Insurance"
};

describe("IAB content categories", () => {
  it("maps every station and program category in use", () => {
    expect(iabContentFor("Music")).toEqual(["338"]);
    expect(iabContentFor("Public affairs")).toEqual(["386", "8YPBBL"]);
    expect(iabContentFor("Food")).toEqual(["210"]);
    expect(iabContentFor("Classic")).toEqual(["324", "640"]);
    expect(iabContentFor("Sports")).toEqual(["483"]);
    expect(iabContentFor("Talk")).toEqual(["A0AH3G", "371"]);
  });

  it("uses only ids from Content Taxonomy 3.0", () => {
    for (const ids of [...Object.values(IAB_CONTENT_BY_CATEGORY), IAB_CONTENT_FALLBACK]) {
      for (const id of ids) {
        expect(CONTENT_3_0[id], id).toBeDefined();
        expect(isIabId(id)).toBe(true);
      }
    }
  });

  it("an override wins; then the category; then the station's; then Entertainment", () => {
    expect(iabContentCategories({ override: ["483", "483"], category: "Music" })).toEqual(["483"]);
    expect(iabContentCategories({ override: [], category: "music " })).toEqual(["338"]);
    expect(iabContentCategories({ category: null, fallbackCategory: "Food" })).toEqual(["210"]);
    expect(iabContentCategories({ category: "Something new" })).toEqual(["JLBCU7"]);
  });
});

describe("IAB ad product categories", () => {
  it("maps the categories stations block", () => {
    expect(blockedIabAdProducts(["Alcohol", "Gambling", "Cannabis", "Political", "Payday loans", "Vaping"])).toEqual([
      "1002",
      "1361",
      "1049",
      "1474",
      "1349",
      "1548",
      "1549",
      "1550"
    ]);
    expect(blockedIabAdProducts(["alcohol", "Alcohol", "Not a category"])).toEqual(["1002"]);
    expect(iabAdProductsFor("Coffee and food")).toEqual(["1355", "1133"]);
    expect(iabAdProductsFor(null)).toBeNull();
  });

  it("uses only ids from Ad Product Taxonomy 2.0", () => {
    for (const ids of Object.values(IAB_AD_PRODUCT_BY_CATEGORY)) {
      for (const id of ids) expect(AD_PRODUCT_2_0[id], id).toBeDefined();
    }
  });
});

describe("content ratings", () => {
  it("TV-Y and TV-Y7 are made for children", () => {
    expect(isChildrensRating("TV-Y")).toBe(true);
    expect(isChildrensRating("TV-Y7")).toBe(true);
    expect(isChildrensRating("TV-G")).toBe(false);
    expect(isChildrensRating(null)).toBe(false);
  });
});
