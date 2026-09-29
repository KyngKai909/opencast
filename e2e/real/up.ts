// For people: the real API on a throwaway database, and the apps in real mode, until Ctrl-C.
//   npm run real:up -w @opencast/e2e              the API and every app
//   npm run real:up -w @opencast/e2e -- web       the API and the Opencast app only
//   npm run real:up -w @opencast/e2e -- --no-apps the API only
// Prints how to sign in as each seeded person. docs/apps/testing.md.

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { tokenFor } from "./tokens.js";
import { startRun, stopRun } from "./run.js";
import { appCommand, appEnv } from "./apps.js";
import { appUrl, PEOPLE, REAL_PORTS, ROOT, WORKSPACES, emailOf, type Person, type RealApp } from "./shared.js";

const wanted = process.argv.slice(2).filter((a) => a in REAL_PORTS) as RealApp[];
const apps = process.argv.includes("--no-apps") ? [] : wanted.length ? wanted : (Object.keys(REAL_PORTS) as RealApp[]);

const state = await startRun();
console.log(`\nThe real API: ${state.apiBase} (database ${state.database}).`);

const children: ChildProcess[] = [];
for (const app of apps) {
  const child = spawn(appCommand(REAL_PORTS[app]), {
    shell: true,
    // Its own process group, so stopping takes Vite with it (not just the shell).
    detached: true,
    cwd: path.join(ROOT, WORKSPACES[app]),
    env: { ...process.env, ...appEnv(app) },
    stdio: "ignore"
  });
  children.push(child);
  console.log(`${app.padEnd(8)} ${appUrl(app)}`);
}

console.log("\nTo sign in, paste one of these in the app's browser console, then reload (tokens last two hours):");
for (const person of Object.keys(PEOPLE) as Person[]) {
  const token = await tokenFor(person, { expiresIn: "2h" });
  console.log(`\n// ${person}: ${PEOPLE[person].does}`);
  console.log(`localStorage.setItem("oc-dev-token", "${token}"); localStorage.setItem("oc-dev-email", "${emailOf(person)}");`);
}
console.log("\nCtrl-C stops everything and drops the database.");

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    try {
      if (c.pid) process.kill(-c.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  await stopRun();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
// Stay up until stopped (with --no-apps, nothing else keeps this process alive).
setInterval(() => undefined, 1 << 30);
