import { defineConfig } from "vitest/config";

export default defineConfig({
  // Workspace packages from source (their "source" export), never a stale dist.
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    setupFiles: ["./test/setup.ts"]
  }
});
