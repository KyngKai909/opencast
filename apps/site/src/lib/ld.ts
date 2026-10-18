// Structured data (schema.org JSON-LD): the Organization on Home and an FAQPage wherever there's
// an FAQ. Built from the same lists the pages show.
import type { Qa } from "../components/Faq.astro";

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

export function faqPage(items: readonly Qa[]): string {
  return JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((q) => ({ "@type": "Question", name: text(q.q), acceptedAnswer: { "@type": "Answer", text: text(q.a) } })) });
}

export function organization(): string {
  return JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", name: "Dial", url: "https://usedial.com/", logo: "https://usedial.com/icon-512.png", description: "Free TV and radio from local stations, run by the people who make it.", areaServed: "Southern California" });
}
