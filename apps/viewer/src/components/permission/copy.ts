// Every word on the creator's permission page, in one versioned module (open question 15: the page
// is a licence in plain words, and a lawyer reviews it before the first creator sees it). The
// version goes with the answer (N4), so a yes records which words it was given to.
//
// The frame's words (network-desk 06.1, 06.2) are final; the rest is new copy, listed in
// docs/apps/new-copy.md.

export const PERMISSION_WORDING_VERSION = "2026-09-28.draft-1";

export const PERMISSION_COPY = {
  title: (noun: string, market: string) => `A station of your ${noun}, on the ${market} dial.`,
  lede: "Here's exactly what you'd be agreeing to. Nothing happens until you say yes.",
  worksTitle: "These works only",
  works: (included: string, platform: string | null, leftOut: string | null) => `${included}${platform ? ` from your ${platform}` : ""}.${leftOut ? ` Not ${leftOut}` : ""}`.replace(/\.$/, ""),
  stationTitle: (band: "tv" | "radio") => (band === "radio" ? "A radio station, run for you" : "A TV station, run for you"),
  station: (noun: string, when: string, name: string) => `Your ${noun} ${when}, other programming in between. Labelled "Run by Opencast for ${name}"`,
  moneyTitle: "The money is yours",
  money: "Everything it earns is held in escrow for you, in a public contract that can only pay you, until you claim it",
  stopTitle: "Stop any time",
  stop: "One tap takes it off the dial within a day, and we pay out what it earned",
  yes: "Yes, go ahead",
  no: "No thanks",

  // After yes (06.2)
  thanks: "Thanks. We'll set it up.",
  thanksLede: "Your station should sign on within a week. We'll send you the channel and call sign before it does.",
  thanksLedeStation: (channel: string, callSign: string) => `Your station is ${channel} ${callSign}. The call sign is yours to keep.`,
  saidYesTitle: "What you said yes to",
  saidYes: (works: number, when: string) => `${works} ${works === 1 ? "work" : "works"}, on ${when}. We've emailed you a copy`,
  changedTitle: "Changed your mind?",
  changed: "This link works to stop it at any time",
  stopButton: "Stop",
  claimTitle: "Want to run it yourself from day one?",
  claim: "Claim it now and skip the team-run part",
  claimButton: "Claim now",

  // New: states the frames don't draw
  noTitle: "Understood. We won't ask again.",
  noLede: "Nothing of yours goes on the air. If you change your mind, write to us.",
  stopping: "Stopping it.",
  stoppedTitle: "Stopped.",
  stoppedLede: "It comes off the dial within a day. What it earned is yours: once you sign in and we've checked it's you, it's paid to you.",
  claimStartedTitle: "Your claim has started",
  claimStarted: "We check it's you, then the station is yours to run from master control",
  openControl: "Open master control",
  claimSignIn: { label: "claim your station", finish: "Claim it and go back", backTo: "your permission page" },
  badLinkTitle: "This link doesn't work.",
  badLinkLede: "It may be mistyped, or replaced by a newer one. Write to us and we'll send it again.",
  failed: "That didn't go through. Try again.",
  documentTitle: "Your station on Opencast"
} as const;
