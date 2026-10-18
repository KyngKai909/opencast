#!/usr/bin/env node
/**
 * parity.mjs — visual-parity check: reference HTML pages vs the built Astro site.
 *
 * Usage (from the repo root):
 *   node apps/site/scripts/parity.mjs <page|all> [options]
 *   npm run parity -w @opencast/site -- run --widths 1440
 *
 *   <page>         home | run | syndication | spots | network | all
 *   --widths LIST  comma list of widths, optionally WxH (default 1440,820,390 → 1440x900, 820x1180, 390x844)
 *   --sections L   only these section keys (ids, plus header / footer / crawl)
 *   --base URL     compare against a running server (e.g. http://localhost:5183) instead of serving dist
 *   --reduced      emulate prefers-reduced-motion: reduce on both sides
 *   --no-build     never rebuild dist, even if it looks stale
 *   --self         compare the reference against itself (noise-floor check: shows what is not deterministic)
 *
 * What it does
 *   Reference: docs/reference/site/pages/<page>.html via file:// (fonts + Lenis load from CDNs).
 *   Built:     apps/site/dist served by a tiny clean-URL static server on a free port (or --base).
 *   Both sides get the same capture conditions: system Chrome via playwright-core, deviceScaleFactor 1,
 *   timezone America/Los_Angeles, clock fixed at 2026-10-17 20:14 PT (page.clock.setFixedTime: Date is
 *   frozen, timers and rAF keep running), Math.random replaced by a seeded PRNG, CSS animations and
 *   transitions zeroed, custom cursor / grain / #power overlay hidden, and setInterval callbacks held after
 *   load (rAF and setTimeout keep running) with the nav pill's .flip state reset.
 *
 *   Sections: every top-level section[id] in <main>, plus .crawl, plus pseudo-sections "header" (#nav at
 *   scroll 0, captured with main/footer hidden so only the bar itself is compared) and "footer"
 *   (footer#contact). The fixed nav is made position:absolute for every capture except "header".
 *   Sections taller than 1.6x the viewport that contain a position:sticky pin (scroll choreography) are captured as viewport shots at
 *   progress 0 / 0.5 / 1 (<id>@0, <id>@50, <id>@100); the mode is decided by the reference.
 *
 *   Per capture: pixel diff (max channel delta > 40, canvases masked grey on both sides, size difference
 *   counts as mismatch) → side-by-side JPEG reference | built | diff heatmap.
 *   Per section: text-anchored element diff (match by normalized text + occurrence index; compare rect
 *   relative to the section with 2px tolerance and key computed styles).
 *
 * Output: docs/site/parity/<page>/<section>-<width>.jpg, docs/site/parity/<page>.md (the "## Notes"
 * section is preserved across runs) and docs/site/parity/<page>.json.
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const sharp = require('sharp');

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(SITE, '../..');
const DIST = path.join(SITE, 'dist');
// Fallback build output: a no-check `astro build` goes here so a failed build never wipes apps/site/dist.
const FALLBACK_DIST = path.join(os.tmpdir(), 'dial-parity-dist');
let serveDir = DIST;
const REF_DIR = path.join(ROOT, 'docs/reference/site/pages');
const OUT_DIR = path.join(ROOT, 'docs/site/parity');

const PAGES = { home: '/', run: '/run', syndication: '/syndication', spots: '/spots', network: '/network' };
const DEFAULT_HEIGHTS = { 1440: 900, 820: 1180, 390: 844 };
const SCALE = { 1440: 0.5, 820: 0.7 };
const FIXED_TIME = '2026-10-17T20:14:00-07:00';
const TZ = 'America/Los_Angeles';
const SEED = 1814;
const TALL_FACTOR = 1.6;
const STOPS = [0, 0.5, 1];
const PIXEL_THRESHOLD = 40;
const RECT_TOL = 2;
const MAX_ROWS = 40;
const MAX_ONE_SIDED = 30;
const MAX_IMG_H = 3000;

const FREEZE_CSS = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}
#cur{display:none!important}#grain{display:none!important}#power{display:none!important}`;
// Freeze interval callbacks from here on and reset known alternating states to their base state.
const HOLD_JS = `window.__parityHold = true; document.querySelectorAll('.tnb.flip').forEach((e) => e.classList.remove('flip'));`;
const NAV_ABS_CSS = '#nav{position:absolute!important}';
const HEADER_ISOLATE_CSS = 'main,footer{visibility:hidden!important}';

// ---------------------------------------------------------------------------------------------- CLI

function parseArgs(argv) {
  const o = { page: null, widths: '1440,820,390', sections: null, base: null, reduced: false, build: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (a.includes('=')) return a.slice(a.indexOf('=') + 1);
      return argv[++i];
    };
    if (a.startsWith('--widths')) o.widths = val();
    else if (a.startsWith('--sections')) o.sections = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--base')) o.base = val().replace(/\/$/, '');
    else if (a === '--reduced') o.reduced = true;
    else if (a === '--no-build') o.build = false;
    else if (a === '--self') o.self = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (!a.startsWith('-')) o.page = a;
    else throw new Error(`Unknown flag ${a}`);
  }
  o.viewports = String(o.widths).split(',').map((w) => {
    const [ws, hs] = w.trim().split('x');
    const width = Number(ws);
    if (!width) throw new Error(`Bad width "${w}"`);
    return { width, height: Number(hs) || DEFAULT_HEIGHTS[width] || 900 };
  });
  return o;
}

// ---------------------------------------------------------------------------------- build + server

function newestMtime(p) {
  if (!fs.existsSync(p)) return 0;
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  let m = 0;
  for (const e of fs.readdirSync(p)) m = Math.max(m, newestMtime(path.join(p, e)));
  return m;
}

function ensureDist(allowBuild) {
  const index = path.join(DIST, 'index.html');
  const have = fs.existsSync(index);
  const srcM = Math.max(newestMtime(path.join(SITE, 'src')), newestMtime(path.join(SITE, 'public')), newestMtime(path.join(SITE, 'astro.config.mjs')));
  const stale = !have || srcM > fs.statSync(index).mtimeMs;
  if (!stale) return;
  if (!allowBuild) {
    if (!have) throw new Error('apps/site/dist is missing and --no-build was given');
    console.warn('! dist looks stale (src is newer); using it anyway (--no-build)');
    return;
  }
  // Note: `npm run build` runs `astro check` first, so a type error fails before dist is touched.
  console.log(`· building @opencast/site (${have ? 'dist is stale' : 'dist missing'}) …`);
  const r = spawnSync('npm', ['run', 'build', '-w', '@opencast/site'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (r.status === 0) return;
  // `astro check` often fails while pages are mid-port; a plain `astro build` still gives a fresh dist.
  const errs = `${r.stdout}\n${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((l) => /error/i.test(l) && !/^npm error/.test(l)).slice(0, 6);
  console.warn(`! npm run build failed (${errs.join(' | ').trim() || 'see npm output'}); retrying with astro build (no type check) …`);
  const r2 = spawnSync('npx', ['astro', 'build', '--outDir', FALLBACK_DIST], { cwd: SITE, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (r2.status === 0) { serveDir = FALLBACK_DIST; console.warn(`  serving the unchecked build from ${FALLBACK_DIST}`); return; }
  const tail = `${r2.stdout}\n${r2.stderr}`.trim().split('\n').slice(-12).join('\n');
  if (!fs.existsSync(index)) throw new Error(`build failed:\n${tail}`);
  console.warn(`! astro build failed too, using the existing (stale) dist:\n${tail}`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain',
  '.xml': 'application/xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function resolveDist(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const rel = path.normalize(clean).replace(/^(\.\.[/\\])+/, '');
  const base = path.join(serveDir, rel);
  if (!base.startsWith(serveDir)) return null;
  for (const c of [base, path.join(base, 'index.html'), `${base.replace(/\/$/, '')}.html`]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function startServer() {
  const server = http.createServer((req, res) => {
    const file = resolveDist(req.url);
    if (!file) {
      const nf = path.join(serveDir, '404.html');
      res.writeHead(404, { 'content-type': MIME['.html'] });
      res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// --------------------------------------------------------------------------------- in-page helpers

// Runs before any page script: deterministic Math.random (mulberry32), and a hold switch for
// setInterval so periodic toggles (e.g. the nav "Now" pill flipping every 3.4 s) freeze during capture.
function seedRandom(seed) {
  const origSetInterval = window.setInterval.bind(window);
  window.setInterval = function (fn, ms, ...args) {
    return origSetInterval(function () { if (!window.__parityHold && typeof fn === 'function') fn.apply(this, args); }, ms);
  };
  let a = seed >>> 0;
  Math.random = function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function setStyle(page, id, css) {
  return page.evaluate(([id, css]) => {
    let el = document.getElementById(id);
    if (css == null) { el?.remove(); return; }
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
    el.textContent = css;
  }, [id, css]);
}

async function settle(page, ms = 400) {
  await page.evaluate(() => new Promise((r) => {
    window.dispatchEvent(new Event('scroll'));
    requestAnimationFrame(() => requestAnimationFrame(r));
  }));
  await setStyle(page, '__parity_freeze', FREEZE_CSS);
  await page.evaluate(() => document.fonts && document.fonts.ready.then(() => 0));
  await page.waitForTimeout(ms);
}

async function scrollToY(page, y) {
  await page.evaluate((y) => window.scrollTo({ top: y, left: 0, behavior: 'instant' }), y);
  await settle(page);
}

// Tag sections with data-parity-key and report their geometry.
function discoverInPage() {
  const out = [];
  const seen = new Map();
  const add = (key, el) => {
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    if (n) key = `${key}~${n + 1}`;
    el.setAttribute('data-parity-key', key);
    const r = el.getBoundingClientRect();
    const sticky = [el, ...el.querySelectorAll('*')].some((d) => getComputedStyle(d).position === 'sticky');
    out.push({ key, top: r.top + scrollY, height: r.height, width: r.width, visible: r.width > 0 && r.height > 0, sticky });
  };
  const nav = document.getElementById('nav');
  if (nav) add('header', nav);
  const main = document.querySelector('main');
  const secs = main ? [...main.querySelectorAll('section[id]')] : [];
  const topLevel = secs.filter((s) => !secs.some((o) => o !== s && o.contains(s)));
  const body = topLevel.map((s) => [s.id, s]);
  const crawl = document.querySelector('.crawl');
  if (crawl && !topLevel.some((s) => s.contains(crawl))) body.push(['crawl', crawl]);
  body.sort((a, b) => (a[1].compareDocumentPosition(b[1]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  for (const [k, el] of body) add(k, el);
  const footer = document.querySelector('footer#contact') || document.querySelector('footer');
  if (footer) add('footer', footer);
  return { sections: out, nested: secs.length - topLevel.length, docHeight: document.documentElement.scrollHeight };
}

function geomInPage(key) {
  const el = document.querySelector(`[data-parity-key="${key}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top + scrollY, height: r.height };
}

// Canvas rects relative to the section (key) or to the viewport (key = null).
function canvasRectsInPage(key) {
  const root = key ? document.querySelector(`[data-parity-key="${key}"]`) : null;
  const o = root ? root.getBoundingClientRect() : { left: 0, top: 0 };
  return [...document.querySelectorAll('canvas')]
    .filter((c) => (!root || root.contains(c)) && c.checkVisibility({ visibilityProperty: true }))
    .map((c) => c.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height }));
}

// Visible elements with their own text, with rect relative to the section and key computed styles.
function textItemsInPage(key) {
  const root = document.querySelector(`[data-parity-key="${key}"]`);
  if (!root) return [];
  const R = root.getBoundingClientRect();
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE']);
  const px = (v) => (/^-?[\d.]+px$/.test(v) ? `${Math.round(parseFloat(v) * 100) / 100}px` : v);
  const counts = new Map();
  const items = [];
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (SKIP.has(el.tagName)) continue;
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.data;
    if (!own.trim()) continue;
    // All descendant text nodes joined with spaces, so "<b>88.4 NITE</b>Night Shift" reads "88.4 NITE Night Shift".
    const parts = [];
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) if (!SKIP.has(tw.currentNode.parentElement?.tagName)) parts.push(tw.currentNode.data);
    const t = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (t.length < 2) continue;
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 && r.height <= 1) continue; // sr-only / clipped
    const cs = getComputedStyle(el);
    const n = counts.get(t) || 0;
    counts.set(t, n + 1);
    items.push({
      t, n, tag: el.tagName.toLowerCase(),
      x: r.left - R.left, y: r.top - R.top, w: r.width, h: r.height,
      fontFamily: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase(),
      fontSize: px(cs.fontSize), fontWeight: cs.fontWeight, lineHeight: px(cs.lineHeight),
      letterSpacing: cs.letterSpacing === 'normal' ? '0px' : px(cs.letterSpacing),
      color: cs.color, textTransform: cs.textTransform, backgroundColor: cs.backgroundColor,
    });
  }
  return items;
}

// -------------------------------------------------------------------------------------- capturing

async function openPage(browser, url, vp, opts) {
  const ctx = await browser.newContext({
    viewport: vp, deviceScaleFactor: 1, timezoneId: TZ, locale: 'en-US',
    reducedMotion: opts.reduced ? 'reduce' : 'no-preference',
  });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(FIXED_TIME));
  // Registered after the clock so its setInterval wrapper is not replaced by Playwright's fake timers.
  await page.addInitScript(seedRandom, SEED);
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1700); // let intros finish (the reference power-on removes #power at 1.5 s)
  await page.evaluate(HOLD_JS);
  await settle(page);
  // One pass down the page so IntersectionObserver reveals fire, then back to the top.
  const docH = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < docH; y += Math.round(vp.height * 0.8)) {
    await page.evaluate((y) => { window.scrollTo({ top: y, behavior: 'instant' }); window.dispatchEvent(new Event('scroll')); }, y);
    await page.waitForTimeout(80);
  }
  await scrollToY(page, 0);
  const info = await page.evaluate(discoverInPage);
  return { ctx, page, info };
}

/** Capture one section in the given mode. Returns { shots: [{name, buf, canvases}], items }. */
async function captureSection(page, key, mode, vp) {
  const shots = [];
  let items = [];
  if (key === 'header') {
    await setStyle(page, '__parity_nav', null);
    await setStyle(page, '__parity_iso', HEADER_ISOLATE_CSS);
    await scrollToY(page, 0);
    const el = await page.$('[data-parity-key="header"]');
    items = await page.evaluate(textItemsInPage, key);
    const canvases = await page.evaluate(canvasRectsInPage, key);
    shots.push({ name: 'header', buf: await el.screenshot({ timeout: 20000 }), canvases });
    await setStyle(page, '__parity_iso', null);
    return { shots, items };
  }
  await setStyle(page, '__parity_nav', NAV_ABS_CSS);
  if (mode === 'tall') {
    for (const p of STOPS) {
      const g = await page.evaluate(geomInPage, key);
      await scrollToY(page, Math.max(0, Math.round(g.top + p * Math.max(0, g.height - vp.height))));
      if (p === 0) items = await page.evaluate(textItemsInPage, key);
      const canvases = await page.evaluate(canvasRectsInPage, null);
      shots.push({ name: `${key}@${Math.round(p * 100)}`, buf: await page.screenshot({ timeout: 20000 }), canvases });
    }
  } else {
    const g = await page.evaluate(geomInPage, key);
    await scrollToY(page, Math.round(g.top));
    items = await page.evaluate(textItemsInPage, key);
    const canvases = await page.evaluate(canvasRectsInPage, key);
    const el = await page.$(`[data-parity-key="${key}"]`);
    shots.push({ name: key, buf: await el.screenshot({ timeout: 20000 }), canvases });
  }
  return { shots, items };
}

