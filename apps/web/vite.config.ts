import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/uploads": "http://localhost:8787",
      "/hls": "http://localhost:8787"
    }
  }
});
