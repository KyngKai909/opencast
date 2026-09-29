// The creator's permission page on mocks (network-desk 06.1, 06.2). Public: no sign-in to read or
// answer. Three links from the frames, and any link the desk's mock sends ("mk." tokens carry the
// page's facts in full: see desk/mocks/handlers/permission.ts). In the one mock world the desk's
// own requests are answered too, and a creator's answer reaches the desk (src/mocks/overlaps.ts):
//
//   /permission/desert-skate-films-2026-0926   06.1, unanswered
//   /permission/desert-skate-films-said-yes    06.2, said yes September 27 at 10:15 am
//   /permission/tia-lupes-kitchen-2026-0922    said yes, and the station is set up (33.1 LUPE)
//
// Answers, stops and claims are kept in localStorage ("oc-mock-permission"). Anything else is 404.

import { http, type HttpHandler } from "msw";
import { networkApi, type PermissionPage, type StationIdent } from "@opencast/contracts";
import { now } from "../../../lib/clock";
import { fail, needsUser, path, reply } from "../respond";

type Page = PermissionPage;
const KEY = "oc-mock-permission";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

interface Saved {
  answer: { answer: "yes" | "no"; answeredAt: string; works: number } | null;
  stoppedAt: string | null;
  claim: Page["claim"] | null;
}

function load(): Record<string, Saved> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Saved>;
  } catch {
    return {};
  }
}

function save(all: Record<string, Saved>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* private window */
  }
}

// ---- The frames' creators ----

const FILMS: Array<[string, number]> = [["Joshua Tree, full film", 70], ["Salton Sea Bowls", 38], ["Mojave Pipes", 36], ["Borrego Lines", 34], ["Twentynine Palms", 40], ["Pioneertown Nights", 32]];
const SHORTS: Array<[string, number]> = [["Park sessions: Palm Springs", 20], ["Park sessions: Yucca Valley", 6], ["Park sessions: Indio", 7], ["Park sessions: Hesperia", 6], ["Park sessions: Banning", 6], ["Park sessions: Barstow", 7], ["Park sessions: Twentynine Palms", 6]];

function skate(): Page {
  let n = 10_000;
  const works: Page["works"] = [
    ...FILMS.map(([title, m]) => ({ id: U(++n), title, durationMs: m * 60_000, included: true, leftOutReason: null, groupLabel: "Full-length skate films", noun: "film" })),
    ...SHORTS.map(([title, m]) => ({ id: U(++n), title, durationMs: m * 60_000, included: true, leftOutReason: null, groupLabel: "Park session edits", noun: "short" })),
    { id: U(++n), title: "Sponsor edit for a shoe brand", durationMs: 4 * 60_000, included: false, leftOutReason: "Likely someone else's rights", groupLabel: null, noun: "edit" }
  ];
  return {
    creator: { displayName: "Desert Skate Films", personName: null, sourcePlatform: "vimeo" },
    proposed: { band: "tv", channel: "38.1" },
    note: "Your Joshua Tree film is the best thing we've seen from out here. We'd love to put it on the air where people who skate those parks can find it.",
    works,
    summary: { included: "6 skate films and 7 park session edits", leftOut: "the shoe sponsor edit" },
    marketName: "Inland Empire",
    schedulePreview: [
      { time: "19:00", title: "Joshua Tree, full film", source: "creator" },
      { time: "20:10", title: "Park sessions: Palm Springs", source: "creator" },
      { time: "20:30", title: "Classic films from the catalog", source: "catalog" }
    ],
    answer: null,
    station: null,
    claimable: false,
    stoppedAt: null,
    claim: null
  };
}

const LUPE: StationIdent = { id: U(110), kind: "claimable", callSign: "LUPE", handle: "lupe", name: "Tía Lupe’s Kitchen", colour: "#A3402A", band: "tv", channel: "33.1", marketSlug: "inland-empire", homeCity: "Fontana" };

