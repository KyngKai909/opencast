import { defaultClientConditions, defineConfig } from "vite";
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
  // Workspace packages export their TypeScript under "source"; keep Vite's own conditions after it.
  resolve: { conditions: ["source", ...defaultClientConditions] },
  server: { port: 5174, strictPort: true }
}));
