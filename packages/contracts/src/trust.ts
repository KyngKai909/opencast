import { z } from "zod";
import { endpoint } from "./core.js";
import { Id, Market, Millis, StationIdent, Timestamp } from "./common.js";
import { ClaimState } from "./states.js";

/**
 * Added 2026-09-29 (Network desk, Rights claims): what a claim is about. Copyright follows the
 * answer and counter-notice path; a privacy complaint (someone shown without consent) comes off air
 * the same way but follows its own path: no answer window, Opencast reviews it, and it never counts
 * toward the repeat limit. Claims from before the field are copyright.
 */
export const ClaimKind = z.enum(["copyright", "privacy"]);
export type ClaimKind = z.infer<typeof ClaimKind>;

export const Claim = z.object({
  id: Id,
  /** Added 2026-09-29. Absent from older responses: copyright. */
  kind: ClaimKind.default("copyright"),
  item: z.object({ id: Id, title: z.string() }),
  station: StationIdent,
  claimantName: z.string(),
  claimantRole: z.string().nullable(),
  /** Stations don't see the claimant's contact; it goes through Opencast. */
  workKind: z.string().nullable(),
  claimText: z.string(),
  rangeStartMs: Millis.nullable(),
  rangeEndMs: Millis.nullable(),
  swornStatement: z.boolean(),
  state: ClaimState,
  receivedAt: Timestamp,
  answerDueAt: Timestamp,
  daysToAnswer: z.number().int().nullable(),
  answer: z
    .object({ basis: z.string(), note: z.string().nullable(), attachmentUrl: z.string().nullable(), answeredAt: Timestamp, claimantReplyDueAt: Timestamp })
    .nullable(),
  takedowns: z.array(
    z.object({
      station: StationIdent,
      pulledAt: Timestamp,
      airingsReplaced: z.number().int(),
      replacedWith: z.string().nullable(),
      restoredAt: Timestamp.nullable()
    })
  )
});

export const Standing = z.object({
  status: z.enum(["good", "offers_paused"]),
  openClaims: z.number().int(),
  upheldLast12Months: z.number().int(),
  /** Placeholder: 3 upheld in a year pauses carriage offers. */
  threshold: z.number().int()
});

// ---- Added 2026-09-29: Network desk, Rights claims (desk-pages 01) ----

/** How many days ahead an unanswered claim counts as "answer due" on the desk. */
export const CLAIM_ANSWER_SOON_DAYS = 3;

/** Open: off air, or answered and waiting on the claimant. Closed: an outcome is recorded. */
export const ClaimPhase = z.enum(["open", "closed"]);
export type ClaimPhase = z.infer<typeof ClaimPhase>;

/**
 * One step of a claim's timeline, built from the claim, its answer and its takedowns. The desk
 * words each step; `at` is null for a step with no date (a privacy review).
 *  - received: the claim came in
 *  - off_air: pulled from the maker and every carrier at once
 *  - answer_due: the station answers or removes it by `at` (open copyright claims)
 *  - answered: the station answered (with a rights basis)
 *  - counter_notice: the answer went to the claimant with the station's legal name and contact
 *  - back_on_air: back in every log that had it (`at`: the latest restore)
 *  - reply_due: the claimant's time to take legal action ends at `at`
 *  - review: a privacy complaint, waiting on Opencast's review
 *  - removed (by the station), expired (no answer), upheld, withdrawn, restored: the outcome
 */
export const DeskClaimStep = z.object({
  step: z.enum(["received", "off_air", "answer_due", "answered", "counter_notice", "back_on_air", "reply_due", "review", "removed", "expired", "upheld", "withdrawn", "restored"]),
  state: z.enum(["done", "current", "future"]),
  at: Timestamp.nullable()
});

/** A station besides the maker that the claim reached. */
export const DeskClaimCarrier = z.object({
  station: StationIdent,
  /** Future airings taken off its log (0: it carries the program with nothing scheduled). */
  airingsPulled: z.number().int(),
  /** Null: nothing was on its log, but its agreement can't air the item while the claim is open. */
  pulledAt: Timestamp.nullable(),
  restoredAt: Timestamp.nullable()
});

/** A claim as the desk sees it: Opencast's side, the claimant's contact included. */
export const DeskClaim = Claim.extend({
  phase: ClaimPhase,
  /** Stations don't see it; the desk does, since claims go through Opencast. */
  claimantContact: z.string(),
  /** The maker's market (their primary channel's). */
  market: Market.nullable(),
  /**
   * What's next, for the list's Next column: the station's answer (`answer`, by `at`), the
   * claimant's time (`reply`, until `at`), Opencast's review of a privacy complaint (`review`, no
   * date), or nothing (closed).
   */
  next: z.object({ kind: z.enum(["answer", "reply", "review"]), at: Timestamp.nullable() }).nullable(),
  /** Every other station the claim reached: where it was pulled, and carriers under an agreement. */
  carriers: z.array(DeskClaimCarrier),
  timeline: z.array(DeskClaimStep),
  /** Where to write to the maker: its legal contact when it's an email, else its owner's email. */
  stationEmail: z.string().nullable(),
  /** The files behind the answer (the permission, the licence), freshly linked. */
  attachments: z.array(z.object({ fileName: z.string(), url: z.string() }))
});

