// Station recipes (network-desk 04.1): a 24-hour template by category that mixes the creator's
// work with the catalog and one carried local program. "Cooking and food" is the frame's day bar,
// exactly: catalog 6 to 8 am, the kitchen until noon, Council Watch from CIVC, the kitchen until
// 6 pm, catalog films, repeats, the catalog overnight. The block labels, colours and the carried
// program are proposed fields (N6).

import type { StationIdent } from "@opencast/contracts";
import type { RecipeX } from "../../api/ext";
import { U } from "./ids";
import { STATION_IDS } from "./stations";

const CIVC: StationIdent = { id: STATION_IDS.CIVC, kind: "station", callSign: "CIVC", handle: "civc", name: "Inland Civic", colour: "#2E6B5A", band: "tv", channel: "7.1", marketSlug: "inland-empire", homeCity: "Riverside" };
const COUNCIL = { station: CIVC, programTitle: "Council Watch", schedule: "Weeknights at noon", about: "public affairs for the market" };
const BREAKS = { everyMinutes: 30, lengthMs: 120_000, fillFrom: "market", blockedCategories: ["alcohol"] };
const NAVY = "#1F3A5F";
const RUST = "#9A5412";

export const RECIPE_IDS = { cooking: U(501), films: U(502), music: U(503), community: U(504) };

export function seedRecipes(): RecipeX[] {
  return [
    {
      id: RECIPE_IDS.cooking,
      name: "Cooking and food",
      category: "Cooking and food",
      band: "tv",
      when: "through the day",
      catalogAbout: "Classic films and overnight programming",
      maxAiringsPerWorkPerWeek: 3,
      breakRule: BREAKS,
      blocks: [
        { start: "06:00", end: "08:00", source: "catalog", label: "Catalog", listing: "Classic films from the catalog", colour: NAVY },
        { start: "08:00", end: "12:00", source: "creator", label: "{creator}'s kitchen" },
        { start: "12:00", end: "13:00", source: "carried", carried: COUNCIL },
        { start: "13:00", end: "18:00", source: "creator", label: "{creator}'s kitchen" },
        { start: "18:00", end: "22:00", source: "catalog", label: "Catalog films", listing: "Classic films from the catalog", colour: RUST },
        { start: "22:00", end: "02:00", source: "repeats", label: "{creator}, repeats" },
        { start: "02:00", end: "06:00", source: "overnight", label: "Catalog, overnight", colour: NAVY }
      ]
    },
    {
      id: RECIPE_IDS.films,
      name: "Films and video",
      category: "Films and video",
      band: "tv",
      when: "at night",
      catalogAbout: "Classic films through the day and overnight",
      maxAiringsPerWorkPerWeek: 3,
      breakRule: BREAKS,
      blocks: [
        { start: "06:00", end: "12:00", source: "catalog", label: "Catalog", listing: "Classic films from the catalog", colour: NAVY },
        { start: "12:00", end: "13:00", source: "carried", carried: COUNCIL },
        { start: "13:00", end: "19:00", source: "catalog", label: "Catalog films", listing: "Classic films from the catalog", colour: RUST },
        { start: "19:00", end: "20:30", source: "creator", label: "{creator}" },
        { start: "20:30", end: "23:00", source: "catalog", label: "Catalog films", listing: "Classic films from the catalog", colour: RUST },
        { start: "23:00", end: "02:00", source: "repeats", label: "{creator}, repeats" },
        { start: "02:00", end: "06:00", source: "overnight", label: "Catalog, overnight", colour: NAVY }
      ]
    },
    {
      id: RECIPE_IDS.music,
      name: "Music and talk",
      category: "Music and talk",
      band: "radio",
      when: "in the evenings",
      catalogAbout: "Public-domain recordings through the day and overnight",
      maxAiringsPerWorkPerWeek: 4,
      breakRule: { ...BREAKS, everyMinutes: 20, lengthMs: 90_000 },
      blocks: [
        { start: "06:00", end: "12:00", source: "catalog", label: "Catalog recordings", listing: "Recordings from the catalog", colour: NAVY },
        { start: "12:00", end: "13:00", source: "carried", carried: COUNCIL },
        { start: "13:00", end: "18:00", source: "catalog", label: "Catalog recordings", listing: "Recordings from the catalog", colour: RUST },
        { start: "18:00", end: "23:00", source: "creator", label: "{creator}" },
        { start: "23:00", end: "02:00", source: "repeats", label: "{creator}, repeats" },
        { start: "02:00", end: "06:00", source: "overnight", label: "Catalog, overnight", colour: NAVY }
      ]
    },
    {
      id: RECIPE_IDS.community,
      name: "Faith and community",
      category: "Faith and community",
      band: "radio",
      when: "mornings and evenings",
      catalogAbout: "Public-domain recordings and overnight programming",
      maxAiringsPerWorkPerWeek: 3,
      breakRule: { ...BREAKS, everyMinutes: 30, lengthMs: 60_000 },
      blocks: [
        { start: "06:00", end: "10:00", source: "creator", label: "{creator}" },
        { start: "10:00", end: "12:00", source: "catalog", label: "Catalog", listing: "Recordings from the catalog", colour: NAVY },
        { start: "12:00", end: "13:00", source: "carried", carried: COUNCIL },
        { start: "13:00", end: "18:00", source: "catalog", label: "Catalog recordings", listing: "Recordings from the catalog", colour: RUST },
        { start: "18:00", end: "22:00", source: "creator", label: "{creator}" },
        { start: "22:00", end: "02:00", source: "repeats", label: "{creator}, repeats" },
        { start: "02:00", end: "06:00", source: "overnight", label: "Catalog, overnight", colour: NAVY }
      ]
    }
  ];
}
