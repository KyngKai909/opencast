// The site's clock: the visitor's own time, as the reference has it (the guide says "Times in
// your time zone"). Tests freeze it with a fixed Date and a time zone.

/** Minutes after midnight, local time, with seconds as a fraction. */
export function nowMinutes(at: Date = new Date()): number {
  return at.getHours() * 60 + at.getMinutes() + at.getSeconds() / 60;
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
