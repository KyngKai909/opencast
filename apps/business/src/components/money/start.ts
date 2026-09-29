// Getting started's words and small rules (biz-funding 01.1): the website as a URL, the town in a
// typed address for the preview, and how many stations can carry a category, said.

import type { CategoryReach } from "@opencast/contracts";
import { categoryInSentence } from "./categories";

/** "orangestreet.example" → "https://orangestreet.example"; blank stays blank. */
export function websiteUrl(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** The town in a typed address, for the preview before it's looked up: "204 Orange St, Redlands, CA 92373" → "Redlands". */
export function townOf(address: string): string {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts[1]! : "";
}

/** The line under the bar, and its headline, for how many stations carry a category. */
export function reachWords(r: CategoryReach): { title: string; detail: string } {
  const cat = categoryInSentence(r.category);
  const of = `${r.reached} of ${r.total} stations in the ${r.marketName}.`;
  if (r.reached >= r.total) {
    const like = r.sometimesBlocked.filter((c) => c !== r.category.toLowerCase());
    return {
      title: `Every station can carry ${cat}`,
      detail: like.length ? `${of} Some stations don't carry categories like ${like.join(" or ")}; yours isn't one of them.` : of
    };
  }
  if (r.reached <= 0) return { title: `No station in the ${r.marketName} carries ${cat} yet`, detail: of };
  const names = r.blockedBy.length > 1 ? `${r.blockedBy.slice(0, -1).join(", ")} and ${r.blockedBy.at(-1)}` : r.blockedBy[0];
  return { title: `${r.reached} of ${r.total} stations can carry ${cat}`, detail: `${of} ${names} ${r.blockedBy.length > 1 ? "don't" : "doesn't"} carry it.` };
}
