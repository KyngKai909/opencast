// Just enough iCalendar to read a city's agenda calendar: each VEVENT's UID,
// SUMMARY, DTSTART and DTEND.

export interface CalendarEvent {
  uid: string | null;
  summary: string;
  start: Date;
  end: Date | null;
}

function unfold(text: string): string[] {
  // Long lines continue on the next line, which starts with a space or tab.
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
}

function parseDate(value: string, params: string): Date | null {
  const date = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!date) return null;
  const [, y, mo, d, h = "00", mi = "00", s = "00", z] = date;
  if (z || !params.includes("TZID")) {
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  }
  // Local to the calendar's zone: resolve it with Intl.
  const tz = /TZID=([^;:]+)/.exec(params)?.[1];
  const guess = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  if (!tz) return guess;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asLocal = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}

export function parseIcs(text: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  let current: Partial<CalendarEvent> | null = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") current = {};
    else if (line === "END:VEVENT") {
      if (current?.summary && current.start) events.push({ uid: current.uid ?? null, summary: current.summary, start: current.start, end: current.end ?? null });
      current = null;
    } else if (current) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const [name, ...params] = line.slice(0, colon).split(";");
      const value = line.slice(colon + 1);
      if (name === "UID") current.uid = value;
      if (name === "SUMMARY") current.summary = value.replace(/\\,/g, ",").replace(/\;/g, ";").replace(/\\n/gi, " ").trim();
      if (name === "DTSTART") current.start = parseDate(value, params.join(";")) ?? undefined;
      if (name === "DTEND") current.end = parseDate(value, params.join(";"));
    }
  }
  return events;
}
