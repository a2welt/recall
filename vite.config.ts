import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname, "ui"),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "dist/ui"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4321",
    },
  },
});