/** A station with claims against it, and where it stands against the repeat limit. */
export const DeskClaimStation = z.object({
  station: StationIdent,
  open: z.number().int(),
  closed: z.number().int(),
  /** Upheld copyright claims closed in the last 12 months. Privacy complaints don't count. */
  upheldLast12Months: z.number().int(),
  /** near_limit: one upheld claim from the limit; offers_paused: at it or past it. */
  standing: z.enum(["good", "near_limit", "offers_paused"])
});

export const DeskClaims = z.object({
  claims: z.array(DeskClaim),
  stations: z.array(DeskClaimStation),
  stats: z.object({
    /** Claims in the open phase. */
    open: z.number().int(),
    /** Of those, off air now (not yet answered). */
    offAir: z.number().int(),
    /** Unanswered copyright claims due within `CLAIM_ANSWER_SOON_DAYS`. */
    answersDue: z.number().int(),
    /** Whole days to the soonest of those (0: today); null when none. */
    soonestAnswerDays: z.number().int().nullable(),
    /** Distinct carrier stations across open claims. */
    carryingStations: z.number().int(),
    /** Stations one upheld claim from the repeat limit, or at it. */
    nearRepeatLimit: z.number().int()
  }),
  /** From the rules registry (Settings, Rules). */
  rules: z.object({ repeatLimit: z.number().int(), answerDays: z.number().int(), counterNoticeBusinessDays: z.number().int() }),
  /** The caller can record outcomes (a rights reviewer or an admin). */
  canResolve: z.boolean()
});

/** The facts a claim's desk timeline is built from (the API's rows, or the desk's mocks). */
export interface ClaimFacts {
  kind: ClaimKind;
  state: ClaimState;
  receivedAt: string;
  answerDueAt: string;
  /** When the outcome was recorded (null while open or answered). */
  closedAt: string | null;
  answer: { answeredAt: string; claimantReplyDueAt: string } | null;
  takedowns: Array<{ pulledAt: string; restoredAt: string | null }>;
}

const CLOSED_STATES: ReadonlySet<ClaimState> = new Set(["upheld", "removed", "expired", "withdrawn", "restored"]);

export function claimPhase(state: ClaimState): ClaimPhase {
  return CLOSED_STATES.has(state) ? "closed" : "open";
}

/**
 * A claim's timeline for the desk (desk-pages 01). Copyright: received, off air everywhere at once,
 * then the station's answer (or its deadline), the counter-notice, back on air, and the claimant's
 * time to take legal action; or the outcome. A privacy complaint has no answer window: received,
 * off air, then Opencast's review or the outcome. Shared by the API and the desk's mocks.
 */
export function claimTimeline(f: ClaimFacts): DeskClaimStep[] {
  const pulledAt = f.takedowns.map((t) => t.pulledAt).sort()[0] ?? f.receivedAt;
  const restored = f.takedowns.map((t) => t.restoredAt).filter((v): v is string => !!v).sort();
  const lastRestore = restored.length ? restored[restored.length - 1]! : null;
  const steps: DeskClaimStep[] = [
    { step: "received", state: "done", at: f.receivedAt },
    { step: "off_air", state: "done", at: pulledAt }
  ];
  const outcome = (step: DeskClaimStep["step"], at = f.closedAt) => steps.push({ step, state: "done", at });
  const backAfter = () => {
    if (f.state === "withdrawn" || f.state === "restored") steps.push({ step: "back_on_air", state: "done", at: lastRestore ?? f.closedAt });
  };
  if (f.kind === "privacy") {
    if (f.state === "open") steps.push({ step: "review", state: "current", at: null });
    else if (f.state !== "answered") {
      outcome(f.state);
      backAfter();
    }
    return steps;
  }
  if (!f.answer) {
    if (f.state === "open") steps.push({ step: "answer_due", state: "current", at: f.answerDueAt });
    else if (f.state === "expired") outcome("expired", f.closedAt ?? f.answerDueAt);
    else if (f.state !== "answered") {
      outcome(f.state);
      backAfter();
    }
    return steps;
  }
  // Answered, it airs again at once: the station's answer is the counter-notice.
  steps.push({ step: "answered", state: "done", at: f.answer.answeredAt });
  steps.push({ step: "counter_notice", state: "done", at: f.answer.answeredAt });
  steps.push({ step: "back_on_air", state: "done", at: f.answer.answeredAt });
  if (f.state === "answered") steps.push({ step: "reply_due", state: "current", at: f.answer.claimantReplyDueAt });
  else if (f.state !== "open") outcome(f.state);
  return steps;
}

