// The creator pipeline (network-desk 02.1): the frame's eight rows, and thirteen more so the stage
// strip reads as drawn (6 found, 2 already licensed, 3 asked, 4 said yes, 1 setting up, 1 on air,
// 3 claimed; Inland Jazz Society declined). Tía Lupe's Kitchen is set up (the API moves a creator to
// Setting up when the station is made; the frame's "Said yes" is inventory item 5). Their works,
// and the permission requests already out.

import type { CreatorStage, CreatorWork } from "@opencast/contracts";
import { U } from "./ids";
import { HD, IE } from "./markets";
import { DEE } from "./people";
import { RECIPE_IDS } from "./recipes";
import { LUPE_SIGN_ON, STATION_IDS } from "./stations";

export interface DbCreator {
  id: string;
  marketId: string;
  displayName: string;
  personName: string | null;
  description: string | null;
  sourcePlatform: "youtube" | "vimeo" | "internet_archive" | "instagram" | "facebook" | "soundcloud" | "bandcamp" | "other";
  sourceUrl: string;
  contactEmail: string | null;
  stage: CreatorStage;
  proposedOptions: { band: "tv" | "radio"; channels: string[] } | null;
  nextAction: string | null;
  nextActionDue: string | null;
  doNotAsk: boolean;
  stationId: string | null;
  askedAt: string | null;
  remindedAt: string | null;
  answeredAt: string | null;
  claimInviteSentAt: string | null;
  claimLinkSentAt: string | null;
  claimedAt: string | null;
  licenceName: string | null;
  pronoun: "she" | "he" | "they";
  createdAt: string;
  /** The setup, once setUpClaimable has run: the rest is read from the station. */
  setup: { recipeId: string; operatorId: string; importTotal: number; setupAt: string; importDone?: number; /** A new setup's import runs on with the clock; the seed's stay as drawn. */ running?: boolean } | null;
}

export interface DbWork extends Omit<CreatorWork, "covered"> {
  creatorId: string;
}

export interface DbRequest {
  id: string;
  token: string;
  creatorId: string;
  sentVia: string[];
  note: string | null;
  proposed: { band: "tv" | "radio"; channel: string } | null;
  recipeId: string | null;
  sentAt: string;
  answer: { answer: "yes" | "no"; answeredAt: string; workIds: string[] } | null;
}

export const CREATOR_IDS = {
  lupe: U(201), skate: U(202), mojave: U(203), poetry: U(204), gospel: U(205), marcus: U(206), sazon: U(207), jazz: U(208),
  bowl: U(209), lowriders: U(210), wrestling: U(211), birding: U(212), stories: U(213), oral: U(214), robotics: U(215),
  spotters: U(216), mariachi: U(217), garden: U(218), fiddlers: U(219), prep: U(220), nite: U(221), hdMine: U(222)
};

const at = (iso: string) => new Date(iso).toISOString();

function c(id: string, displayName: string, description: string, sourcePlatform: DbCreator["sourcePlatform"], stage: CreatorStage, extra: Partial<DbCreator> = {}): DbCreator {
  const slug = displayName.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "");
  const host = { youtube: "https://www.youtube.com/@", vimeo: "https://vimeo.com/", internet_archive: "https://archive.org/details/", instagram: "https://www.instagram.com/", facebook: "https://www.facebook.com/", soundcloud: "https://soundcloud.com/", bandcamp: "https://bandcamp.com/", other: "https://example.com/" }[sourcePlatform];
  return {
    id,
    marketId: IE.id,
    displayName,
    personName: null,
    description,
    sourcePlatform,
    sourceUrl: `${host}${slug}`,
    contactEmail: null,
    stage,
    proposedOptions: null,
    nextAction: null,
    nextActionDue: null,
    doNotAsk: false,
    stationId: null,
    askedAt: null,
    remindedAt: null,
    answeredAt: null,
    claimInviteSentAt: null,
    claimLinkSentAt: null,
    claimedAt: null,
    licenceName: null,
    pronoun: "they",
    createdAt: at("2026-08-01T17:00:00Z"),
    setup: null,
    ...extra
  };
}

const I = CREATOR_IDS;

