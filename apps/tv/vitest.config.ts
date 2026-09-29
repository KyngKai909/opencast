import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["source"],
    // The contracts' TypeScript for every environment: node tests (the mocks) don't take the
    // "source" condition, and would get the last build of dist/ instead.
    alias: [{ find: /^@opencast\/contracts$/, replacement: fileURLToPath(new URL("../../packages/contracts/src/index.ts", import.meta.url)) }]
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    setupFiles: ["./vitest.setup.ts"]
  }
});
