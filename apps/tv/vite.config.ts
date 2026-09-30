import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error: a plain .mjs module with no types
import { mockLiveHls } from "@opencast/player/mock";
// @ts-expect-error: a plain .mjs module with no types
import { mockLiveDash } from "@opencast/player/mock-dash";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * dev:mock's Cast bridge. The viewer's mock sender (apps/web/src/viewer/cast/mockSender.ts) is another
 * origin, so it can't join the BroadcastChannel receiver.html listens on. It embeds this page in a
 * hidden iframe instead: messages posted from the viewer's origin go onto the channel, and the
 * channel's messages for phones go back to it. Served by the dev server in mock mode only; it's
 * never a file, so no build has it.
 *
 * The same bridge carries the relay mock (src/mocks/handlers/remote.ts): `relay-tv` messages from
 * the viewer go onto the channel for the TV app, and `relay-phone` ones come back, to the phone
 * that last spoke or, before it has, to the viewer's origin (postMessage only delivers there).
 */
function mockCastBridge(viewerOrigins: string[]): string {
  return `<!doctype html><meta charset="utf-8"><title>Mock Cast bridge</title><script>
const allowed = ${JSON.stringify(viewerOrigins)};
const channel = new BroadcastChannel("opencast-cast-mock");
let phone = null;
window.addEventListener("message", (e) => {
  if (e.source !== window.parent || !allowed.includes(e.origin)) return;
  const m = e.data;
  if (!m || typeof m !== "object") return;
  const cast = m.to === "receiver" && typeof m.senderId === "string";
  const relay = m.to === "relay-tv" && typeof m.phoneId === "string";
  if (!cast && !relay) return;
  phone = e.origin;
  channel.postMessage(m);
});
channel.onmessage = (e) => {
  const m = e.data;
  if (!m) return;
  if (phone && m.to === "sender") window.parent.postMessage(m, phone);
  if (m.to === "relay-phone") for (const origin of phone ? [phone] : allowed) window.parent.postMessage(m, origin);
};
</script>`;
}

export default defineConfig(({ mode }) => {
  const viewer = loadEnv(mode, here("."), "VITE_").VITE_VIEWER_URL || "http://localhost:5174";
  const viewerOrigins = [new URL(viewer).origin];
  return {
    plugins: [
      react(),
      {
        name: "opencast-mock-streams",
        configureServer(server) {
          // `npm run dev:mock`: the mock stations play as live HLS (npm run mock:streams -w @opencast/player).
          if (mode === "mock") server.middlewares.use("/mock-hls", mockLiveHls({ latencyMs: 120 }));
          // The mock DASH stream link (A201): LOMA 9.7's live DASH.
          if (mode === "mock") server.middlewares.use("/mock-dash", mockLiveDash({ latencyMs: 120 }));
        }
      },
      {
        name: "opencast-mock-cast-bridge",
        apply: "serve",
        configureServer(server) {
          if (mode !== "mock") return;
          server.middlewares.use("/mock-cast-bridge.html", (_req, res) => {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(mockCastBridge(viewerOrigins));
          });
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
  };
});
