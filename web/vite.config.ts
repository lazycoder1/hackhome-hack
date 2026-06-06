import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The Node backend (src/server) runs on :3000 and serves the JSON + secret routes.
// We proxy those paths so the SPA and the real backend share one origin — both in dev
// (`vite`) and when serving the production build for review (`vite preview`).
const BACKEND = process.env.BACKEND_ORIGIN ?? "http://127.0.0.1:3000";

const proxy = {
  "/health": BACKEND,
  "/pocs": BACKEND,
  "/requirements": BACKEND,
  "/approval/complete": BACKEND,
  "/email": BACKEND,
  "/integrations": BACKEND,
  "/secrets": BACKEND,
};

// `true` lets the app be reached through an ngrok tunnel (dynamic *.ngrok-free.app host).
// This is a review/share convenience; tighten to a specific host for anything long-lived.
const allowedHosts = true;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy, allowedHosts },
  preview: { port: 4173, host: true, proxy, allowedHosts },
});
