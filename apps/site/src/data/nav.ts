// The header's pages, in order: the rail on desktop, the menu on tablet and phone
// (chrome/header.html). Copy is the reference's.
import { ROUTES, type PageKey } from "./links";

export interface NavItem {
  key: Exclude<PageKey, "home">;
  href: string;
  ix: string;
  label: string;
  /** The menu's second line. */
  sub: string;
}

export const NAV: readonly NavItem[] = [
  { key: "run", href: ROUTES.run, ix: "01", label: "Run a station", sub: "For creators and groups" },
  { key: "syndication", href: ROUTES.syndication, ix: "02", label: "Syndication", sub: "Carry shows, or offer yours" },
  { key: "spots", href: ROUTES.spots, ix: "03", label: "Spot market", sub: "For advertisers, near and far" },
  { key: "network", href: ROUTES.network, ix: "04", label: "The network", sub: "How it's run" },
  { key: "contact", href: ROUTES.contact, ix: "05", label: "Contact", sub: "A person answers" }
];
