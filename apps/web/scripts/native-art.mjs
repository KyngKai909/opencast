// Draws the iPhone and Android apps' icons and launch screens from the PWA's mark
// (public/icons/icon.svg), in the PWA icon's colours: the mark on the dark ground. The PWA's own
// icons stop at 512 px and the App Store needs 1024, so they're drawn again rather than scaled up.
// Run again when the brand changes: node scripts/native-art.mjs

import { readdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const ios = here("../ios/App/App/Assets.xcassets/");
const res = here("../android/app/src/main/res/");

// The PWA icon's colours (public/icons/icon-512.png; packages/ui's dark ground, ink and tally).
const GROUND = "#0F1830";
const INK = "#ECE9E1";
const TALLY = "#D9301F";

/** The mark (62×50), `width` px wide, centred in a w×h canvas; on the ground unless `clear`. */
function art(w, h, width, { clear = false, round = false } = {}) {
  const s = width / 62;
  const x = (w - 62 * s) / 2;
  const y = (h - 50 * s) / 2;
  const bg = clear ? "" : round ? `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2}" fill="${GROUND}"/>` : `<rect width="${w}" height="${h}" fill="${GROUND}"/>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg}
<g transform="translate(${x} ${y}) scale(${s})"><rect x="3.5" y="3.5" width="55" height="43" rx="11" fill="none" stroke="${INK}" stroke-width="7"/><circle cx="43" cy="18" r="5.5" fill="${TALLY}"/></g></svg>`);
}

const png = (svg) => sharp(svg).png().toBuffer();

// iOS: the App Store icon (the mark at 64% of the width, as the PWA icon has it), and the launch
// screen's image (a small mark on the ground; the storyboard fills the rest with it, aspect fill).
writeFileSync(ios + "AppIcon.appiconset/AppIcon-512@2x.png", await sharp(art(1024, 1024, 655)).flatten({ background: GROUND }).png().toBuffer());
for (const f of readdirSync(ios + "Splash.imageset").filter((n) => n.endsWith(".png"))) {
  writeFileSync(ios + "Splash.imageset/" + f, await png(art(2732, 2732, 360)));
}

// Android launcher icons: legacy square and round (48 dp), and the adaptive foreground (108 dp,
// the mark inside the middle 66 dp safe zone) over the ground colour.
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(densities)) {
  const dir = res + `mipmap-${d}/`;
  const icon = Math.round(48 * k);
  const fg = Math.round(108 * k);
  writeFileSync(dir + "ic_launcher.png", await png(art(icon, icon, icon * 0.64)));
  writeFileSync(dir + "ic_launcher_round.png", await png(art(icon, icon, icon * 0.6, { round: true })));
  writeFileSync(dir + "ic_launcher_foreground.png", await png(art(fg, fg, 58 * k, { clear: true })));
}
writeFileSync(
  res + "values/ic_launcher_background.xml",
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${GROUND}</color>\n</resources>\n`
);

// Android launch screens: every splash.png at its own size, the mark at a quarter of the short side.
for (const dir of readdirSync(res).filter((n) => n.startsWith("drawable"))) {
  const file = res + dir + "/splash.png";
  if (!existsSync(file)) continue;
  const { width, height } = await sharp(file).metadata();
  writeFileSync(file, await png(art(width, height, Math.min(width, height) * 0.25)));
}

console.log("Drew the iOS and Android icons and launch screens.");
