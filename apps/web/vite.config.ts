import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error: a plain .mjs module with no types
import { mockLiveHls } from "@opencast/player/mock";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: "opencast-mock-streams",
      configureServer(server) {
        // `npm run dev:mock`: the mock stations, a station's output and its live sources play as
        // live HLS (npm run mock:streams -w @opencast/player).
        if (mode === "mock") server.middlewares.use("/mock-hls", mockLiveHls({ latencyMs: 120 }));
      }
    },
    {
      // Mock Service Worker's script lives in public/ for dev:mock; a real build doesn't ship it.
      name: "opencast-no-mock-worker",
      apply: "build",
      closeBundle() {
        if (mode !== "mock") rmSync(fileURLToPath(new URL("./dist/mockServiceWorker.js", import.meta.url)), { force: true });
      }
    }
  ],
  // @opencast/contracts exports its TypeScript under the "source" condition. Point at it directly:
  // the condition itself would also pick third-party "source" exports (react-aria's) that don't build.
  resolve: { alias: [{ find: /^@opencast\/contracts$/, replacement: fileURLToPath(new URL("../../packages/contracts/src/index.ts", import.meta.url)) }] },
  server: {
    // `npm run dev` on 5173 against the API; `npm run dev:mock` passes --port 5174.
    port: 5173,
    strictPort: true,
    // Same-origin in dev when VITE_API_BASE is unset.
    proxy: mode === "mock" ? undefined : { "/v1": "http://localhost:8787" }
  }
}));
