import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 5173,
    // Same-origin in dev when VITE_API_BASE is unset, as server.mjs does in production.
    proxy: Object.fromEntries(
      ["/api", "/hls", "/uploads"].map((prefix) => [prefix, "http://localhost:8787"])
    )
  }
});
