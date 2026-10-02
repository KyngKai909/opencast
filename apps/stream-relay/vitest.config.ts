import { defineConfig } from "vitest/config";

// The Worker's code runs on Node's fetch, Request, Response and Web Crypto here, with `fetch` mocked:
// no network and no Workers runtime needed (docs/stream-relay.md has `wrangler dev` for that).
export default defineConfig({
  test: { environment: "node" }
});