function lupe(): Page {
  const dishes = ["Pozole rojo", "Tamales de rajas", "Chiles rellenos", "Mole poblano", "Birria de res", "Enchiladas verdes"];
  const works = Array.from({ length: 48 }, (_, i) => ({ id: U(20_000 + i), title: `${dishes[i % dishes.length]}${i >= dishes.length ? `, ${Math.floor(i / dishes.length) + 1}` : ""}`, durationMs: (i < 36 ? 38 : 41) * 60_000, included: true, leftOutReason: null, groupLabel: null, noun: "video" }));
  return {
    creator: { displayName: "Tía Lupe’s Kitchen", personName: "Lupe Ortiz", sourcePlatform: "youtube" },
    proposed: { band: "tv", channel: "33.1" },
    note: null,
    works,
    summary: { included: "48 cooking videos", leftOut: null },
    marketName: "Inland Empire",
    schedulePreview: [
      { time: "08:00", title: "Pozole rojo", source: "creator" },
      { time: "08:38", title: "Tamales de rajas", source: "creator" }
    ],
    answer: null,
    station: LUPE,
    claimable: true,
    stoppedAt: null,
    claim: null
  };
}

const FIXTURES: Record<string, { page: () => Page; answered?: Saved["answer"] }> = {
  "desert-skate-films-2026-0926": { page: skate },
  "desert-skate-films-said-yes": { page: skate, answered: { answer: "yes", answeredAt: "2026-09-27T17:15:00.000Z", works: 13 } },
  "tia-lupes-kitchen-2026-0922": { page: lupe, answered: { answer: "yes", answeredAt: "2026-09-22T17:40:00.000Z", works: 48 } }
};

// ---- Links the desk's mock sends ----

interface Seed {
  d: string;
  p: string | null;
  s: string;
  b: "tv" | "radio" | null;
  c: string | null;
  n: string | null;
  w: Array<[string, string, number | null, boolean, string | null, string | null, string | null]>;
  m: string;
}

/** Reads an "mk." token back into a page (the desk mock's format). Null when it isn't one. */
export function fromMockToken(token: string): Page | null {
  if (!token.startsWith("mk.")) return null;
  try {
    const b64 = token.slice(3).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const seed = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)))) as Seed;
    const works = seed.w.map(([id, title, durationMs, included, leftOutReason, groupLabel, noun]) => ({ id, title, durationMs, included, leftOutReason, groupLabel, noun }));
    // Tonight's preview from titles and lengths only: their works from 7 pm.
    let at = 19 * 60;
    const schedulePreview = works
      .filter((w) => w.included)
      .slice(0, 2)
      .map((w) => {
        const row = { time: `${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`, title: w.title, source: "creator" as const };
        at += Math.round((w.durationMs ?? 30 * 60_000) / 60_000);
        return row;
      });
    return {
      creator: { displayName: seed.d, personName: seed.p, sourcePlatform: seed.s as NonNullable<Page["creator"]["sourcePlatform"]> },
      proposed: seed.b && seed.c ? { band: seed.b, channel: seed.c } : null,
      note: seed.n,
      works,
      summary: null,
      marketName: seed.m,
      schedulePreview,
      answer: null,
      station: null,
      claimable: false,
      stoppedAt: null,
      claim: null
    };
  } catch {
    return null;
  }
}

function base(token: string): { page: Page; answered: Saved["answer"] } | null {
  const f = FIXTURES[token];
  if (f) return { page: f.page(), answered: f.answered ?? null };
  const p = fromMockToken(token);
  return p ? { page: p, answered: null } : null;
}

/** The page as it stands: its base, with whatever's been answered, stopped or claimed here. */
export function pageFor(token: string): Page | null {
  const b = base(token);
  if (!b) return null;
  const s = load()[token];
  const answer = s ? s.answer : b.answered;
  return { ...b.page, answer, stoppedAt: s?.stoppedAt ?? null, claim: s?.claim ?? null, claimable: !!b.page.station && !s?.stoppedAt };
}

