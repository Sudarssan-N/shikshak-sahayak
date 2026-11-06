import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = process.env.VITE_BACKEND ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": backend,
      "/admin": { target: backend, bypass: (req) => (req.headers.accept?.includes("text/html") ? req.url : undefined) },
      "/stats": { target: backend, bypass: (req) => (req.headers.accept?.includes("text/html") ? req.url : undefined) },
      "/health": backend,
    },
  },
});
