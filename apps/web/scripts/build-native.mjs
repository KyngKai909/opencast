// `npm run build:native [ios|android] [-- --mode staging] [--no-tv]`: the Opencast app's web build
// (the viewer, master control and the desk) for the iPhone and Android apps, then `cap sync` into ios/ and android/ (docs/apps/native.md).
//
// 1. Checks the env the apps are built with (Vite's .env files for the mode, then the shell):
//    VITE_API_BASE and VITE_PRIVY_APP_ID are baked into the bundle, so they must be right now.
// 2. Builds the app (tsc, then vite build) into dist/.
// 3. For iOS, builds TV mode (apps/tv) into dist/tv/ with base /tv/: the external display's web view
//    loads it from inside the app (capacitor://localhost/tv/index.html?mirror...).
// 4. Writes the Cast receiver id where the native projects read it (ios/opencast.xcconfig,
//    android/app/src/main/res/values/opencast.xml).
// 5. `npx cap sync` for each platform.
//
// Never with CAP_SERVER_URL (live reload): a store build must run from its own files.

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const web = here("..");
const tv = here("../../tv");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const mode = option("--mode", "production");
const named = args.filter((a) => a === "ios" || a === "android");
const platforms = named.length ? named : ["ios", "android"];
const withTv = platforms.includes("ios") && !flag("--no-tv");

function fail(message) {
  console.error(`\nbuild:native: ${message}\n`);
  process.exit(1);
}
function warn(message) {
  console.warn(`build:native: ${message}`);
}
function run(cmd, cmdArgs, cwd, env = {}) {
  console.log(`\n$ ${[cmd, ...cmdArgs].join(" ")}   (${cwd.replace(here("../../.."), "")})`);
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) fail(`${cmd} ${cmdArgs.join(" ")} failed.`);
}

if (process.env.CAP_SERVER_URL) fail("CAP_SERVER_URL is set (live reload). Unset it: an app build runs from its own files.");

// The env the bundle gets: .env, .env.local, .env.[mode], .env.[mode].local, then the shell's VITE_ vars.
const env = loadEnv(mode, web, "VITE_");
if (env.VITE_MOCK === "true") fail(`mode "${mode}" sets VITE_MOCK: dev:mock needs a service worker, which the apps' web views don't have. Use the web app for dev:mock.`);
const api = env.VITE_API_BASE?.trim();
if (!api) fail("VITE_API_BASE isn't set: the app would call itself for its data.");
if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(api)) warn(`VITE_API_BASE is ${api}: the iOS Simulator reaches this computer's localhost, a phone or the Android emulator doesn't (the emulator's is 10.0.2.2).`);
if (!env.VITE_PRIVY_APP_ID) warn("VITE_PRIVY_APP_ID isn't set: signing in will say it isn't set up.");
const castAppId = env.VITE_CAST_APP_ID?.trim() ?? "";
if (!castAppId) warn("VITE_CAST_APP_ID isn't set: the apps won't offer Chromecasts (TV apps through the relay, and AirPlay mirroring, still work).");
if (!/^[A-Z0-9]{0,16}$/.test(castAppId)) fail(`VITE_CAST_APP_ID "${castAppId}" doesn't look like a Cast application id (8 capitals and digits).`);

// The Opencast app.
run("npx", ["tsc", "-b"], web);
run("npx", ["vite", "build", "--mode", mode], web);

// TV mode, for the iPhone's external display, with the same API.
if (withTv) {
  run("npx", ["vite", "build", "--mode", mode, "--base", "/tv/", "--outDir", `${web}/dist/tv`, "--emptyOutDir"], tv, {
    VITE_API_BASE: api,
    VITE_CAST_APP_ID: castAppId
  });
}

// The Cast receiver id, for the native projects.
writeFileSync(
  `${web}/ios/opencast.xcconfig`,
  `// Opencast's build settings, written by \`npm run build:native\` from the app's env. Info.plist
// reads OPENCAST_CAST_APP_ID twice: OpencastCastAppId (the Cast plugin checks it against the web
// build's) and the Bonjour service iOS lets the Cast SDK look for (_<app id>._googlecast._tcp).
// Empty until the receiver application is registered in the Google Cast console.
OPENCAST_CAST_APP_ID = ${castAppId}
`
);
writeFileSync(
  `${web}/android/app/src/main/res/values/opencast.xml`,
  `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by \`npm run build:native\` from the app's env. Empty until Opencast's receiver
     application is registered in the Google Cast console (then Cast is offered). -->
<resources>
    <string name="opencast_cast_app_id" translatable="false">${castAppId}</string>
</resources>
`
);

for (const p of platforms) run("npx", ["cap", "sync", p], web);

console.log(`\nbuild:native: ${platforms.join(" and ")} ready (mode ${mode}, API ${api}${withTv ? ", TV mode in dist/tv" : ""}).`);