function update(token: string, f: (s: Saved) => void) {
  const all = load();
  const b = base(token)!;
  const s = all[token] ?? { answer: b.answered, stoppedAt: null, claim: null };
  f(s);
  all[token] = s;
  save(all);
}

const tokenOf = (params: Record<string, unknown>) => String(params.token ?? "");

export const permissionHandlers: HttpHandler[] = [
  http.get(path(networkApi.getPermissionPage), ({ params }) => {
    const page = pageFor(tokenOf(params));
    return page ? reply(networkApi.getPermissionPage.response, page) : fail(404, "not_found", "That page wasn't found.");
  }),

  http.post(path(networkApi.answerPermission), async ({ request, params }) => {
    const token = tokenOf(params);
    const page = pageFor(token);
    if (!page) return fail(404, "not_found", "That page wasn't found.");
    if (page.answer) return fail(422, "already_answered", "This has been answered. Write to us to change it.");
    const body = (await request.json().catch(() => null)) as { answer?: string } | null;
    if (body?.answer !== "yes" && body?.answer !== "no") return fail(400, "invalid", "Answer yes or no.");
    const answer = body.answer;
    update(token, (s) => (s.answer = { answer, answeredAt: now().toISOString(), works: answer === "yes" ? page.works.filter((w) => w.included).length : 0 }));
    return reply(networkApi.getPermissionPage.response, pageFor(token)!);
  }),

  http.post(path(networkApi.stopFromLink), ({ params }) => {
    const token = tokenOf(params);
    const page = pageFor(token);
    if (!page) return fail(404, "not_found", "That page wasn't found.");
    if (page.answer?.answer !== "yes") return fail(422, "nothing_to_stop", "There's nothing to stop: you haven't said yes.");
    update(token, (s) => (s.stoppedAt = now().toISOString()));
    return reply(networkApi.getPermissionPage.response, pageFor(token)!);
  }),

  http.post(path(networkApi.claimFromLink), ({ request, params }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const token = tokenOf(params);
    const page = pageFor(token);
    if (!page) return fail(404, "not_found", "That page wasn't found.");
    if (page.answer?.answer !== "yes" || page.stoppedAt) return fail(422, "nothing_to_claim", "There's no station to claim from this link.");
    if (page.claim && page.claim.status !== "cancelled") return page.claim.status === "completed" ? fail(422, "nothing_to_claim", "This station has been claimed already.") : fail(422, "in_progress", "A claim for this station is already in progress.");
    update(token, (s) => (s.claim = { handoverId: U(880_000 + (Date.now() % 1000)), status: "verifying", startedAt: now().toISOString() }));
    return reply(networkApi.getPermissionPage.response, pageFor(token)!);
  }),

  // Claim now once the station exists: the ordinary handover (auth: user).
  http.post(path(networkApi.startHandover), async ({ request, params }) => {
    const denied = needsUser(request);
    if (denied) return denied;
    const token = Object.keys(FIXTURES).find((t) => FIXTURES[t]!.page().station?.id === String(params.stationId));
    if (!token) return fail(404, "not_found", "That station wasn't found.");
    const body = (await request.json().catch(() => null)) as { kind?: string; sourceAccountProof?: string } | null;
    if ((body?.kind !== "claim" && body?.kind !== "stop") || !body.sourceAccountProof) return fail(400, "invalid", "Say whether it's a claim or a stop.");
    const page = pageFor(token)!;
    if (page.claim && page.claim.status !== "cancelled") return fail(422, "in_progress", "A claim for this station is already in progress.");
    const handoverId = U(881_000 + (Date.now() % 1000));
    update(token, (s) => {
      if (body.kind === "claim") s.claim = { handoverId, status: "verifying", startedAt: now().toISOString() };
      else s.stoppedAt = now().toISOString();
    });
    return reply(networkApi.startHandover.response, { handoverId, status: "verifying", payableAfter: null }, 201);
  })
];
