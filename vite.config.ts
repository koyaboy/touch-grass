import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(__dirname, "src"),
  publicDir: resolve(__dirname, "public"),
  plugins: [tailwindcss()],
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        newtab: resolve(__dirname, "src/newtab/index.html"),
        settings: resolve(__dirname, "src/settings/index.html"),
        offscreen: resolve(__dirname, "src/offscreen/index.html"),
        "service-worker": resolve(__dirname, "src/background/service-worker.ts"),
        overlay: resolve(__dirname, "src/overlay/overlay.ts"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