/** What's next, for the desk list's Next column. */
export function claimNext(f: Pick<ClaimFacts, "kind" | "state" | "answerDueAt" | "answer">): DeskClaim["next"] {
  if (CLOSED_STATES.has(f.state)) return null;
  if (f.kind === "privacy") return { kind: "review", at: null };
  if (f.state === "answered" && f.answer) return { kind: "reply", at: f.answer.claimantReplyDueAt };
  return { kind: "answer", at: f.answerDueAt };
}

/** Where a station stands against the repeat limit (copyright claims upheld in 12 months). */
export function repeatStanding(upheld: number, limit: number): DeskClaimStation["standing"] {
  if (upheld >= limit) return "offers_paused";
  return limit > 1 && upheld === limit - 1 ? "near_limit" : "good";
}

export const trustApi = {
  fileClaim: endpoint({
    method: "POST",
    path: "/claims",
    auth: "public",
    summary: "A rights holder files a claim. The item goes off air at once, everywhere it's carried.",
    body: z.object({
      itemId: Id,
      claimantName: z.string().min(1).max(200),
      claimantRole: z.string().max(200).optional(),
      claimantContact: z.string().min(3).max(200),
      workKind: z.string().max(200).optional(),
      claimText: z.string().min(1).max(5000),
      rangeStartMs: Millis.optional(),
      rangeEndMs: Millis.optional(),
      swornStatement: z.literal(true),
      /** Added 2026-09-29: a privacy complaint instead of a copyright claim (default copyright). */
      kind: ClaimKind.optional()
    }),
    response: z.object({ claimId: Id, answerDueAt: Timestamp }),
    status: 201
  }),
  listClaims: endpoint({
    method: "GET",
    path: "/stations/:stationId/claims",
    auth: "user",
    summary: "Claims against this station's items, and its standing",
    params: z.object({ stationId: Id }),
    response: z.object({ claims: z.array(Claim), standing: Standing })
  }),
  answerClaim: endpoint({
    method: "POST",
    path: "/claims/:claimId/answer",
    auth: "user",
    summary: "Answer with a rights basis and an attestation. The item airs again; the claimant has 10 business days to respond.",
    params: z.object({ claimId: Id }),
    body: z.object({
      basis: z.enum(["made_it", "owner_permission", "public_domain"]),
      note: z.string().max(2000).optional(),
      attachmentUrl: z.string().optional(),
      attest: z.literal(true)
    }),
    response: Claim
  }),
  removeClaimedItem: endpoint({
    method: "POST",
    path: "/claims/:claimId/remove",
    auth: "user",
    summary: "Take the item down instead of answering",
    params: z.object({ claimId: Id }),
    response: Claim
  }),
  resolveClaim: endpoint({
    method: "POST",
    path: "/claims/:claimId/resolve",
    auth: "desk",
    summary:
      "Opencast records the outcome: upheld, withdrawn or restored. A rights reviewer or an admin (403 `desk_role` otherwise; `admin` before 2026-09-29). 409 `not_open` once the claim is closed.",
    params: z.object({ claimId: Id }),
    body: z.object({ outcome: z.enum(["upheld", "withdrawn", "restored"]) }),
    response: Claim
  }),

  // ---- Added 2026-09-29: B6 ----

  attachToClaim: endpoint({
    method: "POST",
    path: "/claims/:claimId/attachments",
    auth: "user",
    summary:
      "B6: upload the permission or licence that backs an answer (owner, operator; a PDF, image or text file up to 20 MB). Returns the `attachmentUrl` `answerClaim` takes. 409 `not_open` once the claim is answered or closed; 422 `wrong_file_type`, `too_big`.",
    params: z.object({ claimId: Id }),
    multipart: true,
    body: z.object({}),
    response: z.object({ attachmentUrl: z.string(), fileName: z.string() }),
    status: 201
  }),

  // ---- Added 2026-09-29: Network desk, Rights claims ----

  listDeskClaims: endpoint({
    method: "GET",
    path: "/admin/claims",
    auth: "desk",
    summary:
      "Every claim on every station, newest first, with each one's timeline and carriers, the stations with claims and the page's figures. Admins and rights reviewers see every market; a market lead sees their own markets' (and only theirs with `marketId`: 403 `desk_role` for another).",
    query: z.object({ marketId: Id.optional() }),
    response: DeskClaims
  })
};

export type Claim = z.infer<typeof Claim>;
export type Standing = z.infer<typeof Standing>;
export type DeskClaim = z.infer<typeof DeskClaim>;
export type DeskClaimStep = z.infer<typeof DeskClaimStep>;
export type DeskClaimCarrier = z.infer<typeof DeskClaimCarrier>;
export type DeskClaimStation = z.infer<typeof DeskClaimStation>;
export type DeskClaims = z.infer<typeof DeskClaims>;
