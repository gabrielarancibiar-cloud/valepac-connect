import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        portal: resolve(process.cwd(), "index.html"),
        coseducam: resolve(process.cwd(), "coseducam-pwa/index.html"),
      },
    },
  },
});
