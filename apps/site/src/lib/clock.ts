// The site's clock. The stations are in Southern California, so "now" is Pacific time wherever
// the visitor is (the reference used the browser's zone). Tests freeze it with Playwright's clock.

const ZONE = "America/Los_Angeles";
const parts = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });

/** Minutes after midnight, Pacific, with seconds as a fraction. */
export function nowMinutes(at: Date = new Date()): number {
  const p = Object.fromEntries(parts.formatToParts(at).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60;
}

/** A 12-hour clock: 0 → "12 am", 494 → "8:14 am", 1214 → "8:14 pm" (`clock()` in the reference). */
export function clock(min: number): string {
  min = ((min % 1440) + 1440) % 1440;
  let h = Math.floor(min / 60);
  let m = Math.round(min % 60);
  if (m === 60) {
    h = (h + 1) % 24;
    m = 0;
  }
  return (h % 12 === 0 ? 12 : h % 12) + (m ? ":" + (m < 10 ? "0" : "") + m : "") + (h < 12 ? " am" : " pm");
}
