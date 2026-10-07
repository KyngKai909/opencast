// Draws the Android TV app's art from the brand, into android/app/src/main/res:
// - the leanback banner (320×180, drawable-xhdpi/banner.png): the lockup on the dark ground,
// - the splash screens (the lockup, smaller, on the dark ground; landscape only),
// - the launcher icons (the mark on the dark ground; the adaptive icon's background colour).
// Renders the brand (brand-art.mjs) with the installed Chrome, then sizes with sharp. Run again
// when the brand changes: node scripts/android-art.mjs

import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { artBrowser, GROUND, lockupPage, markPage } from "./brand-art.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const res = here("../android/app/src/main/res/");
const { shot, close } = await artBrowser();

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

await close();
console.log("Android art drawn.");
