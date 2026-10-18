import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: [{ find: /^@contracts\/(.*)$/, replacement: fileURLToPath(new URL("../../packages/contracts/src/$1.ts", import.meta.url)) }] },
  test: { include: ["src/**/*.test.ts"], environment: "node" }
});
