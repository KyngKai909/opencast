import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Serves docs/reference at /reference/ so each specimen can link to the frame it comes from.
const REFERENCE = path.resolve(__dirname, "../../docs/reference");
function referenceFiles(): Plugin {
  return {
    name: "opencast-reference",
    configureServer(server) {
      server.middlewares.use("/reference", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "");
        const file = path.resolve(REFERENCE, rel);
        if (!file.startsWith(REFERENCE) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        res.setHeader("content-type", file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream");
        fs.createReadStream(file).pipe(res);
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), referenceFiles()],
  resolve: { conditions: ["source"] },
  server: { port: 5180, strictPort: true }
});
