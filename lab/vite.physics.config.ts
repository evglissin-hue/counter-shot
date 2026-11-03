import { defineConfig } from "vite";

// Builds only the physics debug page (physics.html) into dist-physics/.
export default defineConfig({
  base: "./",
  worker: { format: "es" },
  build: { target: "es2022", outDir: "dist-physics", emptyOutDir: true, chunkSizeWarningLimit: 6000, rollupOptions: { input: "physics.html" } },
});
