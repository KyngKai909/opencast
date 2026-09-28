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
        // `npm run dev:mock`: the mock stations play as live HLS (npm run mock:streams -w @opencast/player).
        if (mode === "mock") server.middlewares.use("/mock-hls", mockLiveHls({ latencyMs: 120 }));
      }
    }
  ],
  // @opencast/contracts exports its TypeScript under the "source" condition. Point at it directly:
  // the condition itself would also pick third-party "source" exports (react-aria's) that don't build.
  resolve: { alias: [{ find: /^@opencast\/contracts$/, replacement: fileURLToPath(new URL("../../packages/contracts/src/index.ts", import.meta.url)) }] },
  server: { port: 5174, strictPort: true }
}));