export function seedCreators(): DbCreator[] {
  return [
    c(I.lupe, "Tía Lupe’s Kitchen", "Cooking in Spanish, Fontana", "youtube", "setting_up", {
      personName: "Lupe Ortiz", pronoun: "she", contactEmail: "lupe@tialupe.example", sourceUrl: "https://www.youtube.com/@tialupeskitchen",
      proposedOptions: { band: "tv", channels: ["33.1"] }, stationId: STATION_IDS.LUPE, nextAction: "Sign on",
      askedAt: at("2026-09-15T18:00:00Z"), answeredAt: at("2026-09-22T17:40:00Z"), createdAt: at("2026-09-02T17:00:00Z"),
      setup: { recipeId: RECIPE_IDS.cooking, operatorId: DEE.id, importTotal: 48, importDone: 31, setupAt: at("2026-09-22T19:00:00Z") }
    }),
    c(I.skate, "Desert Skate Films", "Skate films, Joshua Tree", "vimeo", "found", {
      contactEmail: "hello@desertskate.example", sourceUrl: "https://vimeo.com/desertskatefilms", proposedOptions: { band: "tv", channels: ["38.1", "45.1"] }, nextAction: "Ask", createdAt: at("2026-09-20T17:00:00Z")
    }),
    c(I.mojave, "Mojave Field Recordings", "Desert soundscapes, CC BY 4.0", "internet_archive", "already_licensed", {
      stationId: STATION_IDS.FLDR, licenceName: "CC BY 4.0", proposedOptions: { band: "radio", channels: ["91.9"] }, claimInviteSentAt: at("2026-09-24T17:00:00Z"), nextAction: "Claim invite", createdAt: at("2026-09-01T17:00:00Z")
    }),
    c(I.poetry, "Riverside Poetry Collective", "Readings and open mics", "instagram", "asked", {
      contactEmail: null, proposedOptions: { band: "radio", channels: [] }, askedAt: at("2026-09-19T18:00:00Z"), nextAction: "Reminder", nextActionDue: "2026-09-26", createdAt: at("2026-09-10T17:00:00Z")
    }),
    c(I.gospel, "Inland Gospel Choirs", "Sunday services and rehearsals", "facebook", "said_yes", {
      contactEmail: "choirs@inlandgospel.example", proposedOptions: { band: "radio", channels: ["95.5"] }, askedAt: at("2026-09-18T18:00:00Z"), answeredAt: at("2026-09-25T16:20:00Z"), nextAction: "Set up", createdAt: at("2026-09-08T17:00:00Z")
    }),
    c(I.marcus, "Marcus Reyes", "Mixes and producer interviews", "soundcloud", "on_air", {
      personName: "Marcus Reyes", pronoun: "he", contactEmail: "marcus@reyes.example", stationId: STATION_IDS.CRAT, proposedOptions: { band: "radio", channels: ["101.9"] },
      askedAt: at("2026-07-28T18:00:00Z"), answeredAt: at("2026-08-03T18:00:00Z"), claimLinkSentAt: at("2026-09-20T17:00:00Z"), nextAction: "Claim link", createdAt: at("2026-07-20T17:00:00Z"),
      setup: { recipeId: RECIPE_IDS.music, operatorId: DEE.id, importTotal: 20, importDone: 20, setupAt: at("2026-08-05T18:00:00Z") }
    }),
    c(I.sazon, "Sazón family kitchen", "Home cooking, Fontana", "youtube", "claimed", {
      stationId: STATION_IDS.SAZN, answeredAt: at("2026-06-20T18:00:00Z"), claimedAt: at("2026-08-28T18:00:00Z"), createdAt: at("2026-06-01T17:00:00Z")
    }),
    c(I.jazz, "Inland Jazz Society", "Concert archive", "bandcamp", "declined", { doNotAsk: true, askedAt: at("2026-08-26T18:00:00Z"), answeredAt: at("2026-09-02T18:00:00Z"), createdAt: at("2026-08-20T17:00:00Z") }),
    // Found
    c(I.bowl, "Redlands Bowl Archive", "Summer concerts from the Bowl", "youtube", "found", { proposedOptions: { band: "tv", channels: ["48.1"] }, nextAction: "Ask", createdAt: at("2026-09-18T17:00:00Z") }),
    c(I.lowriders, "Colton Lowriders", "Car club films and meets", "youtube", "found", { proposedOptions: { band: "tv", channels: ["55.1"] }, nextAction: "Ask", createdAt: at("2026-09-16T17:00:00Z") }),
    c(I.wrestling, "Fontana Wrestling Hour", "Local wrestling cards", "facebook", "found", { proposedOptions: { band: "tv", channels: ["63.1"] }, nextAction: "Ask", createdAt: at("2026-09-14T17:00:00Z") }),
    c(I.birding, "Chino Hills Birding", "Bird walks and field notes", "vimeo", "found", { contactEmail: "walks@chinobirds.example", proposedOptions: { band: "tv", channels: ["57.1"] }, nextAction: "Ask", createdAt: at("2026-09-12T17:00:00Z") }),
    c(I.stories, "San Jacinto Storytellers", "Stories from elders, San Jacinto", "soundcloud", "found", { proposedOptions: { band: "radio", channels: ["98.5"] }, nextAction: "Ask", createdAt: at("2026-09-11T17:00:00Z") }),
    // Already licensed, not set up yet
    c(I.oral, "Inland Empire Oral Histories", "Interviews from the 1970s, CC BY 4.0", "internet_archive", "already_licensed", { licenceName: "CC BY 4.0", proposedOptions: { band: "radio", channels: ["97.7"] }, nextAction: "Set up", createdAt: at("2026-09-09T17:00:00Z") }),
    // Asked
    c(I.robotics, "Rialto Robotics Club", "Build nights and competitions", "youtube", "asked", { contactEmail: "team@rialtorobotics.example", proposedOptions: { band: "tv", channels: ["49.1"] }, askedAt: at("2026-09-24T18:00:00Z"), nextAction: "Reminder", nextActionDue: "2026-10-01", createdAt: at("2026-09-06T17:00:00Z") }),
    c(I.spotters, "Ontario Airport Spotters", "Plane spotting from the fence", "youtube", "asked", { proposedOptions: { band: "tv", channels: ["58.1"] }, askedAt: at("2026-09-21T18:00:00Z"), nextAction: "Reminder", nextActionDue: "2026-09-28", createdAt: at("2026-09-05T17:00:00Z") }),
    // Said yes
    c(I.mariachi, "Moreno Valley Mariachi", "Mariachi school recitals", "youtube", "said_yes", { contactEmail: "maestro@mvmariachi.example", proposedOptions: { band: "tv", channels: ["27.1"] }, askedAt: at("2026-09-17T18:00:00Z"), answeredAt: at("2026-09-24T19:00:00Z"), nextAction: "Set up", createdAt: at("2026-09-04T17:00:00Z") }),
    c(I.garden, "Corona Garden Club", "Gardening in the heat", "instagram", "said_yes", { proposedOptions: { band: "tv", channels: ["46.1"] }, askedAt: at("2026-09-16T18:00:00Z"), answeredAt: at("2026-09-23T18:00:00Z"), nextAction: "Set up", createdAt: at("2026-09-03T17:00:00Z") }),
    c(I.fiddlers, "Yucaipa Fiddlers", "Old-time fiddle sessions", "bandcamp", "said_yes", { proposedOptions: { band: "radio", channels: ["99.3"] }, askedAt: at("2026-09-14T18:00:00Z"), answeredAt: at("2026-09-21T18:00:00Z"), nextAction: "Set up", createdAt: at("2026-08-30T17:00:00Z") }),
    // Claimed
    c(I.prep, "Prep Sports Weekly", "High school games, Riverside", "youtube", "claimed", { stationId: STATION_IDS.PREP, answeredAt: at("2026-05-10T18:00:00Z"), claimedAt: at("2026-07-14T18:00:00Z"), createdAt: at("2026-05-01T17:00:00Z") }),
    c(I.nite, "Night Shift Radio", "Late-night call-in", "soundcloud", "claimed", { stationId: STATION_IDS.NITE, answeredAt: at("2026-04-20T18:00:00Z"), claimedAt: at("2026-06-30T18:00:00Z"), createdAt: at("2026-04-10T17:00:00Z") }),
    // High Desert
    c(I.hdMine, "Barstow Rail Films", "Trains through the Mojave", "youtube", "found", { marketId: HD.id, proposedOptions: { band: "tv", channels: ["21.1"] }, nextAction: "Ask", createdAt: at("2026-09-19T17:00:00Z") })
  ];
}

