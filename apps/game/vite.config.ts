import { defineConfig } from "vite";

// Relative paths so the built page works from any folder (and as a claude.ai artifact).
export default defineConfig({
  base: "./",
  worker: { format: "es" },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 6000,
    assetsInlineLimit: 0,
  },
  server: { host: "127.0.0.1" },
});
