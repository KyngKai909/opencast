// Writes docs/api.md from the contracts: every endpoint, who can call it, and what it does.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api, API_PREFIX } from "../src/index.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const who = { public: "anyone", optional: "anyone (personal if signed in)", user: "signed in", admin: "Opencast admin" } as const;
const lines = [
  "# API",
  "",
  `Generated from \`packages/contracts\` by \`npm run docs:api\`. Every path is under \`${API_PREFIX}\`. Request and response shapes are the Zod schemas in the contracts.`,
  ""
];
let total = 0;
for (const [module, endpoints] of Object.entries(api)) {
  const list = Object.entries(endpoints);
  total += list.length;
  lines.push(`## ${module} (${list.length})`, "", "| | Method | Path | Who | What |", "|---|---|---|---|---|");
  for (const [name, e] of list) lines.push(`| \`${name}\` | ${e.method} | \`${e.path}\` | ${who[e.auth]} | ${e.summary.replace(/\|/g, "\\|")} |`);
  lines.push("");
}
lines.splice(4, 0, `${total} endpoints in ${Object.keys(api).length} modules.`, "");
writeFileSync(path.join(root, "docs", "api.md"), lines.join("\n"));
console.log(`docs/api.md: ${total} endpoints`);
