// `npm run build:tizen -w @opencast/tv [-- --mode <mode>]`: TV mode as a Samsung TV (Tizen) web
// app, in dist-tizen/ (docs/apps/native.md, "Samsung TV (Tizen)").
//
// 1. The env, from Vite's .env files for the mode and then the shell. VITE_API_BASE is baked into
//    the bundle; unset, the build points at the staging API.
// 2. tsc, then vite build with relative paths (--base ./: the TV opens index.html as a file) and
//    VITE_TIZEN=true: routes in the hash, and vite.config.ts's tizenBuild (one classic script,
//    Samsung's older engines' syntax, webapis.js, no receiver entry).
// 3. tizen/config.xml and the icon beside it.
// 4. With the Tizen CLI on PATH: `tizen build-web`, and `tizen package` when TIZEN_PROFILE names
//    a certificate profile (Certificate Manager's). It prints what's left to run.
//
// `--mode mock` builds against Mock Service Worker, for a computer's browser only (served over
// http: a TV's file:// page has no service worker).

import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const tv = here("..");
const out = here("../dist-tizen");
const STAGING_API = "https://api-staging-9fae.up.railway.app";
const STAGING_VIEWER = "https://opencast-web.vercel.app";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const mode = option("--mode", "production");

function fail(message) {
  console.error(`\nbuild:tizen: ${message}\n`);
  process.exit(1);
}
function run(cmd, cmdArgs, env = {}) {
  console.log(`\n$ ${[cmd, ...cmdArgs].join(" ")}`);
  const r = spawnSync(cmd, cmdArgs, { cwd: tv, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) fail(`${cmd} ${cmdArgs.join(" ")} failed.`);
}
const has = (cmd) => spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" }).status === 0;

const env = loadEnv(mode, tv, "VITE_");
const mock = env.VITE_MOCK === "true";
const api = env.VITE_API_BASE?.trim() || (mock ? "" : STAGING_API);
const viewer = env.VITE_VIEWER_URL?.trim() || (mock ? "" : STAGING_VIEWER);
if (!mock && !env.VITE_API_BASE?.trim()) console.log(`build:tizen: VITE_API_BASE isn't set: building against staging (${api}).`);
if (!mock && !env.VITE_VIEWER_URL?.trim()) console.log(`build:tizen: VITE_VIEWER_URL isn't set: "sign in on your phone" points at ${viewer}.`);
if (!mock && !/^https:\/\//.test(api)) fail(`VITE_API_BASE is ${api}: a TV can't reach this computer's localhost, and the API must be https.`);
if (mock) console.log("build:tizen: mock mode, for a computer's browser over http only (the TV has no service worker for a file:// page).");

rmSync(out, { recursive: true, force: true });
run("npx", ["tsc", "-p", "tsconfig.json"]);
run("npx", ["vite", "build", "--mode", mode, "--base", "./", "--outDir", out, "--emptyOutDir"], {
  VITE_TIZEN: "true",
  ...(mock ? {} : { VITE_API_BASE: api, VITE_VIEWER_URL: viewer })
});

cpSync(here("../tizen/config.xml"), `${out}/config.xml`);
cpSync(here("../tizen/icon.png"), `${out}/icon.png`);

// What the TV opens is a file: every script, style and asset must be relative.
const html = readFileSync(`${out}/index.html`, "utf8");
const absolute = [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]);
if (absolute.length) fail(`index.html has absolute paths, which a file:// page can't load: ${absolute.join(", ")}`);
if (!existsSync(`${out}/config.xml`) || !existsSync(`${out}/icon.png`)) fail("config.xml or icon.png didn't copy.");

const id = /<tizen:application id="([^"]+)"/.exec(readFileSync(`${out}/config.xml`, "utf8"))?.[1] ?? "OpcastTv01.Opencast";
const profile = process.env.TIZEN_PROFILE;
const build = ["build-web", "--", out];
const pack = ["package", "-t", "wgt", "-s", profile ?? "<certificate profile>", "--", `${out}/.buildResult`];
const install = `tizen install -n Opencast.wgt -t <TV name from sdb devices> -- ${out}/.buildResult`;
const launch = `tizen run -p ${id} -t <TV name>`;
if (!has("tizen")) {
  console.log(`\nbuild:tizen: ${out} is ready. The Tizen CLI isn't on PATH (~/tizen-studio/tools/ide/bin). Then:`);
  for (const step of [build, pack]) console.log(`  tizen ${step.join(" ")}`);
} else {
  run("tizen", build);
  if (profile) run("tizen", pack);
  else console.log(`\nbuild:tizen: set TIZEN_PROFILE to your certificate profile's name to package it here, or run:\n  tizen ${pack.join(" ")}`);
}
console.log(`  ${install}\n  ${launch}`);
