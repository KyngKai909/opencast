// Draws the Android TV app's art from the brand, into android/app/src/main/res:
// - the leanback banner (320×180, drawable-xhdpi/banner.png): the lockup on the dark ground,
// - the splash screens (the lockup, smaller, on the dark ground; landscape only),
// - the launcher icons (the mark on the dark ground; the adaptive icon's background colour).
// Renders with the installed Chrome (playwright-core) and the self-hosted Archivo, then sizes
// with sharp. Run again when the brand changes: node scripts/android-art.mjs

import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import sharp from "sharp";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const res = here("../android/app/src/main/res/");
const require = createRequire(import.meta.url);
const font = readFileSync(require.resolve("@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2")).toString("base64");

// TV mode's ground, ink and tally (packages/ui tokens.css, data-ground="tv").
const GROUND = "#0F1830";
const INK = "#ECE9E1";
const TALLY = "#D9301F";
const mark = `<svg viewBox="0 0 62 50" style="width:1.24em;height:1em;flex:none"><rect x="3.5" y="3.5" width="55" height="43" rx="11" fill="none" stroke="${INK}" stroke-width="7"/><circle cx="43" cy="18" r="5.5" fill="${TALLY}"/></svg>`;

/** The lockup as in the apps' headers (Lockup size="hero"), `fill` of the width, centred. */
const lockupPage = (w, h, fill) => `<!doctype html><style>
@font-face { font-family: Archivo; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 100 900; font-stretch: 62% 125%; }
html, body { margin: 0; width: ${w}px; height: ${h}px; background: ${GROUND}; overflow: hidden; }
body { display: flex; align-items: center; justify-content: center; }
.l { display: inline-flex; align-items: center; gap: .42em; font: 800 100px/1.1 Archivo; font-stretch: 125%; letter-spacing: -.035em; color: ${INK}; white-space: nowrap; }
</style><span class="l">${mark}<span>opencast</span></span>
<script>document.fonts.ready.then(() => { const l = document.querySelector(".l"); l.style.fontSize = (100 * ${w * fill} / l.getBoundingClientRect().width) + "px"; document.title = "ready"; });</script>`;

const markPage = (s) => `<!doctype html><style>html, body { margin: 0; width: ${s}px; height: ${s}px; background: ${GROUND}; display: flex; align-items: center; justify-content: center; font-size: ${s * 0.36}px; }</style>${mark}<script>document.title = "ready"</script>`;

const browser = await chromium.launch({ channel: "chrome" });
async function shot(html, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.waitForFunction(() => document.title === "ready");
  const png = await page.screenshot({ type: "png" });
  await page.close();
  return png;
}

// The banner: Android TV's launcher row, 320×180 at xhdpi.
writeFileSync(res + "drawable-xhdpi/banner.png", await shot(lockupPage(320, 180, 0.78), 320, 180));

// Splash screens: landscape only (the app is locked to landscape); the portrait ones go.
for (const dir of readdirSync(res)) {
  if (dir.startsWith("drawable-port-")) rmSync(res + dir, { recursive: true });
}
for (const dir of ["drawable", ...readdirSync(res).filter((d) => d.startsWith("drawable-land-"))]) {
  const file = res + dir + "/splash.png";
  const { width, height } = await sharp(file).metadata();
  writeFileSync(file, await shot(lockupPage(width, height, 0.36), width, height));
}

// Launcher icons: the mark on the ground (legacy square and round), and the adaptive foreground
// (the mark alone in the middle 66%, over the ground colour).
const big = await shot(markPage(432), 432, 432);
for (const dir of readdirSync(res).filter((d) => d.startsWith("mipmap-") && d !== "mipmap-anydpi-v26")) {
  for (const name of ["ic_launcher", "ic_launcher_round", "ic_launcher_foreground"]) {
    const file = `${res}${dir}/${name}.png`;
    const { width } = await sharp(file).metadata();
    let img = sharp(big).resize(width, width);
    if (name === "ic_launcher_round") {
      const circle = Buffer.from(`<svg width="${width}" height="${width}"><circle cx="${width / 2}" cy="${width / 2}" r="${width / 2}"/></svg>`);
      img = img.composite([{ input: circle, blend: "dest-in" }]);
    }
    writeFileSync(file, await img.png().toBuffer());
  }
}
writeFileSync(res + "values/ic_launcher_background.xml", `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${GROUND}</color>\n</resources>\n`);

await browser.close();
console.log("Android art drawn.");
