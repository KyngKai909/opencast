import { createReadStream } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Mock mode only: serves Mock Service Worker's worker script from the msw package, so nothing of
 * the mocks lands in `public/` or the build.
 */
function mockWorker(): Plugin {
  const file = createRequire(import.meta.url).resolve("msw/mockServiceWorker.js");
  return {
    name: "opencast-site-mock-worker",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/mockServiceWorker.js", (_req, res) => {
        res.setHeader("content-type", "text/javascript; charset=utf-8");
        createReadStream(file).pipe(res);
      });
    }
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "mock" ? [mockWorker()] : [])],
  // @opencast/contracts exports its TypeScript under the "source" condition. Point at it directly:
  // the condition itself would also pick third-party "source" exports (react-aria's) that don't build.
  resolve: { alias: [{ find: /^@opencast\/contracts$/, replacement: fileURLToPath(new URL("../../packages/contracts/src/index.ts", import.meta.url)) }] },
  server: {
    port: 5176,
    strictPort: true,
    // Same-origin in dev when VITE_API_BASE is unset.
    proxy: mode === "mock" ? undefined : { "/v1": "http://localhost:8787" }
  }
}));
