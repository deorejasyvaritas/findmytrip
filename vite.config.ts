import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// `npm run dev` levanta la web y el Worker (API) juntos en http://localhost:5173.
export default defineConfig({
  plugins: [react(), cloudflare()],
});
