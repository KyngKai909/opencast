import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error: a plain .mjs module with no types
import { mockLiveHls } from "@opencast/player/mock";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

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
  // the condition itself would also pick third-party "source" exports that don't build.
  resolve: { alias: [{ find: /^@opencast\/contracts$/, replacement: here("../../packages/contracts/src/index.ts") }] },
  build: {
    rollupOptions: {
      // TV mode (the Android TV and Fire TV app, TV browsers) and the Cast Web Receiver: one build.
      input: { index: here("index.html"), receiver: here("receiver.html") }
    }
  },
  server: { port: 5175, strictPort: true }
}));
