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
    // The API only accepts its own host and a session token. In development the
    // UI comes from Vite, so the proxy presents as the API's own host and passes
    // RECALL_API_TOKEN (start `recall serve` with the same value).
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4321",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("origin");
            const token = process.env.RECALL_API_TOKEN;
            if (token) proxyReq.setHeader("Authorization", `Bearer ${token}`);
          });
        },
      },
    },
  },
});
