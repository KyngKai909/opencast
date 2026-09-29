// About this TV: what kind of TV this is, from what the browser says about itself.

/** "Fire TV", "Google TV", "Android TV", "TV browser" (LG, Samsung and the like) or "Web browser". */
export function deviceKind(ua: string): string {
  if (/\bAFT[A-Z0-9]/.test(ua) || /Fire ?TV/i.test(ua)) return "Fire TV";
  if (/Google ?TV|GoogleTV/i.test(ua)) return "Google TV";
  if (/Android/i.test(ua) && /\bTV\b|BRAVIA|SMART-TV|Leanback|AndroidTV/i.test(ua)) return "Android TV";
  if (/Web0S|webOS|Tizen|SMART-TV|SmartTV|HbbTV|NetCast|VIDAA/i.test(ua)) return "TV browser";
  return "Web browser";
}

/** The Opencast app (the Capacitor build, Phase 8) or TV mode in a browser. */
export function deviceLine(ua: string, isApp: boolean): string {
  const kind = deviceKind(ua);
  if (!isApp) return kind;
  return kind === "Web browser" || kind === "TV browser" ? "Opencast app" : `Opencast app on ${kind}`;
}
