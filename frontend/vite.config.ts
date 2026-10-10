import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  preview: { proxy: { "/api": "http://127.0.0.1:8000" } },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/recharts/")) return "charts";
          if (id.includes("node_modules/")) return "vendor";
        },
      },
    },
  },
});
