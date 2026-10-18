// Each page's title (SITE-SPEC §1), description and the headline its Open Graph image carries.
// Descriptions are new copy (docs/site/new-copy.md); headlines are the references'.
import { ROUTES, type PageKey } from "./links";

export interface PageMeta {
  path: string;
  title: string;
  description: string;
  /** The headline on the OG image, and its dim second line. */
  og: [string, string?];
}

export const PAGES: Record<PageKey, PageMeta> = {
  home: {
    path: ROUTES.home,
    title: "Dial: Anyone can run a channel",
    description: "Dial is free TV and radio from local stations, run by the people who make it. Flip it on. Or claim a number and run a channel of your own.",
    og: ["Anyone can run a channel."]
  },
  run: {
    path: ROUTES.run,
    title: "Run a Station | Dial",
    description: "A number, a call sign and master control. Build a real schedule with breaks and station IDs, go live inside it, and pay only for what it costs.",
    og: ["Run it like a station.", "Not a loop."]
  },
  syndication: {
    path: ROUTES.syndication,
    title: "Syndication Market | Dial",
    description: "List a show once and let stations across the network carry it, for a revenue share, cash or free. Every agreement is on the record.",
    og: ["Make it once.", "Air it everywhere."]
  },
  spots: {
    path: ROUTES.spots,
    title: "Spot Market | Dial",
    description: "Put your business in the breaks of local stations. Set a rate and a budget, and pay for the people who were tuned in.",
    og: ["Be in the break.", "Pay for who watched."]
  },
  network: {
    path: ROUTES.network,
    title: "The Network | Dial",
    description: "How Dial works: every station gets a number and a call sign, the money is split in the open, and the rules are the same for everyone.",
    og: ["A network,", "not a feed."]
  },
  contact: {
    path: ROUTES.contact,
    title: "Contact | Dial",
    description: "Talk to a person at Dial: the stations, makers, advertisers, public channels, press and rights desks.",
    og: ["Talk to a person.", "We pick up."]
  }
};

export const pageUrl = (path: string) => (path === "/" ? "https://usedial.com/" : `https://usedial.com${path}`);