// ---------------------------------------------------------------------------------------- diffing

async function toRaw(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function padTo(img, W, H, fill = [28, 28, 32]) {
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { out[i * 4] = fill[0]; out[i * 4 + 1] = fill[1]; out[i * 4 + 2] = fill[2]; out[i * 4 + 3] = 255; }
  for (let y = 0; y < img.h; y++) img.data.copy(out, y * W * 4, y * img.w * 4, (y + 1) * img.w * 4);
  return out;
}

function paintRects(data, W, H, rects) {
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(W, Math.ceil(r.x + r.w)), y1 = Math.min(H, Math.ceil(r.y + r.h));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 128;
    }
  }
}

async function pixelDiff(refShot, builtShot) {
  const a = await toRaw(refShot.buf);
  const b = await toRaw(builtShot.buf);
  const W = Math.max(a.w, b.w), H = Math.max(a.h, b.h);
  const A = padTo(a, W, H), B = padTo(b, W, H);
  const mA = Buffer.from(A), mB = Buffer.from(B);
  const rects = [...refShot.canvases, ...builtShot.canvases];
  paintRects(mA, W, H, rects);
  paintRects(mB, W, H, rects);
  const mask = new Uint8Array(W * H);
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, i = p * 4;
    let d;
    if (x >= a.w || y >= a.h || x >= b.w || y >= b.h) d = true; // size difference counts
    else d = Math.max(Math.abs(mA[i] - mB[i]), Math.abs(mA[i + 1] - mB[i + 1]), Math.abs(mA[i + 2] - mB[i + 2])) > PIXEL_THRESHOLD;
    if (d) { mask[p] = 1; n++; }
  }
  return { W, H, A, B, mask, refSize: [a.w, a.h], builtSize: [b.w, b.h], pct: (n / (W * H)) * 100, masked: rects.length };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function writeComposite(d, width, file) {
  const { W, H, A, B, mask } = d;
  const GAP = 8;
  const TW = W * 3 + GAP * 2;
  const out = Buffer.alloc(TW * H * 4, 255);
  for (let y = 0; y < H; y++) {
    A.copy(out, (y * TW) * 4, y * W * 4, (y + 1) * W * 4);
    B.copy(out, (y * TW + W + GAP) * 4, y * W * 4, (y + 1) * W * 4);
    for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 4, t = (y * TW + 2 * (W + GAP) + x) * 4;
      if (mask[y * W + x]) { out[t] = 255; out[t + 1] = 40; out[t + 2] = 40; } else { out[t] = A[s] * 0.3; out[t + 1] = A[s + 1] * 0.3; out[t + 2] = A[s + 2] * 0.3; }
      out[t + 3] = 255;
    }
    for (const gx of [W, 2 * W + GAP]) for (let x = gx; x < gx + GAP; x++) { const t = (y * TW + x) * 4; out[t] = out[t + 1] = out[t + 2] = 70; out[t + 3] = 255; }
  }
  const scale = SCALE[width] ?? 1;
  const sw = Math.max(1, Math.round(TW * scale)), sh = Math.max(1, Math.round(H * scale));
  const scaled = await sharp(out, { raw: { width: TW, height: H, channels: 4 } }).resize(sw, sh).raw().toBuffer();
  const ch = Math.min(sh, MAX_IMG_H);
  const cropped = ch < sh;
  const LABEL = 28;
  const pw = (W + GAP) * scale;
  const labels = [
    `reference · ${d.refSize[0]}×${d.refSize[1]}`,
    `built · ${d.builtSize[0]}×${d.builtSize[1]}`,
    `diff ${d.pct.toFixed(1)}%${cropped ? ` · cropped at ${MAX_IMG_H}px` : ''}`,
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${LABEL}">${labels.map((l, i) =>
    `<text x="${Math.round(i * pw + 8)}" y="19" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="${i === 2 ? '#ff8a80' : '#eee'}">${esc(l)}</text>`).join('')}</svg>`;
  await sharp(scaled, { raw: { width: sw, height: sh, channels: 4 } })
    .extract({ left: 0, top: 0, width: sw, height: ch })
    .png({ compressionLevel: 0 })
    .toBuffer()
    .then((b) => sharp(b).extend({ top: LABEL, background: '#111111' }).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 78 }).toFile(file));
  return cropped;
}

const STYLE_PROPS = [
  ['fontFamily', 'font'], ['fontSize', 'size'], ['fontWeight', 'weight'], ['lineHeight', 'lh'],
  ['letterSpacing', 'ls'], ['color', 'color'], ['textTransform', 'tt'], ['backgroundColor', 'bg'],
];

function diffElements(refItems, builtItems) {
  const k = (i) => `${i.t}\u0000${i.n}`;
  const bm = new Map(builtItems.map((i) => [k(i), i]));
  const rm = new Map(refItems.map((i) => [k(i), i]));
  const rows = [];
  const r1 = (v) => Math.round(v);
  for (const r of refItems) {
    const b = bm.get(k(r));
    if (!b) continue;
    const diffs = [];
    for (const d of ['x', 'y', 'w', 'h']) if (Math.abs(r[d] - b[d]) > RECT_TOL) diffs.push(`${d} ${r1(r[d])}→${r1(b[d])}`);
    for (const [p, label] of STYLE_PROPS) if (r[p] !== b[p]) diffs.push(`${label} ${r[p]}→${b[p]}`);
    if (diffs.length) rows.push({ text: r.t, n: r.n, tag: r.tag === b.tag ? r.tag : `${r.tag}/${b.tag}`, diffs });
  }
  const oneSided = (items, other) => {
    const m = new Map();
    for (const i of items) if (!other.has(k(i))) m.set(i.t, (m.get(i.t) || 0) + 1);
    return [...m].map(([t, count]) => ({ t, count }));
  };
  return { matched: refItems.filter((r) => bm.has(k(r))).length, refCount: refItems.length, builtCount: builtItems.length, mismatches: rows, refOnly: oneSided(refItems, bm), builtOnly: oneSided(builtItems, rm) };
}

// ------------------------------------------------------------------------------------ page runner

async function runPage(browser, pageName, opts, builtBase) {
  const route = PAGES[pageName];
  const refUrl = pathToFileURL(path.join(REF_DIR, `${pageName}.html`)).href;
  const builtUrl = opts.self ? refUrl : `${builtBase}${route}`;
  const slug = opts.self ? `${pageName}-self` : pageName; // self-checks never overwrite the real report
  const outDir = path.join(OUT_DIR, slug);
  fs.mkdirSync(outDir, { recursive: true });
  // Drop images from earlier runs that this run would regenerate (same widths, same section filter).
  for (const f of fs.readdirSync(outDir)) {
    const m = f.match(/^(.+?)(?:@\d+)?-(\d+)\.jpg$/);
    if (m && opts.viewports.some((v) => v.width === Number(m[2])) && (!opts.sections || opts.sections.includes(m[1]))) fs.rmSync(path.join(outDir, f));
  }
  const result = {
    page: pageName, slug, route, generated: new Date().toISOString(),
    settings: { time: `${FIXED_TIME} (${TZ})`, widths: opts.viewports.map((v) => `${v.width}x${v.height}`), seed: SEED, reduced: opts.reduced, reference: path.relative(ROOT, path.join(REF_DIR, `${pageName}.html`)), built: opts.self ? 'reference (self-check)' : opts.base ? builtUrl : `${serveDir === DIST ? 'apps/site/dist' : serveDir}${route}`, pixelThreshold: PIXEL_THRESHOLD, rectTolerance: RECT_TOL },
    order: [], captures: [], missing: [], elements: {}, notes: [],
  };

  for (const vp of opts.viewports) {
    console.log(`· ${pageName} @ ${vp.width}x${vp.height}`);
    const ref = await openPage(browser, refUrl, vp, opts);
    const built = await openPage(browser, builtUrl, vp, opts);
    try {
      if (ref.info.nested || built.info.nested) result.notes.push(`${vp.width}: nested section[id] skipped (ref ${ref.info.nested}, built ${built.info.nested})`);
      const rmap = new Map(ref.info.sections.map((s) => [s.key, s]));
      const bmap = new Map(built.info.sections.map((s) => [s.key, s]));
      const keys = [...ref.info.sections.map((s) => s.key), ...built.info.sections.map((s) => s.key).filter((k) => !rmap.has(k))];
      for (const k of keys) if (!result.order.includes(k)) result.order.push(k);
      for (const key of keys) {
        if (opts.sections && !opts.sections.includes(key)) continue;
        const r = rmap.get(key), b = bmap.get(key);
        if (!r || !b || !r.visible || !b.visible) {
          const where = !b ? 'missing in built' : !r ? 'missing in reference' : !r.visible ? 'hidden in reference' : 'hidden in built';
          result.missing.push({ section: key, width: vp.width, where, refHeight: r ? Math.round(r.height) : null, builtHeight: b ? Math.round(b.height) : null });
          continue;
        }
        // Scroll-choreographed = tall AND holds a sticky pin; long plain sections (FAQ, footer on phones) stay element shots.
        const mode = key === 'header' ? 'header' : r.sticky && r.height > TALL_FACTOR * vp.height ? 'tall' : 'element';
        const rc = await captureSection(ref.page, key, mode, vp);
        const bc = await captureSection(built.page, key, mode, vp);
        for (let i = 0; i < rc.shots.length; i++) {
          const rs = rc.shots[i], bs = bc.shots[i];
          const d = await pixelDiff(rs, bs);
          const file = path.join(outDir, `${rs.name}-${vp.width}.jpg`);
          const cropped = await writeComposite(d, vp.width, file);
          result.captures.push({
            section: key, capture: rs.name, width: vp.width, mode,
            mismatch: Math.round(d.pct * 100) / 100, refSize: d.refSize, builtSize: d.builtSize,
            sectionHeight: [Math.round(r.height), Math.round(b.height)], maskedCanvases: d.masked, cropped,
            image: path.relative(OUT_DIR, file),
          });
        }
        (result.elements[key] ||= {})[vp.width] = diffElements(rc.items, bc.items);
      }
    } finally {
      await ref.ctx.close();
      await built.ctx.close();
    }
  }
  writeReports(result);
  return result;
}

// ---------------------------------------------------------------------------------------- reports

const status = (pct) => (pct <= 1 ? '✅' : pct <= 5 ? '⚠️' : '❌');
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const trunc = (s, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function writeReports(res) {
  const mdPath = path.join(OUT_DIR, `${res.slug}.md`);
  let notes = '\n_Spec §8 deviations and anything a human should know about these diffs._\n';
  if (fs.existsSync(mdPath)) {
    const old = fs.readFileSync(mdPath, 'utf8');
    const m = old.match(/^## Notes[ \t]*\n([\s\S]*)$/m);
    if (m) notes = `\n${m[1].replace(/^\n+/, '')}`;
  }
  const L = [];
  L.push(`# Visual parity: ${res.page} (\`${res.route}\`)`, '');
  L.push(`Generated ${res.generated} by \`node apps/site/scripts/parity.mjs ${res.page}\`.`, '');
  L.push('| Setting | Value |', '|---|---|');
  L.push(`| Reference | \`${res.settings.reference}\` (file://) |`, `| Built | \`${res.settings.built}\` |`);
  L.push(`| Clock | ${res.settings.time}, Date frozen, timers running |`, `| Widths | ${res.settings.widths.join(', ')} (deviceScaleFactor 1) |`);
  L.push(`| Math.random seed | ${res.settings.seed} (mulberry32) |`, `| Reduced motion | ${res.settings.reduced ? 'emulated' : 'off'} |`);
  L.push(`| Pixel diff | max channel Δ > ${res.settings.pixelThreshold}; canvases masked; size difference counts as mismatch |`);
  L.push(`| Element diff | text + occurrence match; rect tolerance ${res.settings.rectTolerance}px |`, '');
  L.push('Status: ✅ ≤ 1% · ⚠️ ≤ 5% · ❌ > 5%. Images: reference | built | diff (red = mismatched pixels).', '');

  L.push('## Summary', '', '| Section | Width | Mismatch | Height ref / built | Status | Image |', '|---|---|---|---|---|---|');
  const rows = [
    ...res.captures.map((c) => ({ order: c, line: `| ${c.capture} | ${c.width} | ${c.mismatch.toFixed(2)}% | ${c.refSize[1]} / ${c.builtSize[1]}${c.mode === 'tall' ? ` (section ${c.sectionHeight[0]} / ${c.sectionHeight[1]})` : ''} | ${status(c.mismatch)} | [jpg](${c.image})${c.cropped ? ' (cropped)' : ''} |` })),
    ...res.missing.map((m) => ({ order: m, line: `| ${m.section} | ${m.width} | — | ${m.refHeight ?? '—'} / ${m.builtHeight ?? '—'} | ${m.where} | |` })),
  ];
  const orderOf = (o) => [res.order.indexOf(o.section), res.settings.widths.findIndex((w) => w.startsWith(`${o.width}x`)), o.capture || ''];
  rows.sort((a, b) => { const x = orderOf(a.order), y = orderOf(b.order); return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2], 'en', { numeric: true }); });
  L.push(...rows.map((r) => r.line), '');
  if (res.notes.length) L.push(...res.notes.map((n) => `- ${n}`), '');

  L.push('## Element diffs', '');
  L.push('Matched by normalized text + occurrence index. Rects are relative to the section (tall sections: at progress 0).', '');
  for (const [sec, byWidth] of Object.entries(res.elements)) {
    L.push(`### ${sec}`, '');
    for (const w of res.settings.widths.map((v) => v.split('x')[0]).filter((x) => byWidth[x])) {
      const e = byWidth[w];
      L.push(`<details><summary>${w}: ${e.matched}/${e.refCount} matched · ${e.mismatches.length} with differences · ${e.refOnly.length} ref-only · ${e.builtOnly.length} built-only</summary>`, '');
      if (e.mismatches.length) {
        L.push('| Text | Tag | Differences (ref → built) |', '|---|---|---|');
        for (const m of e.mismatches.slice(0, MAX_ROWS)) L.push(`| ${cell(trunc(m.text))}${m.n ? ` (#${m.n + 1})` : ''} | ${m.tag} | ${cell(m.diffs.join('; '))} |`);
        if (e.mismatches.length > MAX_ROWS) L.push(`| … ${e.mismatches.length - MAX_ROWS} more (see json) | | |`);
        L.push('');
      }
      for (const [label, list] of [['Only in reference', e.refOnly], ['Only in built', e.builtOnly]]) {
        if (!list.length) continue;
        L.push(`**${label}:**`, '');
        for (const o of list.slice(0, MAX_ONE_SIDED)) L.push(`- ${cell(trunc(o.t, 120))}${o.count > 1 ? ` ×${o.count}` : ''}`);
        if (list.length > MAX_ONE_SIDED) L.push(`- … ${list.length - MAX_ONE_SIDED} more (see json)`);
        L.push('');
      }
      L.push('</details>', '');
    }
  }
  L.push('## Notes', notes.trimEnd(), '');
  fs.writeFileSync(mdPath, L.join('\n'));
  fs.writeFileSync(path.join(OUT_DIR, `${res.slug}.json`), `${JSON.stringify(res, null, 2)}\n`);
}

function printSummary(res, viewports) {
  const keys = [];
  for (const sec of res.order) {
    const caps = [...new Set(res.captures.filter((c) => c.section === sec).map((c) => c.capture))];
    keys.push(...(caps.length ? caps : res.missing.some((m) => m.section === sec) ? [sec] : []));
  }
  const byKey = (k, w) => {
    const c = res.captures.find((x) => x.capture === k && x.width === w);
    if (c) return `${c.mismatch.toFixed(1)}% ${status(c.mismatch)}`;
    const m = res.missing.find((x) => x.section === k && x.width === w);
    return m ? m.where : '';
  };
  const kw = Math.max(10, ...keys.map((k) => k.length)) + 2;
  console.log(`\n${res.page} (${res.route})  →  docs/site/parity/${res.slug}.md`);
  console.log(`${'section'.padEnd(kw)}${viewports.map((v) => String(v.width).padEnd(22)).join('')}`);
  for (const k of keys) console.log(`${k.padEnd(kw)}${viewports.map((v) => byKey(k, v.width).padEnd(22)).join('')}`);
}

// ------------------------------------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.page || !(opts.page === 'all' || PAGES[opts.page])) {
    console.log('usage: node apps/site/scripts/parity.mjs <home|run|syndication|spots|network|all> [--widths 1440,820,390] [--sections hero,guide] [--base URL] [--reduced] [--no-build] [--self]');
    process.exit(opts.help ? 0 : 1);
  }
  const pages = opts.page === 'all' ? Object.keys(PAGES) : [opts.page];
  let server = null;
  let builtBase = opts.base;
  if (!builtBase && !opts.self) {
    ensureDist(opts.build);
    server = await startServer();
    builtBase = `http://127.0.0.1:${server.address().port}`;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const results = [];
  try {
    for (const p of pages) results.push(await runPage(browser, p, opts, builtBase));
  } finally {
    await browser.close();
    server?.close();
  }
  for (const r of results) printSummary(r, opts.viewports);
}

main().catch((e) => { console.error(e); process.exit(1); });
