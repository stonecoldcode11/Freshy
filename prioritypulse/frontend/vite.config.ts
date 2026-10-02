/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.PP_API ?? "http://localhost:8000", changeOrigin: true } },
  },
  build: { chunkSizeWarningLimit: 900 },
  test: { environment: "jsdom", include: ["src/**/*.test.ts"] },
});
