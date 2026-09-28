import fs from "node:fs";
import path from "node:path";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error: a plain .mjs module with no types
import { mockLiveHls } from "@opencast/player/mock";

// Serves docs/reference at /reference/ so each specimen can link to the frame it comes from.
const REFERENCE = path.resolve(__dirname, "../../docs/reference");
function referenceFiles(): Plugin {
  return {
    name: "opencast-reference",
    configureServer(server) {
      // The player's mock stations, live (npm run mock:streams -w @opencast/player makes them).
      // 250 ms a request, so a cold tune costs what it would on a real connection.
      server.middlewares.use("/mock-hls", mockLiveHls({ latencyMs: 250 }));
      server.middlewares.use("/reference", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "");
        const file = path.resolve(REFERENCE, rel);
        if (!file.startsWith(REFERENCE) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        res.setHeader("content-type", file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream");
        fs.createReadStream(file).pipe(res);
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), referenceFiles()],
  // Workspace packages export their TypeScript under "source"; keep Vite's own conditions after it.
  resolve: { conditions: ["source", ...defaultClientConditions] },
  server: { port: 5180, strictPort: true }
});
