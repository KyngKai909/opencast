import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      // Mock Service Worker's script lives in public/ for dev:mock; a real build doesn't ship it.
      name: "desk-no-mock-worker",
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
    port: 5178,
    strictPort: true,
    // Same-origin in dev when VITE_API_BASE is unset.
    proxy: mode === "mock" ? undefined : { "/v1": "http://localhost:8787" }
  }
}));
