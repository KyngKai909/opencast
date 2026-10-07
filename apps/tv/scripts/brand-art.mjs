// The brand, drawn for the TV apps' art (android-art.mjs, tizen-art.mjs): TV mode's ground, the
// mark and the lockup, rendered with the installed Chrome (playwright-core) and the self-hosted
// Archivo.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const font = readFileSync(require.resolve("@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2")).toString("base64");

// TV mode's ground, ink and tally (packages/ui tokens.css, data-ground="tv").
export const GROUND = "#0F1830";
const INK = "#ECE9E1";
const TALLY = "#D9301F";
const mark = `<svg viewBox="0 0 62 50" style="width:1.24em;height:1em;flex:none"><rect x="3.5" y="3.5" width="55" height="43" rx="11" fill="none" stroke="${INK}" stroke-width="7"/><circle cx="43" cy="18" r="5.5" fill="${TALLY}"/></svg>`;

/** The lockup as in the apps' headers (Lockup size="hero"), `fill` of the width, centred. */
export const lockupPage = (w, h, fill) => `<!doctype html><style>
@font-face { font-family: Archivo; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 100 900; font-stretch: 62% 125%; }
html, body { margin: 0; width: ${w}px; height: ${h}px; background: ${GROUND}; overflow: hidden; }
body { display: flex; align-items: center; justify-content: center; }
.l { display: inline-flex; align-items: center; gap: .42em; font: 800 100px/1.1 Archivo; font-stretch: 125%; letter-spacing: -.035em; color: ${INK}; white-space: nowrap; }
</style><span class="l">${mark}<span>opencast</span></span>
<script>document.fonts.ready.then(() => { const l = document.querySelector(".l"); l.style.fontSize = (100 * ${w * fill} / l.getBoundingClientRect().width) + "px"; document.title = "ready"; });</script>`;

export const markPage = (s) => `<!doctype html><style>html, body { margin: 0; width: ${s}px; height: ${s}px; background: ${GROUND}; display: flex; align-items: center; justify-content: center; font-size: ${s * 0.36}px; }</style>${mark}<script>document.title = "ready"</script>`;

/** Opens Chrome: `shot` renders a page to a PNG of w×h; `close` when done. */
export async function artBrowser() {
  const browser = await chromium.launch({ channel: "chrome" });
  async function shot(html, w, h) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.setContent(html);
    await page.waitForFunction(() => document.title === "ready");
    const png = await page.screenshot({ type: "png" });
    await page.close();
    return png;
  }
  return { shot, close: () => browser.close() };
}
