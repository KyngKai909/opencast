// Compares built components with the reference frames they come from.
//
//   npm run compare -w @opencast/gallery                 every pair in scripts/pairs/*.json
//   npm run compare -w @opencast/gallery -- tally button only those ids (or group names)
//   npm run compare -w @opencast/gallery -- --shots      also save side-by-side screenshots
//
// For each pair it opens the gallery page (served by Vite, started here) and the reference file,
// on the same ground, finds one element in each, and reports every computed-style property
// that differs. Screenshots go to apps/gallery/compare-out/ (git-ignored).
//
// Uses the system Chrome (playwright-core, channel "chrome"): nothing is downloaded.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const galleryRoot = path.resolve(here, "..");
const referenceRoot = path.resolve(galleryRoot, "../../docs/reference");
const outDir = path.join(galleryRoot, "compare-out");

const args = process.argv.slice(2);
const shots = args.includes("--shots");
const only = args.filter((a) => !a.startsWith("--"));
// One file per component group (scripts/pairs/<group>.json), so groups can be worked on apart.
const pairsDir = path.join(here, "pairs");
const pairs = fs
  .readdirSync(pairsDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(pairsDir, f), "utf8")).map((p) => ({ ...p, group: f.replace(/\.json$/, "") })))
  .filter((p) => !only.length || only.includes(p.id) || only.includes(p.group));

const PROPS = [
  "font-family", "font-size", "font-weight", "font-stretch", "font-style", "line-height", "letter-spacing", "text-transform",
  "color", "background-color", "background-image",
  "border-top-width", "border-top-style", "border-top-color", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "height", "min-height", "gap", "column-gap", "row-gap", "display", "align-items", "justify-content",
  "box-shadow", "opacity", "text-align", "white-space"
];
const DEFAULT_IGNORE = ["width"];

function normalise(prop, value) {
  if (prop === "font-family") return value.split(",")[0].replace(/["']/g, "").replace(/ Variable$/, "").trim();
  return value.replace(/\s+/g, " ").trim();
}

async function styleOf(page, selector, pseudo) {
  const el = page.locator(selector).first();
  if (!(await el.count())) return null;
  return el.evaluate(
    (node, [props, pseudoEl]) => {
      const cs = getComputedStyle(node, pseudoEl || null);
      const out = {};
      for (const p of props) out[p] = cs.getPropertyValue(p);
      // Layout size, not the on-screen box: reference frames are scaled down with a transform.
      const w = node.offsetWidth ?? node.getBoundingClientRect().width;
      const h = node.offsetHeight ?? node.getBoundingClientRect().height;
      out["(box)"] = `${Math.round(w)}×${Math.round(h)}`;
      return out;
    },
    [PROPS, pseudo]
  );
}

const server = await createServer({ root: galleryRoot, configFile: path.join(galleryRoot, "vite.config.ts"), server: { port: 5199, strictPort: false }, logLevel: "error" });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, "");

const browser = await chromium.launch({ channel: "chrome" });
if (shots) fs.mkdirSync(outDir, { recursive: true });
let differences = 0;
let missing = 0;

for (const pair of pairs) {
  for (const ground of pair.grounds ?? ["dark", "light"]) {
    const ctx = await browser.newContext({ colorScheme: ground, viewport: { width: pair.viewport?.[0] ?? 1440, height: pair.viewport?.[1] ?? 1000 }, deviceScaleFactor: 2 });
    const ref = await ctx.newPage();
    await ref.goto("file://" + path.join(referenceRoot, pair.reference.file));
    // The reference files follow the system setting and a data-theme override on <html>.
    await ref.evaluate((g) => document.documentElement.setAttribute("data-theme", g), ground);
    await ref.evaluate(() => document.fonts.ready);
    // Measure the end state: the tally's switch-on and any other animation, finished.
    await ref.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
    const built = await ctx.newPage();
    await built.goto(base + pair.gallery.path);
    await built.evaluate(() => document.fonts.ready);
    await built.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
    const builtSel = pair.gallery.selector.replaceAll("{ground}", ground);

    const a = await styleOf(ref, pair.reference.selector, pair.pseudo);
    const b = await styleOf(built, builtSel, pair.pseudo);
    const label = `${pair.id} [${ground}]`;
    if (!a || !b) {
      missing++;
      console.log(`✗ ${label}: element not found in ${!a ? "reference (" + pair.reference.selector + ")" : "gallery (" + builtSel + ")"}`);
      await ctx.close();
      continue;
    }
    const ignore = new Set([...(pair.ignore ?? []), ...DEFAULT_IGNORE]);
    const diffs = [...PROPS, "(box)"].filter((p) => !ignore.has(p) && normalise(p, a[p]) !== normalise(p, b[p]));
    if (!diffs.length) console.log(`✓ ${label}: matches (${a["(box)"]})`);
    else {
      differences += diffs.length;
      console.log(`• ${label}: ${diffs.length} difference${diffs.length > 1 ? "s" : ""}`);
      for (const p of diffs) console.log(`    ${p.padEnd(24)} reference ${normalise(p, a[p])}   built ${normalise(p, b[p])}`);
    }
    if (shots) {
      const pad = pair.shotPadding ?? 12;
      const shot = async (page, sel, file) => {
        const el = page.locator(sel).first();
        const box = await el.boundingBox();
        if (!box) return;
        const target = pair.shotSelector ? page.locator(pair.shotSelector.replaceAll("{ground}", ground)).first() : el;
        const tb = (await target.boundingBox()) ?? box;
        await page.screenshot({ path: file, clip: { x: Math.max(0, tb.x - pad), y: Math.max(0, tb.y - pad), width: tb.width + pad * 2, height: tb.height + pad * 2 } });
      };
      await shot(ref, pair.reference.shotSelector ?? pair.reference.selector, path.join(outDir, `${pair.id}-${ground}-reference.png`));
      await shot(built, pair.gallery.shotSelector?.replaceAll("{ground}", ground) ?? builtSel, path.join(outDir, `${pair.id}-${ground}-built.png`));
    }
    await ctx.close();
  }
}

await browser.close();
await server.close();
console.log(`\n${pairs.length} pairs, ${differences} property differences, ${missing} not found.`);
process.exit(missing ? 1 : 0);
