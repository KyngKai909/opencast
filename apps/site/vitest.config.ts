import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: [{ find: /^@opencast\/contracts$/, replacement: fileURLToPath(new URL("../../packages/contracts/src/index.ts", import.meta.url)) }] },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    // GitHub's runners are several times slower than a laptop, running files side by side: a page
    // test that takes 2 s here can take 10 s there. The findBy/waitFor timeout is in the setup file.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    setupFiles: ["./vitest.setup.ts"]
  }
});
