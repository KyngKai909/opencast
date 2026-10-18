// The Contact page's desks and copy (SITE-SPEC §7). New copy, listed in docs/site/new-copy.md.
// Desk addresses are open (docs/site/open-questions.md O2): they're built from one domain, which
// PUBLIC_CONTACT_DOMAIN can change.
import type { Qa } from "../components/Faq.astro";

const DOMAIN = (import.meta.env.PUBLIC_CONTACT_DOMAIN as string | undefined)?.trim() || "usedial.com";

export type DeskId = "stations" | "makers" | "advertisers" | "public" | "press" | "rights";

export interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "url" | "radio";
  /** Choices for a radio field. */
  options?: readonly (readonly [string, string])[];
  autocomplete?: string;
  hint?: string;
}

export interface Desk {
  id: DeskId;
  /** The jack's label. */
  jack: string;
  /** "Stations desk" */
  name: string;
  email: string;
  /** What it handles, one line. */
  handles: string;
  /** "usually within a day" */
  answers: string;
  c: string;
  fields: readonly FieldDef[];
}

const at = (box: string) => `${box}@${DOMAIN}`;

export const DESKS: readonly Desk[] = [
  { id: "stations", jack: "Stations", name: "Stations desk", email: at("stations"), handles: "Claiming a number, master control, relays and your bill.", answers: "usually within a day", c: "#C04A9E", fields: [
    { name: "number", label: "Number", autocomplete: "off", hint: "The number you picked, if you have one" },
    { name: "callSign", label: "Call sign", autocomplete: "off" }
  ] },
  { id: "makers", jack: "Makers", name: "Makers desk", email: at("makers"), handles: "Offering a show, carriage terms and getting paid when it airs.", answers: "usually within a day", c: "#EBA03A", fields: [
    { name: "link", label: "Link to a show or channel", type: "url", autocomplete: "url" }
  ] },
  { id: "advertisers", jack: "Advertisers", name: "Advertisers desk", email: at("spots"), handles: "Spots, sponsorships and spots made for you.", answers: "usually within a few hours", c: "#E0583A", fields: [
    { name: "business", label: "Business name", autocomplete: "organization" },
    { name: "website", label: "Website", type: "url", autocomplete: "url" },
    { name: "area", label: "Area served", hint: "A town, a county, or online" }
  ] },
  { id: "public", jack: "Public channels", name: "Public channels desk", email: at("public"), handles: "City meetings, public access, schools and libraries on the dial.", answers: "usually within two days", c: "#2F9A72", fields: [
    { name: "place", label: "City, county, district or library" },
    { name: "channel", label: "Your channel today", hint: "A cable channel, a stream, or none yet" }
  ] },
  { id: "press", jack: "Press", name: "Press desk", email: at("press"), handles: "Interviews, pictures and the facts behind a story.", answers: "usually the same day", c: "#5B7BE0", fields: [
    { name: "outlet", label: "Outlet", autocomplete: "organization" }
  ] },
  { id: "rights", jack: "Rights", name: "Rights desk", email: at("rights"), handles: "Music, film and footage on the air, and claims.", answers: "usually within a day", c: "#3478C6", fields: [
    { name: "program", label: "Program or station" },
    { name: "work", label: "Link to the work", type: "url", autocomplete: "url" },
    { name: "role", label: "You're writing because", type: "radio", options: [["holder", "I hold the rights"], ["reporter", "I'm reporting a problem"]] }
  ] }
];

export const deskById = (id: string | null | undefined) => DESKS.find((d) => d.id === id);

/** Desks are open 9 am to 6 pm Pacific. */
export const OPEN_FROM = 9, OPEN_TILL = 18;

/** Whether a desk is open at `at`, by the hour in Los Angeles. */
export function isOpen(at: Date = new Date()): boolean {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }).format(at));
  return h >= OPEN_FROM && h < OPEN_TILL;
}

export const HOURS_OPEN = "Open";
export const HOURS_CLOSED = "Closed till 9 am";

/** For a formal takedown (Rights). The route is for later, with a lawyer (open-questions O4). */
export const TAKEDOWN_URL = "/rights/takedown";

export const CONTACT_FAQ: Qa[] = [
  { q: "How soon does someone answer?", a: "Each desk says how long it usually takes. A message that lands between 9 am and 6 pm Pacific is read that day; one that lands overnight is read first thing in the morning." },
  { q: "Can I call instead?", a: "Not yet. Every desk answers in writing, and the person who reads your message is the one who writes back." },
  { q: "How do I report a program?", a: "Write to the Rights desk with what aired, on which station and when. A claim takes the program off every station while it's sorted out, and the channel keeps running. For a formal takedown, use the takedown form." },
  { q: "Do I need to write before I start a station?", a: "No. Claim a number on <a href=\"/run\">Run a station</a> and your first schedule can be on the dial in an evening. Write to the Stations desk if you get stuck." }
];
