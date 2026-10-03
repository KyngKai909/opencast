// A244: a station's programming blocks on its page, after its schedule (station-pages, no frame
// draws it): a card per block with its logo, name, description, "Saturdays, 9:00 pm to 1:00 am" and
// "Next: Sat Oct 10, Saturday Reel and Late Crate". Absent from an API before it, and for external
// and claimable stations: nothing is drawn.

import type { CSSProperties } from "react";
import type { StationPage } from "@opencast/contracts";
import { SecTop } from "./StationSide";

type PageBlock = NonNullable<StationPage["blocks"]>[number];

/** "Saturday Reel and Late Crate", "A, B and C". */
export function programList(titles: string[]): string {
  if (titles.length <= 1) return titles[0] ?? "";
  return `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
}

/** "Next: Sat Oct 10, Saturday Reel and Late Crate" (the day in the market's time zone). */
export function nextLine(b: Pick<PageBlock, "next" | "programs">, timeZone: string): string | null {
  if (!b.next) return null;
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(new Date(b.next)).replace(",", "");
  return `Next: ${day}${b.programs.length ? `, ${programList(b.programs)}` : ""}`;
}

export function StationBlocks({ blocks, timeZone }: { blocks: PageBlock[] | undefined; timeZone: string }) {
  if (!blocks?.length) return null;
  return (
    <section aria-label="Blocks">
      <SecTop title="Blocks" />
      <div className="vw-blocks">
        {blocks.map((b) => (
          <article key={b.id} className="vw-block" style={b.colour ? ({ ["--vw-block" as string]: b.colour } as CSSProperties) : undefined} aria-label={b.name}>
            {b.logoUrl ? <img className="vw-block__logo" src={b.logoUrl} alt="" /> : <span className="vw-block__logo" aria-hidden="true">{b.name.slice(0, 1)}</span>}
            <div>
              <h3>{b.name}</h3>
              {b.description && <p>{b.description}</p>}
              {b.schedule && <p className="vw-block__when">{b.schedule}</p>}
              {nextLine(b, timeZone) && <p>{nextLine(b, timeZone)}</p>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
