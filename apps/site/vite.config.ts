import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
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