// ---- Works ----

const MIN = 60_000;

function work(n: number, creatorId: string, title: string, minutes: number | null, noun: string, extra: Partial<DbWork> = {}): DbWork {
  return {
    id: U(10_000 + n),
    creatorId,
    title,
    durationMs: minutes === null ? null : minutes * MIN,
    sourceUrl: `https://example.com/works/${n}`,
    groupLabel: null,
    leftOutReason: null,
    licence: null,
    noun,
    ...extra
  };
}

const DISHES = [
  "Pozole rojo", "Tamales de rajas", "Chiles rellenos", "Mole poblano", "Birria de res", "Enchiladas verdes", "Sopa de fideo", "Arroz a la mexicana",
  "Frijoles de la olla", "Carne asada", "Tacos dorados", "Caldo de pollo", "Chilaquiles", "Pan de elote", "Flan de cajeta", "Champurrado",
  "Albóndigas", "Picadillo", "Calabacitas", "Nopales en salsa", "Tortillas de harina", "Salsa macha", "Capirotada", "Buñuelos"
];

export function seedWorks(): DbWork[] {
  const w: DbWork[] = [];
  let n = 0;
  const I = CREATOR_IDS;
  // Desert Skate Films: 6 films (4 hr 10 min), 7 park session edits (58 min), and the sponsor edit.
  const films: Array<[string, number]> = [["Joshua Tree, full film", 70], ["Salton Sea Bowls", 38], ["Mojave Pipes", 36], ["Borrego Lines", 34], ["Twentynine Palms", 40], ["Pioneertown Nights", 32]];
  const shorts: Array<[string, number]> = [["Park sessions: Palm Springs", 20], ["Park sessions: Yucca Valley", 6], ["Park sessions: Indio", 7], ["Park sessions: Hesperia", 6], ["Park sessions: Banning", 6], ["Park sessions: Barstow", 7], ["Park sessions: Twentynine Palms", 6]];
  for (const [t, m] of films) w.push(work(++n, I.skate, t, m, "film", { groupLabel: "Full-length skate films" }));
  for (const [t, m] of shorts) w.push(work(++n, I.skate, t, m, "short", { groupLabel: "Park session edits" }));
  w.push(work(++n, I.skate, "Sponsor edit for a shoe brand", 4, "edit", { leftOutReason: "Likely someone else's rights" }));
  // Tía Lupe's Kitchen: 48 videos, 31 hours.
  for (let i = 0; i < 48; i++) w.push(work(++n, I.lupe, i < 24 ? DISHES[i]! : `Domingo: ${DISHES[i - 24]!}`, i < 36 ? 38 : 41, "video"));
  // Mojave Field Recordings: CC BY 4.0, which allows carriage.
  const places = ["Kelso Dunes at dawn", "Amboy Crater wind", "Cima Dome rain", "Hole-in-the-Wall", "Mitchell Caverns", "Soda Lake evening", "Castle Peaks", "Teutonia Peak", "Lanfair Valley", "Piute Spring", "Joshua tree grove", "Night insects, Nipton"];
  places.forEach((t, i) => w.push(work(++n, I.mojave, t, 18 + (i % 5) * 4, "recording", { licence: { licence: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/", attribution: "Mojave Field Recordings", allowsCarriage: true } })));
  // Inland Empire Oral Histories: CC BY 4.0.
  for (let i = 0; i < 15; i++) w.push(work(++n, I.oral, `Interview ${i + 1}, 1974`, 28 + (i % 4) * 3, "recording", { licence: { licence: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/", attribution: "Inland Empire Oral Histories", allowsCarriage: true } }));
  // Everyone else: plain lists.
  const plain: Array<[string, string, number, number, string]> = [
    [I.gospel, "Sunday service", 22, 55, "recording"],
    [I.marcus, "Mix", 20, 60, "mix"],
    [I.poetry, "Open mic night", 9, 40, "video"],
    [I.bowl, "Bowl concert", 16, 90, "video"],
    [I.lowriders, "Cruise night", 11, 25, "video"],
    [I.wrestling, "Card", 12, 60, "video"],
    [I.birding, "Bird walk", 10, 22, "video"],
    [I.stories, "Story", 18, 15, "recording"],
    [I.robotics, "Build night", 8, 30, "video"],
    [I.spotters, "Fence session", 14, 20, "video"],
    [I.mariachi, "Recital", 9, 45, "video"],
    [I.garden, "Garden walk", 12, 18, "video"],
    [I.fiddlers, "Session", 16, 35, "recording"],
    [I.hdMine, "Rail film", 7, 26, "film"]
  ];
  for (const [creatorId, base, count, minutes, noun] of plain) for (let i = 0; i < count; i++) w.push(work(++n, creatorId, `${base} ${i + 1}`, minutes, noun));
  return w;
}

// ---- Permission requests already out ----

export function seedRequests(): DbRequest[] {
  const I = CREATOR_IDS;
  const yes = (answeredAt: string) => ({ answer: "yes" as const, answeredAt, workIds: [] as string[] });
  return [
    { id: U(601), token: "req-tia-lupes-kitchen-0922", creatorId: I.lupe, sentVia: ["YouTube message", "lupe@tialupe.example"], note: null, proposed: { band: "tv", channel: "33.1" }, recipeId: RECIPE_IDS.cooking, sentAt: at("2026-09-15T18:00:00Z"), answer: yes(at("2026-09-22T17:40:00Z")) },
    { id: U(602), token: "req-riverside-poetry-0919", creatorId: I.poetry, sentVia: ["Instagram message"], note: null, proposed: null, recipeId: RECIPE_IDS.music, sentAt: at("2026-09-19T18:00:00Z"), answer: null },
    { id: U(603), token: "req-inland-gospel-choirs-0918", creatorId: I.gospel, sentVia: ["Facebook message", "choirs@inlandgospel.example"], note: null, proposed: { band: "radio", channel: "95.5" }, recipeId: RECIPE_IDS.community, sentAt: at("2026-09-18T18:00:00Z"), answer: yes(at("2026-09-25T16:20:00Z")) },
    { id: U(604), token: "req-marcus-reyes-0728", creatorId: I.marcus, sentVia: ["SoundCloud message", "marcus@reyes.example"], note: null, proposed: { band: "radio", channel: "101.9" }, recipeId: RECIPE_IDS.music, sentAt: at("2026-07-28T18:00:00Z"), answer: yes(at("2026-08-03T18:00:00Z")) },
    { id: U(605), token: "req-inland-jazz-society-0826", creatorId: I.jazz, sentVia: ["Bandcamp message"], note: null, proposed: null, recipeId: null, sentAt: at("2026-08-26T18:00:00Z"), answer: { answer: "no", answeredAt: at("2026-09-02T18:00:00Z"), workIds: [] } },
    { id: U(606), token: "req-rialto-robotics-0924", creatorId: I.robotics, sentVia: ["YouTube message", "team@rialtorobotics.example"], note: null, proposed: { band: "tv", channel: "49.1" }, recipeId: RECIPE_IDS.films, sentAt: at("2026-09-24T18:00:00Z"), answer: null },
    { id: U(607), token: "req-ontario-spotters-0921", creatorId: I.spotters, sentVia: ["YouTube message"], note: null, proposed: { band: "tv", channel: "58.1" }, recipeId: RECIPE_IDS.films, sentAt: at("2026-09-21T18:00:00Z"), answer: null },
    { id: U(608), token: "req-moreno-mariachi-0917", creatorId: I.mariachi, sentVia: ["YouTube message", "maestro@mvmariachi.example"], note: null, proposed: { band: "tv", channel: "27.1" }, recipeId: RECIPE_IDS.films, sentAt: at("2026-09-17T18:00:00Z"), answer: yes(at("2026-09-24T19:00:00Z")) },
    { id: U(609), token: "req-corona-garden-0916", creatorId: I.garden, sentVia: ["Instagram message"], note: null, proposed: { band: "tv", channel: "46.1" }, recipeId: RECIPE_IDS.films, sentAt: at("2026-09-16T18:00:00Z"), answer: yes(at("2026-09-23T18:00:00Z")) },
    { id: U(610), token: "req-yucaipa-fiddlers-0914", creatorId: I.fiddlers, sentVia: ["Bandcamp message"], note: null, proposed: { band: "radio", channel: "99.3" }, recipeId: RECIPE_IDS.music, sentAt: at("2026-09-14T18:00:00Z"), answer: yes(at("2026-09-21T18:00:00Z")) }
  ];
}
